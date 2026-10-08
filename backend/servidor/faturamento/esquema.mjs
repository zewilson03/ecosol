export function prepararFaturamento(banco) {
  // Migração aditiva: preserva cadastros, sessões e o financeiro existente.
  banco.exec(`
    CREATE TABLE IF NOT EXISTS faturamento_unidades (
      id INTEGER PRIMARY KEY, uc TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
      documento TEXT NOT NULL, email TEXT NOT NULL, dia_vencimento INTEGER NOT NULL,
      versao INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS faturamento_clientes_provisorios (
      id INTEGER PRIMARY KEY, nome TEXT NOT NULL, chave_origem TEXT NOT NULL UNIQUE,
      origem TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS faturamento_descontos_uc (
      id INTEGER PRIMARY KEY, unidade_id INTEGER NOT NULL, inicio TEXT NOT NULL,
      desconto TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(unidade_id,inicio)
    );
    CREATE INDEX IF NOT EXISTS faturamento_descontos_uc_vigencia
      ON faturamento_descontos_uc(unidade_id,inicio DESC);
    CREATE TABLE IF NOT EXISTS faturamento_contratos (
      id INTEGER PRIMARY KEY, unidade_id INTEGER NOT NULL, modalidade TEXT NOT NULL,
      desconto TEXT NOT NULL, inicio TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(unidade_id, inicio)
    );
    CREATE TABLE IF NOT EXISTS faturamento_documentos (
      id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
      pdf BLOB NOT NULL, lote TEXT NOT NULL, texto TEXT NOT NULL,
      extracao TEXT NOT NULL, dados TEXT NOT NULL, memoria TEXT,
      unidade_id INTEGER, competencia TEXT,
      status TEXT NOT NULL DEFAULT 'Pendente de revisão',
      classificacao TEXT NOT NULL DEFAULT 'fatura'
        CHECK(classificacao IN ('fatura','triagem','nao_fatura')),
      excluido_em TEXT,
      versao INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS faturamento_unidade_competencia
      ON faturamento_documentos(unidade_id, competencia)
      WHERE unidade_id IS NOT NULL AND competencia IS NOT NULL;
    CREATE TABLE IF NOT EXISTS faturamento_historico (
      id INTEGER PRIMARY KEY, documento_id INTEGER, unidade_id INTEGER,
      responsavel TEXT NOT NULL, administrador_id INTEGER, acao TEXT NOT NULL,
      dados TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS faturamento_recebimentos_pdf (
      id INTEGER PRIMARY KEY, hash TEXT, nome TEXT NOT NULL, lote TEXT NOT NULL,
      resultado TEXT NOT NULL, codigo TEXT NOT NULL, motivo TEXT NOT NULL,
      documento_id INTEGER, responsavel TEXT NOT NULL,
      origem TEXT NOT NULL DEFAULT 'legado'
        CHECK(origem IN ('legado','manual','gmail')),
      gmail_anexo_id INTEGER,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  if (
    !banco
      .prepare("PRAGMA table_info(faturamento_documentos)")
      .all()
      .some((c) => c.name === "classificacao")
  ) {
    banco.exec(
      "ALTER TABLE faturamento_documentos ADD COLUMN classificacao TEXT NOT NULL DEFAULT 'fatura' CHECK(classificacao IN ('fatura','triagem','nao_fatura'))",
    );
  }
  if (
    !banco
      .prepare("PRAGMA table_info(faturamento_documentos)")
      .all()
      .some((c) => c.name === "excluido_em")
  ) {
    banco.exec(
      "ALTER TABLE faturamento_documentos ADD COLUMN excluido_em TEXT",
    );
  }
  if (
    !banco
      .prepare("PRAGMA table_info(faturamento_recebimentos_pdf)")
      .all()
      .some((c) => c.name === "origem")
  ) {
    banco.exec(
      "ALTER TABLE faturamento_recebimentos_pdf ADD COLUMN origem TEXT NOT NULL DEFAULT 'legado' CHECK(origem IN ('legado','manual','gmail'))",
    );
  }
  if (
    !banco
      .prepare("PRAGMA table_info(faturamento_recebimentos_pdf)")
      .all()
      .some((c) => c.name === "gmail_anexo_id")
  ) {
    banco.exec(
      "ALTER TABLE faturamento_recebimentos_pdf ADD COLUMN gmail_anexo_id INTEGER",
    );
  }
  banco.exec(`CREATE UNIQUE INDEX IF NOT EXISTS faturamento_recebimento_gmail_anexo
    ON faturamento_recebimentos_pdf(gmail_anexo_id)
    WHERE gmail_anexo_id IS NOT NULL`);
  if (
    !banco
      .prepare("PRAGMA table_info(faturamento_unidades)")
      .all()
      .some((c) => c.name === "usina_id")
  ) {
    banco.exec("ALTER TABLE faturamento_unidades ADD COLUMN usina_id INTEGER");
  }
  if (
    !banco
      .prepare("PRAGMA table_info(faturamento_unidades)")
      .all()
      .some((c) => c.name === "cliente_id")
  ) {
    banco.exec(
      "ALTER TABLE faturamento_unidades ADD COLUMN cliente_id INTEGER",
    );
  }
  if (
    !banco
      .prepare("PRAGMA table_info(faturamento_unidades)")
      .all()
      .some((c) => c.name === "cliente_provisorio_id")
  ) {
    banco.exec(
      "ALTER TABLE faturamento_unidades ADD COLUMN cliente_provisorio_id INTEGER",
    );
  }
  banco.exec(`CREATE INDEX IF NOT EXISTS faturamento_unidades_cliente
    ON faturamento_unidades(cliente_id) WHERE cliente_id IS NOT NULL`);
  banco.exec(`CREATE INDEX IF NOT EXISTS faturamento_unidades_provisorio
    ON faturamento_unidades(cliente_provisorio_id)
    WHERE cliente_provisorio_id IS NOT NULL`);
  banco.exec(`CREATE TABLE IF NOT EXISTS faturamento_importacoes (
    id TEXT PRIMARY KEY, responsavel_id INTEGER, nome TEXT NOT NULL, hash TEXT NOT NULL,
    usina_id INTEGER NOT NULL, abas TEXT NOT NULL, previa TEXT, previa_id TEXT,
    status TEXT NOT NULL DEFAULT 'Pendente', quantidade INTEGER NOT NULL DEFAULT 0,
    expira_em INTEGER NOT NULL, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  banco.exec(`
    INSERT INTO faturamento_recebimentos_pdf
      (hash,nome,lote,resultado,codigo,motivo,documento_id,responsavel,criado_em)
    SELECT d.hash,d.nome,d.lote,'Recebida','ok',
      'PDF recebido. Confira os dados extraídos antes de calcular.',d.id,
      'Importação anterior',d.criado_em
    FROM faturamento_documentos d
    WHERE NOT EXISTS (
      SELECT 1 FROM faturamento_recebimentos_pdf r WHERE r.documento_id=d.id
    );
  `);
}
