import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-prontidao-"));
process.env.NODE_ENV = "test";

const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { avaliarProntidaoSicoob } =
  await import("../servidor/bancario/prontidaoSicoob.mjs");

const banco = obterBanco();

const incompleta = avaliarProntidaoSicoob({
  banco,
  variaveis: { NODE_ENV: "test", SICOOB_AMBIENTE: "homologacao" },
});
assert.equal(incompleta.estado, "incompleta");
assert.equal(incompleta.configuracao_consulta_completa, false);
assert.equal(incompleta.configuracao_emissao_completa, false);
assert.equal(incompleta.executor_real_disponivel, false);
assert.equal(incompleta.executor_pausado, true);
assert.ok(incompleta.pendencias.includes("MTLS_INCOMPLETO"));

const base = {
  NODE_ENV: "test",
  SICOOB_AMBIENTE: "homologacao",
  SICOOB_CONTA_REFERENCIA: "conta-interna",
  SICOOB_HOMOLOGACAO_API_BASE_URL: "http://127.0.0.1:4100/api/",
  SICOOB_HOMOLOGACAO_OAUTH_TOKEN_URL: "http://127.0.0.1:4100/token",
  SICOOB_HOMOLOGACAO_CLIENT_ID: "cliente-teste",
  SICOOB_HOMOLOGACAO_CLIENT_SECRET: "nao-deve-aparecer",
  SICOOB_HOMOLOGACAO_OAUTH_SCOPE: "cobranca.write cobranca.read",
  SICOOB_HOMOLOGACAO_MTLS_CERT_PATH: "certificado-teste.pem",
  SICOOB_HOMOLOGACAO_MTLS_KEY_PATH: "chave-teste.pem",
  SICOOB_HOMOLOGACAO_MTLS_KEY_PASSPHRASE: "tambem-nao-deve-aparecer",
  SICOOB_HOMOLOGACAO_CONTRATO_VERSAO: "cobranca-v3",
  SICOOB_HOMOLOGACAO_COBRANCA_NUMERO_CLIENTE: "123",
  SICOOB_HOMOLOGACAO_COBRANCA_CODIGO_MODALIDADE: "1",
};

const somenteConsulta = avaliarProntidaoSicoob({ banco, variaveis: base });
assert.equal(somenteConsulta.estado, "somente_consulta");
assert.equal(somenteConsulta.configuracao_consulta_completa, true);
assert.equal(somenteConsulta.configuracao_emissao_completa, false);
assert.deepEqual(somenteConsulta.pendencias, ["CONVENIO_EMISSAO_INCOMPLETO"]);
const serializado = JSON.stringify(somenteConsulta);
assert.doesNotMatch(serializado, /nao-deve-aparecer|tambem-nao-deve-aparecer/);
assert.doesNotMatch(serializado, /certificado-teste|chave-teste/);

const completa = avaliarProntidaoSicoob({
  banco,
  variaveis: {
    ...base,
    SICOOB_HOMOLOGACAO_COBRANCA_NUMERO_CONTA_CORRENTE: "456",
    SICOOB_HOMOLOGACAO_COBRANCA_ESPECIE_DOCUMENTO: "DM",
    SICOOB_HOMOLOGACAO_COBRANCA_IDENTIFICACAO_EMISSAO: "1",
    SICOOB_HOMOLOGACAO_COBRANCA_IDENTIFICACAO_DISTRIBUICAO: "1",
  },
});
assert.equal(
  completa.estado,
  "configuracao_completa_executor_nao_implementado",
);
assert.equal(completa.configuracao_emissao_completa, true);
assert.equal(completa.executor_real_disponivel, false);
assert.deepEqual(completa.pendencias, []);

const invalida = avaliarProntidaoSicoob({
  banco,
  variaveis: {
    NODE_ENV: "production",
    SICOOB_AMBIENTE: "producao",
    SICOOB_PRODUCAO_API_BASE_URL: "http://inseguro.exemplo/api",
  },
});
assert.deepEqual(invalida, {
  estado: "configuracao_invalida",
  ambiente: null,
  executor_pausado: true,
  configuracao_consulta_completa: false,
  configuracao_emissao_completa: false,
  executor_real_disponivel: false,
  pendencias: ["CONFIGURACAO_SICOOB_INVALIDA"],
});

console.log("Prontidão Sicoob: diagnóstico mascarado validado.");
