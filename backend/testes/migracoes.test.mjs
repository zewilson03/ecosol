import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  estadoDasMigracoes,
  registrarBaselineDoEsquema,
  removerTabelasMfaLegado,
} from "../servidor/persistencia/migracoes.mjs";

const tabelasMfaLegado = [
  "bancario_mfa_equipe",
  "bancario_mfa_recuperacao",
  "bancario_mfa_auditoria",
  "bancario_mfa_pedidos_recuperacao",
  "bancario_mfa_aprovacoes_recuperacao",
  "bancario_mfa_auditoria_recuperacao",
];

function criarTabelasMfaLegado(banco) {
  banco.exec(`
    CREATE TABLE bancario_mfa_equipe(id INTEGER PRIMARY KEY);
    CREATE TABLE bancario_mfa_recuperacao(id INTEGER PRIMARY KEY);
    CREATE TABLE bancario_mfa_auditoria(id INTEGER PRIMARY KEY);
    CREATE TABLE bancario_mfa_pedidos_recuperacao(id INTEGER PRIMARY KEY);
    CREATE TABLE bancario_mfa_aprovacoes_recuperacao(
      id INTEGER PRIMARY KEY,
      pedido_id INTEGER REFERENCES bancario_mfa_pedidos_recuperacao(id)
    );
    CREATE TABLE bancario_mfa_auditoria_recuperacao(id INTEGER PRIMARY KEY);
  `);
}

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
criarTabelasMfaLegado(banco);
registrarBaselineDoEsquema(banco, { ECOSOL_APP_COMMIT: "teste" });
registrarBaselineDoEsquema(banco, { ECOSOL_APP_COMMIT: "outro" });
assert.equal(estadoDasMigracoes(banco).integra, false);
removerTabelasMfaLegado(banco, { ECOSOL_APP_COMMIT: "teste" });
removerTabelasMfaLegado(banco);
assert.deepEqual(estadoDasMigracoes(banco), {
  atual: 2,
  esperada: 2,
  integra: true,
});
for (const nome of tabelasMfaLegado)
  assert.equal(
    banco
      .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?")
      .get(nome),
    undefined,
  );
assert.equal(
  banco.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get().total,
  2,
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
    "INSERT INTO schema_migrations(version,name,checksum_sha256,duration_ms) VALUES(3,'futura',?,0)",
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

const comRegistros = bancoCompativel();
criarTabelasMfaLegado(comRegistros);
registrarBaselineDoEsquema(comRegistros);
comRegistros.exec("INSERT INTO bancario_mfa_equipe(id) VALUES(1)");
assert.throws(
  () => removerTabelasMfaLegado(comRegistros),
  /contém registros; remoção cancelada/,
);
assert.equal(
  comRegistros.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get()
    .total,
  1,
);
assert.equal(
  comRegistros
    .prepare("SELECT 1 FROM sqlite_schema WHERE name='bancario_mfa_equipe'")
    .get()["1"],
  1,
);
comRegistros.close();

const comDependencia = bancoCompativel();
criarTabelasMfaLegado(comDependencia);
registrarBaselineDoEsquema(comDependencia);
comDependencia.exec(
  "CREATE VIEW vista_mfa_externa AS SELECT id FROM bancario_mfa_equipe",
);
assert.throws(
  () => removerTabelasMfaLegado(comDependencia),
  /objetos externos dependentes/,
);
comDependencia.close();

const novo = bancoCompativel();
registrarBaselineDoEsquema(novo);
removerTabelasMfaLegado(novo);
assert.equal(estadoDasMigracoes(novo).integra, true);
novo.close();

console.log(
  "OK: migrações versionadas, MFA vazio removido e dados preservados.",
);
