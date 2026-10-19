import assert from "node:assert/strict";
import { createServer } from "node:http";

process.env.NODE_ENV = "test";

const { criarAdaptadorSicoob } =
  await import("../servidor/bancario/adaptadorSicoob.mjs");
const { criarClienteHttpSeguro, FalhaHttpSicoob } =
  await import("../servidor/bancario/clienteHttpSeguro.mjs");
const { obterConfiguracaoSicoob, resumirConfiguracaoSicoob } =
  await import("../servidor/bancario/configuracaoSicoob.mjs");
const { criarCarregadorTokenOAuth, criarGerenciadorOAuth } =
  await import("../servidor/bancario/gerenciadorOAuth.mjs");
const { criarIntegracaoSicoob } =
  await import("../servidor/bancario/integracaoSicoob.mjs");

let tokensEmitidos = 0;
let tentativas401Unica = 0;
const segredo = "segredo-que-nao-pode-vazar";
const servidor = createServer((req, res) => {
  if (req.url === "/token") {
    tokensEmitidos += 1;
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          access_token: `token-super-secreto-${tokensEmitidos}`,
          expires_in: 2,
          token_type: "Bearer",
        }),
      );
    }, 20);
    return;
  }
  if (req.url === "/timeout") return;
  if (req.url === "/lento") {
    res.setHeader("content-type", "application/json");
    const intervalo = setInterval(() => res.write(" "), 40);
    setTimeout(() => {
      clearInterval(intervalo);
      res.end(JSON.stringify({ categoria: "sucesso" }));
    }, 400);
    res.on("close", () => clearInterval(intervalo));
    return;
  }
  if (req.url === "/401-uma-vez") {
    tentativas401Unica += 1;
    res.setHeader("content-type", "application/json");
    if (tentativas401Unica === 1) {
      res.statusCode = 401;
      res.end(JSON.stringify({ detalhe: segredo }));
    } else {
      res.end(
        JSON.stringify({
          categoria: "sucesso",
          provedor_id: "PROVEDOR-RENOVADO",
          estado: "registrada",
          codigo: "TESTE_RENOVADO",
        }),
      );
    }
    return;
  }
  if (req.url === "/oauth-auth") {
    assert.equal(req.headers.authorization, "Basic contrato-local");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === "/invalido") {
    res.end("{nao-json");
    return;
  }
  if (req.url === "/grande") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ dados: "x".repeat(2_000) }));
    return;
  }
  const status = Number(req.url?.slice(1));
  if ([401, 403, 429, 503].includes(status)) {
    res.statusCode = status;
    if (status === 429) res.setHeader("retry-after", "3");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ detalhe: segredo }));
    return;
  }
  if (req.url === "/cobranca" || req.url === "/consulta") {
    assert.match(
      req.headers.authorization ?? "",
      /^Bearer token-super-secreto-(?:fixo|\d+)$/,
    );
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        categoria: "sucesso",
        provedor_id: "PROVEDOR-123",
        estado: "registrada",
        codigo: "TESTE_OK",
      }),
    );
    return;
  }
  res.statusCode = 404;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ erro: "nao_encontrado" }));
});

await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
const endereco = servidor.address();
const origem = `http://127.0.0.1:${endereco.port}`;

function contratoPara(caminhoRegistro, caminhoConsulta = caminhoRegistro) {
  return {
    criarRequisicaoRegistro() {
      return {
        metodo: "POST",
        caminho: caminhoRegistro,
        corpo: { teste: true },
      };
    },
    interpretarRegistro(resposta) {
      return resposta.conteudo;
    },
    criarRequisicaoConsulta() {
      return { metodo: "GET", caminho: caminhoConsulta };
    },
    interpretarConsulta(resposta) {
      return resposta.conteudo;
    },
  };
}

function gerenciadorFixo() {
  let invalidacoes = 0;
  return {
    async obter() {
      return {
        accessToken: "token-super-secreto-fixo",
        tokenType: "Bearer",
      };
    },
    invalidar() {
      invalidacoes += 1;
      return true;
    },
    get invalidacoes() {
      return invalidacoes;
    },
  };
}

