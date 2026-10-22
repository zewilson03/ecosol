import assert from "node:assert/strict";
import { createServer } from "node:http";

process.env.NODE_ENV = "test";

const { contratoOAuthSicoob } =
  await import("../servidor/bancario/contratoOAuthSicoob.mjs");
const { mapearCobrancaParaSicoob } =
  await import("../servidor/bancario/mapeamentoCobrancaSicoob.mjs");
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
    numeroContratoCobranca: 789,
    tipoFormularioImpressaoPDF: 1,
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
  res.statusCode = 404;
  res.end();
});

await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
const endereco = servidor.address();
const origem = `http://127.0.0.1:${endereco.port}`;
try {
  const integracao = criarIntegracaoSicoob({
    permitirHttpLocal: true,
    variaveis: {
      NODE_ENV: "test",
      SICOOB_AMBIENTE: "homologacao",
      SICOOB_CONTA_REFERENCIA: "conta-interna-teste",
      SICOOB_HOMOLOGACAO_API_BASE_URL: origem,
      SICOOB_HOMOLOGACAO_OAUTH_TOKEN_URL: `${origem}/token`,
      SICOOB_HOMOLOGACAO_CLIENT_ID: "cliente-de-homologacao",
      SICOOB_HOMOLOGACAO_OAUTH_SCOPE: "boletos_consulta",
      SICOOB_HOMOLOGACAO_CONTRATO_VERSAO: "cobranca-v3",
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
} finally {
  servidor.closeAllConnections();
  await new Promise((resolve, reject) =>
    servidor.close((erro) => (erro ? reject(erro) : resolve())),
  );
}

console.log(
  "OK: contratos oficiais Sicoob validam Client Credentials, health e mapeamento sem presumir dados do convênio.",
);
