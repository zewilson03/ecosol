import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  estadoDasMigracoes,
  registrarBaselineDoEsquema,
} from "../servidor/persistencia/migracoes.mjs";

function bancoCompativel() {
  const banco = new DatabaseSync(":memory:");
  banco.exec(`
    CREATE TABLE customers(id INTEGER PRIMARY KEY,name,cpf,email,password_hash);
    CREATE TABLE staff_users(id INTEGER PRIMARY KEY,name,email,password_hash,access_level);
    CREATE TABLE sessions(id INTEGER PRIMARY KEY,staff_id,token_hash,role,expires_at);
    CREATE TABLE usinas(id INTEGER PRIMARY KEY,nome,status,versao);
    CREATE TABLE faturamento_unidades(id INTEGER PRIMARY KEY,uc,nome,usina_id,versao);
    CREATE TABLE faturamento_documentos(id INTEGER PRIMARY KEY,hash,dados,memoria,status,versao,unidade_id,competencia);
    CREATE TABLE gmail_contas(id INTEGER PRIMARY KEY,email,data_inicio,status_autorizacao);
    CREATE TABLE bancario_operacoes(id INTEGER PRIMARY KEY,idempotencia,valor_centavos,estado,versao,atualizado_em);
    CREATE TABLE financeiro_solicitacoes_pagamento(id INTEGER PRIMARY KEY,valor_centavos,status,versao,vencimento);
    CREATE UNIQUE INDEX faturamento_unidade_competencia ON faturamento_documentos(unidade_id,competencia);
    CREATE INDEX bancario_operacoes_estado ON bancario_operacoes(estado,atualizado_em);
    CREATE INDEX financeiro_solicitacoes_status ON financeiro_solicitacoes_pagamento(status,vencimento,id);
    CREATE TRIGGER bancario_operacao_transicao_valida BEFORE UPDATE ON bancario_operacoes BEGIN SELECT 1; END;
    CREATE TRIGGER bancario_pagamento_aprovacao_exige_proprietario BEFORE UPDATE ON bancario_operacoes BEGIN SELECT 1; END;
  `);
  return banco;
}

const banco = bancoCompativel();
registrarBaselineDoEsquema(banco, { ECOSOL_APP_COMMIT: "teste" });
registrarBaselineDoEsquema(banco, { ECOSOL_APP_COMMIT: "outro" });
assert.deepEqual(estadoDasMigracoes(banco), {
  atual: 1,
  esperada: 1,
  integra: true,
});
assert.equal(
  banco.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total,
  1,
);
banco.exec("DROP TRIGGER bancario_operacao_transicao_valida");
assert.equal(estadoDasMigracoes(banco).integra, false);
banco.exec(
  "CREATE TRIGGER bancario_operacao_transicao_valida BEFORE UPDATE ON bancario_operacoes BEGIN SELECT 1; END",
);
const checksumCorreto = banco
  .prepare("SELECT checksum_sha256 FROM schema_migrations WHERE version=1")
  .get().checksum_sha256;

banco
  .prepare("UPDATE schema_migrations SET checksum_sha256=? WHERE version=1")
  .run("0".repeat(64));
assert.throws(
  () => registrarBaselineDoEsquema(banco),
  /Checksum da migração baseline não confere/,
);
banco
  .prepare("UPDATE schema_migrations SET checksum_sha256=? WHERE version=1")
  .run(checksumCorreto);
banco
  .prepare(
    "INSERT INTO schema_migrations(version,name,checksum_sha256,duration_ms) VALUES(2,'futura',?,0)",
  )
  .run("1".repeat(64));
assert.throws(
  () => registrarBaselineDoEsquema(banco),
  /versão de schema mais nova/,
);
banco.close();

const incompleto = new DatabaseSync(":memory:");
assert.throws(
  () => registrarBaselineDoEsquema(incompleto),
  /Esquema incompatível com o baseline/,
);
assert.equal(
  incompleto
    .prepare(
      "SELECT COUNT(*) AS total FROM sqlite_schema WHERE type='table' AND name='schema_migrations'",
    )
    .get().total,
  0,
);
incompleto.close();

console.log("OK: baseline versionado, idempotente e protegido por checksum.");