try {
  const variaveis = {
    NODE_ENV: "test",
    SICOOB_AMBIENTE: "homologacao",
    SICOOB_CONTA_REFERENCIA: "conta-interna-teste",
    SICOOB_HOMOLOGACAO_API_BASE_URL: origem,
    SICOOB_HOMOLOGACAO_OAUTH_TOKEN_URL: `${origem}/token`,
    SICOOB_HOMOLOGACAO_CLIENT_ID: "cliente-homologacao",
    SICOOB_HOMOLOGACAO_CLIENT_SECRET: segredo,
    SICOOB_HOMOLOGACAO_CONTRATO_VERSAO: "contrato-de-teste",
    SICOOB_PRODUCAO_API_BASE_URL: "https://producao.invalid",
    SICOOB_PRODUCAO_CLIENT_ID: "nao-deve-ser-lido",
  };
  const configuracao = obterConfiguracaoSicoob({
    variaveis,
    exigirCompleta: true,
  });
  assert.equal(configuracao.clientId, "cliente-homologacao");
  assert.equal(configuracao.apiBaseUrl, origem);
  const resumo = resumirConfiguracaoSicoob(configuracao);
  assert.equal(resumo.oauth_configurado, true);
  assert.equal(JSON.stringify(resumo).includes(segredo), false);
  assert.throws(
    () =>
      obterConfiguracaoSicoob({
        variaveis: {
          NODE_ENV: "test",
          SICOOB_AMBIENTE: "producao",
          SICOOB_PRODUCAO_API_BASE_URL: origem,
        },
      }),
    /produção|HTTPS|local/,
  );

  const clienteToken = criarClienteHttpSeguro({
    baseUrl: origem,
    permitirHttpLocal: true,
    timeoutMs: 500,
  });
  const carregador = criarCarregadorTokenOAuth({
    clienteHttp: clienteToken,
    contratoOAuth: {
      criarRequisicaoToken() {
        return { metodo: "POST", caminho: "/token", corpo: { teste: true } };
      },
      interpretarToken({ conteudo }) {
        return {
          accessToken: conteudo.access_token,
          expiresInSeconds: conteudo.expires_in,
          tokenType: conteudo.token_type,
        };
      },
    },
  });
  let agora = 1_000_000;
  const oauth = criarGerenciadorOAuth({
    obterNovoToken: carregador,
    relogio: () => agora,
    margemExpiracaoMs: 500,
  });
  const concorrentes = await Promise.all([
    oauth.obter(),
    oauth.obter(),
    oauth.obter(),
  ]);
  assert.equal(tokensEmitidos, 1);
  assert.equal(new Set(concorrentes.map((item) => item.accessToken)).size, 1);
  agora += 1_600;
  const renovado = await oauth.obter();
  assert.equal(tokensEmitidos, 2);
  assert.notEqual(renovado.accessToken, concorrentes[0].accessToken);
  assert.equal(JSON.stringify(oauth.estado()).includes("token-super"), false);

  const integrada = criarIntegracaoSicoob({
    variaveis,
    permitirHttpLocal: true,
    timeoutMs: 500,
    contratoOAuth: {
      criarRequisicaoToken(configuracaoRecebida) {
        assert.equal(configuracaoRecebida.clientId, "cliente-homologacao");
        return { metodo: "POST", corpo: { contrato: "teste" } };
      },
      interpretarToken({ conteudo }) {
        return {
          accessToken: conteudo.access_token,
          expiresInSeconds: conteudo.expires_in,
          tokenType: conteudo.token_type,
        };
      },
    },
    contratoCobranca: contratoPara("/cobranca", "/consulta"),
  });
  assert.equal(integrada.configuracao.ambiente, "homologacao");
  assert.equal(
    (await integrada.adaptador.registrarCobranca({})).categoria,
    "sucesso",
  );
  assert.equal(JSON.stringify(integrada.configuracao).includes(segredo), false);

  const cliente = criarClienteHttpSeguro({
    baseUrl: origem,
    permitirHttpLocal: true,
    timeoutMs: 120,
    deadlineTotalMs: 300,
    limiteRespostaBytes: 1_024,
  });
  await assert.rejects(
    cliente.solicitar({ caminho: "https://malicioso.invalid/roubo" }),
    /relativo/,
  );
  await assert.rejects(
    cliente.solicitar({
      caminho: "/cobranca",
      cabecalhos: { authorization: "Basic nao-permitido" },
    }),
    /Cabeçalho bancário não permitido/,
  );
  const clienteOauthComAutorizacao = criarClienteHttpSeguro({
    baseUrl: origem,
    permitirHttpLocal: true,
    permitirAutorizacaoContrato: true,
  });
  assert.equal(
    (
      await clienteOauthComAutorizacao.solicitar({
        caminho: "/oauth-auth",
        cabecalhos: { authorization: "Basic contrato-local" },
      })
    ).status,
    200,
  );
  const fixo = gerenciadorFixo();
  const adaptador = criarAdaptadorSicoob({
    clienteHttp: cliente,
    gerenciadorOAuth: fixo,
    contrato: contratoPara("/cobranca", "/consulta"),
  });
  assert.equal(
    (await adaptador.registrarCobranca({ idempotencia: "teste" })).provedor_id,
    "PROVEDOR-123",
  );
  assert.equal(
    (await adaptador.consultarCobranca({ idempotencia: "teste" })).categoria,
    "sucesso",
  );

  function adaptadorComResultado(
    resultadoRegistro,
    resultadoConsulta = resultadoRegistro,
  ) {
    return criarAdaptadorSicoob({
      clienteHttp: {
        async solicitar() {
          return { status: 200, conteudo: {} };
        },
      },
      gerenciadorOAuth: gerenciadorFixo(),
      contrato: {
        ...contratoPara("/cobranca", "/consulta"),
        interpretarRegistro() {
          return resultadoRegistro;
        },
        interpretarConsulta() {
          return resultadoConsulta;
        },
      },
    });
  }
  for (const resultadoInvalido of [
    { categoria: "sucesso", estado: "registrada", codigo: "SEM_ID" },
    {
      categoria: "sucesso",
      provedor_id: "id com espaços",
      estado: "registrada",
      codigo: "ID_INSEGURO",
    },
    {
      categoria: "sucesso",
      provedor_id: "ID-1",
      estado: "liquidada",
      codigo: "ESTADO_INVALIDO",
    },
    {
      categoria: "sucesso",
      provedor_id: "ID-1",
      estado: "registrada",
      codigo: "CAMPO_EXTRA",
      payload: segredo,
    },
  ]) {
    await assert.rejects(
      adaptadorComResultado(resultadoInvalido).registrarCobranca({}),
      (erro) => erro.codigo === "SICOOB_RESPOSTA_FORA_DO_CONTRATO",
    );
  }
  await assert.rejects(
    adaptadorComResultado(
      { categoria: "rejeitada", codigo: "TESTE_REJEITADA" },
      {
        categoria: "sucesso",
        provedor_id: "ID-CONSULTA",
        estado: "cancelada",
        codigo: "ESTADO_CONSULTA_INVALIDO",
      },
    ).consultarCobranca({}),
    (erro) => erro.codigo === "SICOOB_RESPOSTA_FORA_DO_CONTRATO",
  );
  assert.equal(
    (
      await adaptadorComResultado(
        { categoria: "rejeitada", codigo: "TESTE_REJEITADA" },
        {
          categoria: "sucesso",
          provedor_id: "ID-CONSULTA",
          estado: "liquidada",
          codigo: "TESTE_LIQUIDADA",
        },
      ).consultarCobranca({})
    ).estado,
    "liquidada",
  );

  for (const [status, codigo, permanente] of [
    [401, "SICOOB_NAO_AUTORIZADO", false],
    [403, "SICOOB_ACESSO_NEGADO", false],
    [429, "SICOOB_LIMITE_REQUISICOES", false],
    [503, "SICOOB_INDISPONIVEL", false],
  ]) {
    const autenticacao = gerenciadorFixo();
    const comFalha = criarAdaptadorSicoob({
      clienteHttp: cliente,
      gerenciadorOAuth: autenticacao,
      contrato: contratoPara(`/${status}`),
    });
    await assert.rejects(comFalha.registrarCobranca({}), (erro) => {
      assert.equal(erro.codigo, codigo);
      assert.equal(erro.seguroRepetir, false);
      assert.equal(erro.permanente, permanente);
      if (status === 429) assert.equal(erro.retryAfterMs, 3_000);
      assert.equal(String(erro).includes(segredo), false);
      return true;
    });
    if (status === 401) assert.equal(autenticacao.invalidacoes, 0);
    if (status === 403) assert.equal(autenticacao.invalidacoes, 0);
  }

  for (const [status, codigo] of [
    [401, "SICOOB_NAO_AUTORIZADO"],
    [403, "SICOOB_ACESSO_NEGADO"],
  ]) {
    const autenticacao = gerenciadorFixo();
    const consultaComFalha = criarAdaptadorSicoob({
      clienteHttp: cliente,
      gerenciadorOAuth: autenticacao,
      contrato: contratoPara("/cobranca", `/${status}`),
    });
    await assert.rejects(consultaComFalha.consultarCobranca({}), (erro) => {
      assert.equal(erro.codigo, codigo);
      assert.equal(erro.permanente, true);
      return true;
    });
    assert.equal(autenticacao.invalidacoes, status === 401 ? 1 : 0);
  }

  let token401 = 0;
  const renovacao401 = criarAdaptadorSicoob({
    clienteHttp: cliente,
    gerenciadorOAuth: {
      async obter() {
        token401 += 1;
        return {
          accessToken: `token-super-secreto-${token401}`,
          tokenType: "Bearer",
        };
      },
      invalidar() {
        return true;
      },
    },
    contrato: contratoPara("/401-uma-vez"),
  });
  assert.equal(
    (await renovacao401.consultarCobranca({})).provedor_id,
    "PROVEDOR-RENOVADO",
  );
  assert.equal(tentativas401Unica, 2);

  const clienteComDeadline = criarClienteHttpSeguro({
    baseUrl: origem,
    permitirHttpLocal: true,
    timeoutMs: 300,
    deadlineTotalMs: 140,
  });
  await assert.rejects(
    clienteComDeadline.solicitar({ caminho: "/lento" }),
    (erro) => erro.codigo === "SICOOB_DEADLINE_EXCEDIDO",
  );

  for (const [caminho, codigo] of [
    ["/timeout", "SICOOB_TIMEOUT"],
    ["/invalido", "SICOOB_RESPOSTA_JSON_INVALIDA"],
    ["/grande", "SICOOB_RESPOSTA_MUITO_GRANDE"],
  ]) {
    const comFalha = criarAdaptadorSicoob({
      clienteHttp: cliente,
      gerenciadorOAuth: gerenciadorFixo(),
      contrato: contratoPara(caminho),
    });
    await assert.rejects(comFalha.registrarCobranca({}), (erro) => {
      assert.equal(erro.codigo, codigo);
      assert.equal(erro.seguroRepetir, false);
      assert.equal(String(erro).includes("token-super-secreto"), false);
      return true;
    });
    await assert.rejects(comFalha.consultarCobranca({}), (erro) => {
      assert.equal(erro.codigo, codigo);
      assert.equal(erro.seguroRepetir, true);
      return true;
    });
  }

  const falhaAntesDaOperacao = criarAdaptadorSicoob({
    clienteHttp: cliente,
    gerenciadorOAuth: {
      async obter() {
        throw new FalhaHttpSicoob("SICOOB_OAUTH_INDISPONIVEL");
      },
    },
    contrato: contratoPara("/cobranca"),
  });
  await assert.rejects(falhaAntesDaOperacao.registrarCobranca({}), (erro) => {
    assert.equal(erro.codigo, "SICOOB_OAUTH_INDISPONIVEL");
    assert.equal(erro.seguroRepetir, true);
    return true;
  });
  const oauthComFalhaNaoConfiavel = criarGerenciadorOAuth({
    async obterNovoToken() {
      throw new Error(segredo);
    },
  });
  await assert.rejects(oauthComFalhaNaoConfiavel.obter(), (erro) => {
    assert.equal(erro.codigo, "SICOOB_OAUTH_FALHOU");
    assert.equal(String(erro).includes(segredo), false);
    return true;
  });

  assert.throws(
    () =>
      criarAdaptadorSicoob({
        clienteHttp: cliente,
        gerenciadorOAuth: gerenciadorFixo(),
        contrato: {},
      }),
    /contrato oficial/,
  );
  assert.equal(String(new FalhaHttpSicoob("ERRO")).includes(segredo), false);
  console.log(
    "OK: pré-token Sicoob valida ambientes, OAuth, concorrência e falhas HTTP sem expor segredos.",
  );
} finally {
  servidor.closeAllConnections();
  await new Promise((resolve, reject) =>
    servidor.close((erro) => (erro ? reject(erro) : resolve())),
  );
}
