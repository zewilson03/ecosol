import assert from "node:assert/strict";
import { createServer } from "node:http";

process.env.NODE_ENV = "test";

const { contratoOAuthSicoob } =
  await import("../servidor/bancario/contratoOAuthSicoob.mjs");
const { mapearCobrancaParaSicoob } =
  await import("../servidor/bancario/mapeamentoCobrancaSicoob.mjs");
const { criarContratoCobrancaSicoob } =
  await import("../servidor/bancario/contratoCobrancaSicoob.mjs");
const { criarIntegracaoSicoob } =
  await import("../servidor/bancario/integracaoSicoob.mjs");

const requisicaoToken = contratoOAuthSicoob.criarRequisicaoToken({
  clientId: "cliente-de-homologacao",
  oauthScope: "boletos_consulta boletos_inclusao",
});
assert.equal(requisicaoToken.metodo, "POST");
assert.equal(
  requisicaoToken.cabecalhos["content-type"],
  "application/x-www-form-urlencoded",
);
assert.deepEqual(
  Object.fromEntries(new URLSearchParams(requisicaoToken.corpo)),
  {
    grant_type: "client_credentials",
    client_id: "cliente-de-homologacao",
    scope: "boletos_consulta boletos_inclusao",
  },
);
assert.equal(requisicaoToken.corpo.includes("client_secret"), false);

const entrada = {
  operacao: {
    idempotencia: "a".repeat(64),
    valorCentavos: 12_345,
    dataEmissao: "2026-10-22",
    vencimento: "2026-11-05",
    mensagensInstrucao: ["Cobrança Ecosol - competência 10/2026"],
  },
  pagador: {
    documento: "529.982.247-25",
    nome: "Cliente de Homologação",
    endereco: "Rua de teste, 10",
    bairro: "Centro",
    cidade: "Goiânia",
    cep: "74000-000",
    uf: "GO",
    email: "CLIENTE@EXEMPLO.TEST",
  },
  convenio: {
    numeroCliente: 123,
    codigoModalidade: 1,
    numeroContaCorrente: 456,
    codigoEspecieDocumento: "DM",
    identificacaoEmissaoBoleto: 1,
    identificacaoDistribuicaoBoleto: 1,
    gerarPdf: true,
  },
};
const boleto = mapearCobrancaParaSicoob(entrada);
assert.equal(boleto.valor, 123.45);
assert.equal(boleto.pagador.numeroCpfCnpj, "52998224725");
assert.equal(boleto.pagador.cep, "74000000");
assert.equal(boleto.pagador.email, "cliente@exemplo.test");
assert.equal(boleto.seuNumero.length, 18);
assert.equal(boleto.identificacaoBoletoEmpresa.length, 20);
assert.equal("nossoNumero" in boleto, false);
assert.equal("valorMulta" in boleto, false);
assert.equal("numeroContratoCobranca" in boleto, false);
assert.equal("tipoFormularioImpressaoPDF" in boleto, false);

assert.throws(
  () =>
    mapearCobrancaParaSicoob({
      ...entrada,
      pagador: { ...entrada.pagador, endereco: "" },
    }),
  (erro) =>
    erro.codigo === "SICOOB_COBRANCA_INCOMPLETA" &&
    erro.campo === "endereço do pagador",
);

