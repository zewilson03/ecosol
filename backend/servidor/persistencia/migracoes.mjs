import { createHash } from "node:crypto";

const BASELINE = {
  versao: 1,
  nome: "baseline-monolito-modular-2026-10-26",
  conteudo:
    "core+faturamento+gmail+bancario+financeiro existentes antes do executor versionado",
};

const REMOCAO_MFA = {
  versao: 2,
  nome: "remover-tabelas-mfa-legado-2026-10-27",
  conteudo: "remocao das seis tabelas vazias do MFA desativado",
};

const tabelasMfaLegado = [
  "bancario_mfa_aprovacoes_recuperacao",
  "bancario_mfa_auditoria_recuperacao",
  "bancario_mfa_pedidos_recuperacao",
  "bancario_mfa_recuperacao",
  "bancario_mfa_auditoria",
  "bancario_mfa_equipe",
];

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
    if (versaoMaisNova > REMOCAO_MFA.versao)
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

export function removerTabelasMfaLegado(banco, ambiente = process.env) {
  const inicio = Date.now();
  banco.exec("BEGIN IMMEDIATE");
  try {
    const baseline = banco
      .prepare(
        "SELECT name,checksum_sha256 FROM schema_migrations WHERE version=1",
      )
      .get();
    if (
      !baseline ||
      baseline.name !== BASELINE.nome ||
      baseline.checksum_sha256 !== checksum(BASELINE)
    )
      throw new Error("Baseline ausente ou incompatível para remoção do MFA.");

    const versaoMaisNova = banco
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get().version;
    if (versaoMaisNova > REMOCAO_MFA.versao)
      throw new Error(
        "O banco usa uma versão de schema mais nova que esta aplicação.",
      );

    const existente = banco
      .prepare(
        "SELECT name,checksum_sha256 FROM schema_migrations WHERE version=2",
      )
      .get();
    if (
      existente &&
      (existente.name !== REMOCAO_MFA.nome ||
        existente.checksum_sha256 !== checksum(REMOCAO_MFA))
    )
      throw new Error("Checksum da migração de remoção do MFA não confere.");

    const presentes = tabelasMfaLegado.filter((nome) =>
      banco
        .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?")
        .get(nome),
    );
    if (existente && presentes.length)
      throw new Error("Tabelas de MFA reapareceram após a migração.");
    if (existente) {
      banco.exec("COMMIT");
      return;
    }

    for (const nome of presentes) {
      const possuiRegistros = banco
        .prepare(`SELECT EXISTS(SELECT 1 FROM "${nome}" LIMIT 1) AS presente`)
        .get().presente;
      if (possuiRegistros)
        throw new Error(`Tabela ${nome} contém registros; remoção cancelada.`);
    }

    const outrasDependencias = banco
      .prepare(
        "SELECT type,name FROM sqlite_schema WHERE type IN ('table','view','trigger') AND tbl_name NOT IN (" +
          tabelasMfaLegado.map(() => "?").join(",") +
          ") AND sql LIKE '%bancario_mfa_%'",
      )
      .all(...tabelasMfaLegado);
    if (outrasDependencias.length)
      throw new Error("Há objetos externos dependentes das tabelas de MFA.");

    for (const nome of presentes) banco.exec(`DROP TABLE "${nome}"`);
    banco
      .prepare(
        `INSERT INTO schema_migrations
          (version,name,checksum_sha256,duration_ms,app_commit)
         VALUES (?,?,?,?,?)`,
      )
      .run(
        REMOCAO_MFA.versao,
        REMOCAO_MFA.nome,
        checksum(REMOCAO_MFA),
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
    esperada: REMOCAO_MFA.versao,
    integra:
      estruturaIntegra &&
      atual === REMOCAO_MFA.versao &&
      aplicadas.some(
        (item) =>
          item.version === BASELINE.versao &&
          item.name === BASELINE.nome &&
          item.checksum_sha256 === checksum(BASELINE),
      ) &&
      aplicadas.some(
        (item) =>
          item.version === REMOCAO_MFA.versao &&
          item.name === REMOCAO_MFA.nome &&
          item.checksum_sha256 === checksum(REMOCAO_MFA),
      ) &&
      tabelasMfaLegado.every(
        (nome) =>
          !banco
            .prepare(
              "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?",
            )
            .get(nome),
      ),
  };
}
