export function prepararFaturamento(banco) {
  // Migração aditiva: preserva cadastros, sessões e o financeiro existente.
  banco.exec(`
    CREATE TABLE IF NOT EXISTS usinas_modalidades (
      id INTEGER PRIMARY KEY, usina_id INTEGER NOT NULL,
      inicio TEXT NOT NULL, modalidade TEXT NOT NULL
        CHECK(modalidade IN ('GDI','GDII')),
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usina_id,inicio)
    );
    CREATE INDEX IF NOT EXISTS usinas_modalidades_vigencia
      ON usinas_modalidades(usina_id,inicio DESC);
    CREATE TABLE IF NOT EXISTS usinas_identificadores_geracao (
      id INTEGER PRIMARY KEY,
      usina_id INTEGER NOT NULL REFERENCES usinas(id) ON DELETE RESTRICT,
      numero TEXT NOT NULL CHECK(numero<>'' AND numero NOT GLOB '*[^0-9]*'),
      tipo TEXT NOT NULL CHECK(tipo IN ('atual','historico')),
      origem TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usina_id,numero)
    );
    CREATE INDEX IF NOT EXISTS usinas_identificadores_numero
      ON usinas_identificadores_geracao(numero);
    CREATE TABLE IF NOT EXISTS usinas_importacoes_vinculos (
      id TEXT PRIMARY KEY, responsavel_id INTEGER NOT NULL,
      nome TEXT NOT NULL, hash TEXT NOT NULL, aba TEXT NOT NULL,
      linhas TEXT NOT NULL, previa TEXT, previa_id TEXT,
      status TEXT NOT NULL DEFAULT 'Pendente'
        CHECK(status IN ('Pendente','Concluída','Expirada')),
      expira_em INTEGER NOT NULL, quantidade INTEGER NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS faturamento_vinculos_usina (
      id INTEGER PRIMARY KEY, unidade_id INTEGER NOT NULL,
      inicio TEXT NOT NULL, usina_id INTEGER NOT NULL,
      origem_usina_id INTEGER, transferencia_id TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(unidade_id,inicio)
    );
    CREATE INDEX IF NOT EXISTS faturamento_vinculos_usina_vigencia
      ON faturamento_vinculos_usina(unidade_id,inicio DESC);
    CREATE TABLE IF NOT EXISTS faturamento_transferencias_usina (
      id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL,
      resultado TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS faturamento_saidas_carteira (
      id INTEGER PRIMARY KEY,
      unidade_id INTEGER NOT NULL UNIQUE REFERENCES faturamento_unidades(id) ON DELETE RESTRICT,
      inicio TEXT NOT NULL CHECK(inicio GLOB '20[0-9][0-9]-[0-1][0-9]'),
      data_efetiva TEXT,
      destino_externo TEXT NOT NULL CHECK(destino_externo<>''),
      evidencia TEXT NOT NULL CHECK(evidencia<>''),
      operacao_id TEXT NOT NULL UNIQUE,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS faturamento_saidas_carteira_vigencia
      ON faturamento_saidas_carteira(unidade_id,inicio);
    CREATE TABLE IF NOT EXISTS faturamento_unidades (
      id INTEGER PRIMARY KEY, uc TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
      documento TEXT NOT NULL, email TEXT NOT NULL, dia_vencimento INTEGER NOT NULL,
      versao INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS faturamento_clientes_provisorios (
      id INTEGER PRIMARY KEY, nome TEXT NOT NULL, chave_origem TEXT NOT NULL UNIQUE,
      origem TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS faturamento_clientes_operacionais (
      id INTEGER PRIMARY KEY,
      referencia_interna TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      origem_provisorio_id INTEGER NOT NULL UNIQUE,
      situacao TEXT NOT NULL DEFAULT 'Documentação pendente'
        CHECK(situacao='Documentação pendente'),
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      finalidade TEXT NOT NULL DEFAULT 'cobranca'
        CHECK(finalidade IN ('cobranca','pagamento')),
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
      .prepare("PRAGMA table_info(faturamento_saidas_carteira)")
      .all()
      .some((c) => c.name === "data_efetiva")
  )
    banco.exec(
      "ALTER TABLE faturamento_saidas_carteira ADD COLUMN data_efetiva TEXT",
    );
  const colunasUsinas = banco.prepare("PRAGMA table_info(usinas)").all();
  if (colunasUsinas.length && !colunasUsinas.some((c) => c.name === "versao")) {
    banco.exec(
      "ALTER TABLE usinas ADD COLUMN versao INTEGER NOT NULL DEFAULT 1",
    );
  }
  const colunasUnidades = banco
    .prepare("PRAGMA table_info(faturamento_unidades)")
    .all();
  if (!colunasUnidades.some((c) => c.name === "uc_antiga")) {
    banco.exec("ALTER TABLE faturamento_unidades ADD COLUMN uc_antiga TEXT");
  }
  banco.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS faturamento_unidades_uc_antiga_unica ON faturamento_unidades(uc_antiga) WHERE uc_antiga IS NOT NULL AND uc_antiga<>''",
  );
  banco.exec(`
    CREATE TABLE IF NOT EXISTS faturamento_unidades_aliases (
      id INTEGER PRIMARY KEY,
      unidade_id INTEGER NOT NULL REFERENCES faturamento_unidades(id) ON DELETE CASCADE,
      uc TEXT NOT NULL UNIQUE CHECK(uc<>''),
      origem TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS faturamento_unidades_aliases_unidade
      ON faturamento_unidades_aliases(unidade_id);
    DELETE FROM faturamento_unidades_aliases
      WHERE EXISTS (
        SELECT 1 FROM faturamento_unidades atual
        WHERE atual.id=faturamento_unidades_aliases.unidade_id
          AND atual.uc=faturamento_unidades_aliases.uc
      );
    INSERT OR IGNORE INTO faturamento_unidades_aliases(unidade_id,uc,origem)
      SELECT u.id,u.uc_antiga,'Migração do campo UC antiga'
      FROM faturamento_unidades u
      WHERE u.uc_antiga IS NOT NULL AND u.uc_antiga<>''
        AND u.uc_antiga<>u.uc
        AND NOT EXISTS (
          SELECT 1 FROM faturamento_unidades atual
          WHERE atual.uc=u.uc_antiga AND atual.id<>u.id
        );
    CREATE TRIGGER IF NOT EXISTS faturamento_alias_nao_pode_ser_uc_atual_insert
    BEFORE INSERT ON faturamento_unidades_aliases
    WHEN EXISTS (SELECT 1 FROM faturamento_unidades WHERE uc=NEW.uc)
    BEGIN
      SELECT RAISE(ABORT, 'UC histórica já cadastrada como UC atual');
    END;
    CREATE TRIGGER IF NOT EXISTS faturamento_alias_nao_pode_ser_uc_atual_update
    BEFORE UPDATE OF uc ON faturamento_unidades_aliases
    WHEN EXISTS (SELECT 1 FROM faturamento_unidades WHERE uc=NEW.uc)
    BEGIN
      SELECT RAISE(ABORT, 'UC histórica já cadastrada como UC atual');
    END;
    CREATE TRIGGER IF NOT EXISTS faturamento_uc_atual_nao_pode_ser_alias_insert
    BEFORE INSERT ON faturamento_unidades
    WHEN EXISTS (SELECT 1 FROM faturamento_unidades_aliases WHERE uc=NEW.uc)
    BEGIN
      SELECT RAISE(ABORT, 'UC atual já cadastrada como identificador histórico');
    END;
    CREATE TRIGGER IF NOT EXISTS faturamento_uc_atual_nao_pode_ser_alias_update
    BEFORE UPDATE OF uc ON faturamento_unidades
    WHEN EXISTS (SELECT 1 FROM faturamento_unidades_aliases WHERE uc=NEW.uc)
    BEGIN
      SELECT RAISE(ABORT, 'UC atual já cadastrada como identificador histórico');
    END;
    CREATE TRIGGER IF NOT EXISTS faturamento_uc_antiga_sem_conflito_insert
    BEFORE INSERT ON faturamento_unidades
    WHEN NEW.uc_antiga IS NOT NULL AND NEW.uc_antiga<>'' AND (
      EXISTS (SELECT 1 FROM faturamento_unidades WHERE uc=NEW.uc_antiga)
      OR EXISTS (
        SELECT 1 FROM faturamento_unidades_aliases
        WHERE uc=NEW.uc_antiga
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'UC antiga já pertence a outro cadastro');
    END;
    CREATE TRIGGER IF NOT EXISTS faturamento_uc_antiga_sem_conflito_update
    BEFORE UPDATE OF uc_antiga ON faturamento_unidades
    WHEN NEW.uc_antiga IS NOT NULL AND NEW.uc_antiga<>'' AND (
      EXISTS (
        SELECT 1 FROM faturamento_unidades
        WHERE uc=NEW.uc_antiga AND id<>NEW.id
      )
      OR EXISTS (
        SELECT 1 FROM faturamento_unidades_aliases
        WHERE uc=NEW.uc_antiga AND unidade_id<>NEW.id
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'UC antiga já pertence a outro cadastro');
    END;
    CREATE TRIGGER IF NOT EXISTS faturamento_uc_antiga_cria_alias_insert
    AFTER INSERT ON faturamento_unidades
    WHEN NEW.uc_antiga IS NOT NULL AND NEW.uc_antiga<>''
    BEGIN
      INSERT OR IGNORE INTO faturamento_unidades_aliases(unidade_id,uc,origem)
      VALUES(NEW.id,NEW.uc_antiga,'Cadastro da UC antiga');
    END;
    CREATE TRIGGER IF NOT EXISTS faturamento_uc_antiga_cria_alias_update
    AFTER UPDATE OF uc_antiga ON faturamento_unidades
    WHEN NEW.uc_antiga IS NOT NULL AND NEW.uc_antiga<>''
    BEGIN
      INSERT OR IGNORE INTO faturamento_unidades_aliases(unidade_id,uc,origem)
      VALUES(NEW.id,NEW.uc_antiga,'Atualização da UC antiga');
    END;
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
      .some((c) => c.name === "finalidade")
  ) {
    banco.exec(
      "ALTER TABLE faturamento_documentos ADD COLUMN finalidade TEXT NOT NULL DEFAULT 'cobranca' CHECK(finalidade IN ('cobranca','pagamento'))",
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
  if (
    !banco
      .prepare("PRAGMA table_info(faturamento_unidades)")
      .all()
      .some((c) => c.name === "cliente_operacional_id")
  ) {
    banco.exec(
      "ALTER TABLE faturamento_unidades ADD COLUMN cliente_operacional_id INTEGER REFERENCES faturamento_clientes_operacionais(id)",
    );
  }
  if (
    !banco
      .prepare("PRAGMA table_info(faturamento_unidades)")
      .all()
      .some((c) => c.name === "pendencia_cadastro")
  ) {
    banco.exec(
      "ALTER TABLE faturamento_unidades ADD COLUMN pendencia_cadastro TEXT",
    );
  }
  banco.exec(`CREATE INDEX IF NOT EXISTS faturamento_unidades_cliente
    ON faturamento_unidades(cliente_id) WHERE cliente_id IS NOT NULL`);
  banco.exec(`CREATE INDEX IF NOT EXISTS faturamento_unidades_provisorio
    ON faturamento_unidades(cliente_provisorio_id)
    WHERE cliente_provisorio_id IS NOT NULL`);
  banco.exec(`CREATE INDEX IF NOT EXISTS faturamento_unidades_operacional
    ON faturamento_unidades(cliente_operacional_id)
    WHERE cliente_operacional_id IS NOT NULL`);
  banco.exec(`
    CREATE TRIGGER IF NOT EXISTS faturamento_saida_carteira_sem_novo_calculo_insert
    BEFORE INSERT ON faturamento_documentos
    WHEN NEW.unidade_id IS NOT NULL AND NEW.competencia IS NOT NULL
      AND NEW.status IN ('Calculada','Aprovada — aguardando emissão')
      AND EXISTS (
        SELECT 1 FROM faturamento_saidas_carteira s
        WHERE s.unidade_id=NEW.unidade_id AND s.inicio<=NEW.competencia
      )
    BEGIN
      SELECT RAISE(ABORT, 'UC fora da carteira operacional da Ecosol nesta competência');
    END;
    CREATE TRIGGER IF NOT EXISTS faturamento_saida_carteira_sem_novo_calculo_update
    BEFORE UPDATE OF unidade_id,competencia,status ON faturamento_documentos
    WHEN NEW.unidade_id IS NOT NULL AND NEW.competencia IS NOT NULL
      AND NEW.status IN ('Calculada','Aprovada — aguardando emissão')
      AND OLD.status NOT IN ('Calculada','Aprovada — aguardando emissão')
      AND EXISTS (
        SELECT 1 FROM faturamento_saidas_carteira s
        WHERE s.unidade_id=NEW.unidade_id AND s.inicio<=NEW.competencia
      )
    BEGIN
      SELECT RAISE(ABORT, 'UC fora da carteira operacional da Ecosol nesta competência');
    END;
  `);
  // Documentação pendente não impede conferir e calcular uma fatura. A barreira
  // precisa existir no marco de emissão, não na apuração interna.
  banco.exec(`
    DROP TRIGGER IF EXISTS faturamento_operacional_sem_calculo_insert;
    DROP TRIGGER IF EXISTS faturamento_operacional_sem_calculo_update;
    CREATE TRIGGER IF NOT EXISTS faturamento_operacional_sem_emissao_insert
    BEFORE INSERT ON faturamento_documentos
    WHEN NEW.unidade_id IS NOT NULL
      AND NEW.status LIKE 'Emitida%'
      AND EXISTS (SELECT 1 FROM faturamento_unidades u
                  WHERE u.id=NEW.unidade_id AND u.cliente_operacional_id IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'Documentação real do cliente pendente: emissão bloqueada');
    END;
    CREATE TRIGGER IF NOT EXISTS faturamento_operacional_sem_emissao_update
    BEFORE UPDATE ON faturamento_documentos
    WHEN NEW.unidade_id IS NOT NULL
      AND NEW.status LIKE 'Emitida%'
      AND EXISTS (SELECT 1 FROM faturamento_unidades u
                  WHERE u.id=NEW.unidade_id AND u.cliente_operacional_id IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'Documentação real do cliente pendente: emissão bloqueada');
    END;
  `);
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