const contratoCobranca = criarContratoCobrancaSicoob({
  convenio: entrada.convenio,
  relogio: () => Date.parse("2026-10-22T12:00:00Z"),
});
const requisicaoRegistro = contratoCobranca.criarRequisicaoRegistro({
  idempotencia: entrada.operacao.idempotencia,
  snapshot: {
    cliente: entrada.pagador,
    unidade: { uc: "123456789" },
    cobranca: {
      valor_centavos: entrada.operacao.valorCentavos,
      vencimento: entrada.operacao.vencimento,
    },
  },
});
assert.equal(requisicaoRegistro.metodo, "POST");
assert.equal(requisicaoRegistro.caminho, "/boletos");
assert.equal(requisicaoRegistro.corpo.dataEmissao, "2026-10-22");
assert.equal(requisicaoRegistro.corpo.valor, 123.45);
assert.deepEqual(
  contratoCobranca.interpretarRegistro({
    status: 200,
    conteudo: { resultado: { nossoNumero: 987654321 } },
  }),
  {
    categoria: "sucesso",
    provedor_id: "987654321",
    estado: "registrada",
    codigo: "SICOOB_BOLETO_INCLUIDO",
  },
);
const pdfBoletoFicticio = Buffer.from("%PDF-1.4\nboleto de teste\n").toString(
  "base64",
);
assert.deepEqual(
  contratoCobranca.interpretarRegistro({
    status: 200,
    conteudo: {
      resultado: {
        nossoNumero: 987654321,
        linhaDigitavel: "1".repeat(47),
        codigoBarras: "2".repeat(44),
        qrCode: "00020101021226890014br.gov.bcb.pix",
        pdfBoleto: pdfBoletoFicticio,
      },
    },
  }).artefatos,
  {
    linha_digitavel: "1".repeat(47),
    codigo_barras: "2".repeat(44),
    qr_code: "00020101021226890014br.gov.bcb.pix",
    pdf_base64: pdfBoletoFicticio,
  },
);
assert.deepEqual(
  contratoCobranca.interpretarRegistro({
    status: 406,
    conteudo: { mensagens: [{ codigo: "VAL-001" }] },
  }),
  { categoria: "rejeitada", codigo: "VAL-001" },
);
assert.throws(
  () => contratoCobranca.criarRequisicaoConsulta({}),
  (erro) =>
    erro.codigo === "SICOOB_CONSULTA_SEM_NOSSO_NUMERO" &&
    erro.permanente === true,
);
const requisicaoConsulta = contratoCobranca.criarRequisicaoConsulta({
  provedor_id: "987654321",
});
assert.equal(requisicaoConsulta.metodo, "GET");
assert.match(requisicaoConsulta.caminho, /^\/boletos\?/);
const consultaParametros = new URLSearchParams(
  requisicaoConsulta.caminho.split("?")[1],
);
assert.equal(consultaParametros.get("numeroCliente"), "123");
assert.equal(consultaParametros.get("codigoModalidade"), "1");
assert.equal(consultaParametros.get("nossoNumero"), "987654321");
assert.deepEqual(
  contratoCobranca.interpretarConsulta(
    {
      status: 200,
      conteudo: {
        resultado: { nossoNumero: 987654321, situacaoBoleto: "Em Aberto" },
      },
    },
    { provedor_id: "987654321" },
  ),
  {
    categoria: "sucesso",
    provedor_id: "987654321",
    estado: "registrada",
    codigo: "SICOOB_BOLETO_EM_ABERTO",
  },
);
assert.equal(
  contratoCobranca.interpretarConsulta(
    {
      status: 200,
      conteudo: {
        resultado: { nossoNumero: 987654321, situacaoBoleto: "Liquidado" },
      },
    },
    { provedor_id: "987654321" },
  ).estado,
  "liquidada",
);
assert.equal(
  contratoCobranca.interpretarConsulta(
    {
      status: 200,
      conteudo: {
        resultado: { nossoNumero: 987654321, situacaoBoleto: "Baixado" },
      },
    },
    { provedor_id: "987654321" },
  ).categoria,
  "resultado_desconhecido",
);
assert.equal(
  contratoCobranca.interpretarConsulta({ status: 204 }).categoria,
  "nao_encontrada",
);
assert.throws(
  () =>
    contratoCobranca.interpretarConsulta(
      {
        status: 200,
        conteudo: {
          resultado: { nossoNumero: 111, situacaoBoleto: "Em Aberto" },
        },
      },
      { provedor_id: "987654321" },
    ),
  (erro) =>
    erro.codigo === "SICOOB_NOSSO_NUMERO_DIVERGENTE" &&
    erro.permanente === true,
);
assert.throws(
  () =>
    mapearCobrancaParaSicoob({
      ...entrada,
      operacao: { ...entrada.operacao, valorCentavos: 12_345.6 },
    }),
  (erro) => erro.codigo === "SICOOB_COBRANCA_INCOMPLETA",
);

let tokenSolicitado = 0;
let healthSolicitado = 0;
let boletoIncluido = 0;
let boletoConsultado = 0;
const servidor = createServer((req, res) => {
  if (req.url === "/token" && req.method === "POST") {
    const partes = [];
    req.on("data", (parte) => partes.push(parte));
    req.on("end", () => {
      tokenSolicitado += 1;
      assert.match(req.headers["content-type"] ?? "", /x-www-form-urlencoded/);
      const formulario = new URLSearchParams(Buffer.concat(partes).toString());
      assert.equal(formulario.get("grant_type"), "client_credentials");
      assert.equal(formulario.get("client_id"), "cliente-de-homologacao");
      assert.equal(formulario.has("client_secret"), false);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          access_token: "token-de-homologacao-seguro",
          expires_in: 300,
          token_type: "Bearer",
        }),
      );
    });
    return;
  }
  if (req.url === "/health" && req.method === "GET") {
    healthSolicitado += 1;
    assert.equal(
      req.headers.authorization,
      "Bearer token-de-homologacao-seguro",
    );
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "UP" }));
    return;
  }
  if (req.url === "/boletos" && req.method === "POST") {
    const partes = [];
    req.on("data", (parte) => partes.push(parte));
    req.on("end", () => {
      boletoIncluido += 1;
      const corpo = JSON.parse(Buffer.concat(partes).toString("utf8"));
      assert.equal(corpo.valor, 123.45);
      assert.equal(corpo.pagador.numeroCpfCnpj, "52998224725");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ resultado: { nossoNumero: 987654321 } }));
    });
    return;
  }
  if (req.url?.startsWith("/boletos?") && req.method === "GET") {
    boletoConsultado += 1;
    const consulta = new URL(req.url, "http://localhost");
    assert.equal(consulta.searchParams.get("numeroCliente"), "123");
    assert.equal(consulta.searchParams.get("codigoModalidade"), "1");
    assert.equal(consulta.searchParams.get("nossoNumero"), "987654321");
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        resultado: { nossoNumero: 987654321, situacaoBoleto: "Em Aberto" },
      }),
    );
    return;
  }
  res.statusCode = 404;
  res.end();
});

