import { createHash } from "node:crypto";

const BASELINE = {
  versao: 1,
  nome: "baseline-monolito-modular-2026-10-26",
  conteudo:
    "core+faturamento+gmail+bancario+financeiro existentes antes do executor versionado",
};

const assinaturaDoBaseline = {
  customers: ["id", "name", "cpf", "email", "password_hash"],
  staff_users: ["id", "name", "email", "password_hash", "access_level"],
  sessions: ["id", "staff_id", "token_hash", "role", "expires_at"],
  usinas: ["id", "nome", "status", "versao"],
  faturamento_unidades: ["id", "uc", "nome", "usina_id", "versao"],
  faturamento_documentos: [
    "id",
    "hash",
    "dados",
    "memoria",
    "status",
    "versao",
  ],
  gmail_contas: ["id", "email", "data_inicio", "status_autorizacao"],
  bancario_operacoes: [
    "id",
    "idempotencia",
    "valor_centavos",
    "estado",
    "versao",
  ],
  financeiro_solicitacoes_pagamento: [
    "id",
    "valor_centavos",
    "status",
    "versao",
  ],
};
const estruturasCriticas = [
  ["index", "faturamento_unidade_competencia"],
  ["index", "bancario_operacoes_estado"],
  ["index", "financeiro_solicitacoes_status"],
  ["trigger", "bancario_operacao_transicao_valida"],
  ["trigger", "bancario_pagamento_aprovacao_exige_proprietario"],
];

function checksum(migracao) {
  return createHash("sha256")
    .update(
      `${migracao.versao}\n${migracao.nome}\n${migracao.conteudo}\n${JSON.stringify(assinaturaDoBaseline)}\n${JSON.stringify(estruturasCriticas)}`,
    )
    .digest("hex");
}

function criarLedger(banco) {
  banco.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum_sha256 TEXT NOT NULL CHECK(length(checksum_sha256)=64),
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      duration_ms INTEGER NOT NULL CHECK(duration_ms>=0),
      app_commit TEXT
    )
  `);
}

function verificarBaseline(banco) {
  const existentes = new Set(
    banco
      .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
      .all()
      .map(({ name }) => name),
  );
  const ausentes = [];
  for (const [tabela, colunasObrigatorias] of Object.entries(
    assinaturaDoBaseline,
  )) {
    if (!existentes.has(tabela)) {
      ausentes.push(tabela);
      continue;
    }
    const colunas = new Set(
      banco
        .prepare(`PRAGMA table_info(${tabela})`)
        .all()
        .map(({ name }) => name),
    );
    for (const coluna of colunasObrigatorias)
      if (!colunas.has(coluna)) ausentes.push(`${tabela}.${coluna}`);
  }
  for (const [tipo, nome] of estruturasCriticas) {
    const existe = banco
      .prepare("SELECT 1 FROM sqlite_schema WHERE type=? AND name=?")
      .get(tipo, nome);
    if (!existe) ausentes.push(`${tipo}:${nome}`);
  }
  if (ausentes.length)
    throw new Error(
      `Esquema incompatível com o baseline: ${ausentes.join(", ")}`,
    );
}

/**
 * Registra o estado compatível anterior às migrações numeradas.
 *
 * Durante a transição, os preparadores legados ainda executam antes deste
 * registro. O ledger já impede alteração retroativa do baseline e fornece a
 * base para mover cada DDL futuro a migrações imutáveis.
 */
export function registrarBaselineDoEsquema(banco, ambiente = process.env) {
  const inicio = Date.now();
  banco.exec("BEGIN IMMEDIATE");
  try {
    criarLedger(banco);
    verificarBaseline(banco);
    const esperado = checksum(BASELINE);
    const existente = banco
      .prepare(
        "SELECT name,checksum_sha256 FROM schema_migrations WHERE version=?",
      )
      .get(BASELINE.versao);
    const versaoMaisNova = banco
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get().version;
    if (versaoMaisNova > BASELINE.versao)
      throw new Error(
        "O banco usa uma versão de schema mais nova que esta aplicação.",
      );
    if (existente) {
      if (
        existente.name !== BASELINE.nome ||
        existente.checksum_sha256 !== esperado
      )
        throw new Error("Checksum da migração baseline não confere.");
      banco.exec("COMMIT");
      return;
    }
    banco
      .prepare(
        `INSERT INTO schema_migrations
          (version,name,checksum_sha256,duration_ms,app_commit)
         VALUES (?,?,?,?,?)`,
      )
      .run(
        BASELINE.versao,
        BASELINE.nome,
        esperado,
        Date.now() - inicio,
        ambiente.ECOSOL_APP_COMMIT || null,
      );
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

export function estadoDasMigracoes(banco) {
  criarLedger(banco);
  const aplicadas = banco
    .prepare(
      "SELECT version,name,checksum_sha256,applied_at,duration_ms,app_commit FROM schema_migrations ORDER BY version",
    )
    .all();
  const atual = aplicadas.at(-1)?.version ?? 0;
  let estruturaIntegra = true;
  try {
    verificarBaseline(banco);
  } catch {
    estruturaIntegra = false;
  }
  return {
    atual,
    esperada: BASELINE.versao,
    integra:
      estruturaIntegra &&
      atual === BASELINE.versao &&
      aplicadas.some(
        (item) =>
          item.version === BASELINE.versao &&
          item.name === BASELINE.nome &&
          item.checksum_sha256 === checksum(BASELINE),
      ),
  };
}