await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
const endereco = servidor.address();
const origem = `http://127.0.0.1:${endereco.port}`;
try {
  const integracao = criarIntegracaoSicoob({
    permitirHttpLocal: true,
    criarAgenteMtls: () => undefined,
    variaveis: {
      NODE_ENV: "test",
      SICOOB_AMBIENTE: "homologacao",
      SICOOB_CONTA_REFERENCIA: "conta-interna-teste",
      SICOOB_HOMOLOGACAO_API_BASE_URL: origem,
      SICOOB_HOMOLOGACAO_OAUTH_TOKEN_URL: `${origem}/token`,
      SICOOB_HOMOLOGACAO_CLIENT_ID: "cliente-de-homologacao",
      SICOOB_HOMOLOGACAO_OAUTH_SCOPE: "boletos_consulta",
      SICOOB_HOMOLOGACAO_CONTRATO_VERSAO: "cobranca-v3",
      SICOOB_HOMOLOGACAO_MTLS_PFX_PATH: "certificado-teste.pfx",
    },
    contratoCobranca: {
      criarRequisicaoRegistro() {
        return { metodo: "POST", caminho: "/boletos", corpo: {} };
      },
      interpretarRegistro() {
        return { categoria: "rejeitada", codigo: "NAO_USADO" };
      },
      criarRequisicaoConsulta() {
        return { metodo: "GET", caminho: "/boletos" };
      },
      interpretarConsulta() {
        return { categoria: "nao_encontrada", codigo: "NAO_USADO" };
      },
    },
  });
  assert.deepEqual(await integracao.diagnostico.consultarSaude(), {
    disponivel: true,
    status: "UP",
  });
  assert.equal(tokenSolicitado, 1);
  assert.equal(healthSolicitado, 1);

  const integracaoComCobranca = criarIntegracaoSicoob({
    permitirHttpLocal: true,
    criarAgenteMtls: () => undefined,
    relogio: () => Date.parse("2026-10-22T12:00:00Z"),
    variaveis: {
      NODE_ENV: "test",
      SICOOB_AMBIENTE: "homologacao",
      SICOOB_CONTA_REFERENCIA: "conta-interna-teste",
      SICOOB_HOMOLOGACAO_API_BASE_URL: origem,
      SICOOB_HOMOLOGACAO_OAUTH_TOKEN_URL: `${origem}/token`,
      SICOOB_HOMOLOGACAO_CLIENT_ID: "cliente-de-homologacao",
      SICOOB_HOMOLOGACAO_OAUTH_SCOPE: "boletos_consulta boletos_inclusao",
      SICOOB_HOMOLOGACAO_CONTRATO_VERSAO: "cobranca-v3",
      SICOOB_HOMOLOGACAO_MTLS_PFX_PATH: "certificado-teste.pfx",
      SICOOB_HOMOLOGACAO_COBRANCA_NUMERO_CLIENTE: "123",
      SICOOB_HOMOLOGACAO_COBRANCA_CODIGO_MODALIDADE: "1",
      SICOOB_HOMOLOGACAO_COBRANCA_NUMERO_CONTA_CORRENTE: "456",
      SICOOB_HOMOLOGACAO_COBRANCA_ESPECIE_DOCUMENTO: "DM",
      SICOOB_HOMOLOGACAO_COBRANCA_IDENTIFICACAO_EMISSAO: "1",
      SICOOB_HOMOLOGACAO_COBRANCA_IDENTIFICACAO_DISTRIBUICAO: "1",
      SICOOB_HOMOLOGACAO_COBRANCA_NUMERO_CONTRATO: "789",
    },
  });
  const entradaAdaptador = {
    idempotencia: entrada.operacao.idempotencia,
    snapshot: {
      cliente: entrada.pagador,
      unidade: { uc: "123456789" },
      cobranca: {
        valor_centavos: entrada.operacao.valorCentavos,
        vencimento: entrada.operacao.vencimento,
      },
    },
  };
  const registroRealista =
    await integracaoComCobranca.adaptador.registrarCobranca(entradaAdaptador);
  assert.equal(registroRealista.provedor_id, "987654321");
  const consultaRealista =
    await integracaoComCobranca.adaptador.consultarCobranca({
      provedor_id: registroRealista.provedor_id,
    });
  assert.equal(consultaRealista.estado, "registrada");
  assert.equal(boletoIncluido, 1);
  assert.equal(boletoConsultado, 1);
} finally {
  servidor.closeAllConnections();
  await new Promise((resolve, reject) =>
    servidor.close((erro) => (erro ? reject(erro) : resolve())),
  );
}

console.log(
  "OK: contratos oficiais Sicoob validam Client Credentials, health e mapeamento sem presumir dados do convênio.",
);
