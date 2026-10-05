// Metadados de captura e credenciais OAuth isolados em tabelas distintas.
// O conteúdo dos e-mails não pertence a este módulo.
export function prepararGmail(banco) {
  banco.exec("PRAGMA foreign_keys=ON");
  // Aguarda uma transação curta de outra conexão; após o limite, SQLITE_BUSY
  // sobe sem alterar o cursor ou os itens das filas.
  banco.exec("PRAGMA busy_timeout=5000");
  banco.exec("BEGIN IMMEDIATE");
  try {
    banco.exec(`
      CREATE TABLE IF NOT EXISTS gmail_contas (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(email) <= 320),
        data_inicio TEXT NOT NULL
          CHECK(data_inicio GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        fuso_inicio TEXT NOT NULL DEFAULT 'America/Sao_Paulo'
          CHECK(fuso_inicio = 'America/Sao_Paulo'),
        inicio_inclusivo INTEGER NOT NULL DEFAULT 1 CHECK(inicio_inclusivo = 1),
        status_autorizacao TEXT NOT NULL DEFAULT 'nao_conectada'
          CHECK(status_autorizacao IN ('nao_conectada','conectada','reconectar')),
        pausada INTEGER NOT NULL DEFAULT 1 CHECK(pausada IN (0,1)),
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS gmail_sincronizacoes (
        conta_id INTEGER PRIMARY KEY REFERENCES gmail_contas(id) ON DELETE RESTRICT,
        fase TEXT NOT NULL DEFAULT 'inicial'
          CHECK(fase IN ('inicial','historico','revarredura')),
        cursor_pagina TEXT CHECK(cursor_pagina IS NULL OR length(cursor_pagina) <= 2048),
        history_id TEXT CHECK(history_id IS NULL OR length(history_id) <= 80),
        marco_history_id TEXT
          CHECK(marco_history_id IS NULL OR length(marco_history_id) <= 80),
        versao INTEGER NOT NULL DEFAULT 1 CHECK(versao > 0),
        ultimo_lote_versao INTEGER,
        ultimo_lote_hash TEXT CHECK(ultimo_lote_hash IS NULL OR length(ultimo_lote_hash) = 64),
        ultima_pagina_em INTEGER,
        ultima_conclusao_em INTEGER,
        CHECK((ultimo_lote_versao IS NULL) = (ultimo_lote_hash IS NULL))
      );

      CREATE TABLE IF NOT EXISTS gmail_oauth_tentativas (
        state_hash TEXT PRIMARY KEY CHECK(length(state_hash) = 64),
        conta_id INTEGER NOT NULL REFERENCES gmail_contas(id) ON DELETE CASCADE,
        sessao_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        verificador_pkce TEXT NOT NULL CHECK(length(verificador_pkce) BETWEEN 43 AND 128),
        expira_em INTEGER NOT NULL,
        criado_em INTEGER NOT NULL,
        consumido_em INTEGER
      );
      CREATE INDEX IF NOT EXISTS gmail_oauth_tentativas_expiracao
        ON gmail_oauth_tentativas(expira_em);

      CREATE TABLE IF NOT EXISTS gmail_credenciais (
        conta_id INTEGER PRIMARY KEY REFERENCES gmail_contas(id) ON DELETE RESTRICT,
        refresh_token_cifrado TEXT NOT NULL,
        email_verificado TEXT NOT NULL,
        escopo TEXT NOT NULL,
        autorizado_em INTEGER NOT NULL,
        autorizado_por INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS gmail_auditoria (
        id INTEGER PRIMARY KEY,
        conta_id INTEGER NOT NULL REFERENCES gmail_contas(id) ON DELETE RESTRICT,
        administrador_id INTEGER NOT NULL,
        acao TEXT NOT NULL CHECK(acao IN ('conectou','pausou','retomou')),
        criado_em INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS gmail_mensagens (
        id INTEGER PRIMARY KEY,
        conta_id INTEGER NOT NULL REFERENCES gmail_contas(id) ON DELETE RESTRICT,
        message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 512),
        estado TEXT NOT NULL DEFAULT 'pendente'
          CHECK(estado IN ('pendente','em_processamento','detalhada',
                           'pendente_manual','falha_temporaria')),
        tentativas INTEGER NOT NULL DEFAULT 0 CHECK(tentativas >= 0),
        lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token) = 36),
        lease_ate INTEGER,
        proxima_tentativa_em INTEGER,
        erro_codigo TEXT CHECK(erro_codigo IS NULL OR length(erro_codigo) <= 80),
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(conta_id, message_id),
        CHECK((estado = 'em_processamento') =
          (lease_token IS NOT NULL AND lease_ate IS NOT NULL)),
        CHECK((estado = 'falha_temporaria') = (proxima_tentativa_em IS NOT NULL))
      );

      CREATE TABLE IF NOT EXISTS gmail_anexos (
        id INTEGER PRIMARY KEY,
        conta_id INTEGER NOT NULL REFERENCES gmail_contas(id) ON DELETE RESTRICT,
        message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 512),
        part_path TEXT NOT NULL CHECK(length(part_path) BETWEEN 1 AND 256),
        attachment_id TEXT CHECK(attachment_id IS NULL OR length(attachment_id) <= 1024),
        nome TEXT NOT NULL CHECK(length(nome) BETWEEN 1 AND 255),
        mime_type TEXT NOT NULL CHECK(length(mime_type) BETWEEN 1 AND 127),
        estado TEXT NOT NULL DEFAULT 'pendente'
          CHECK(estado IN ('pendente','em_processamento','capturado','duplicado',
                           'pendente_manual','falha_temporaria')),
        tentativas INTEGER NOT NULL DEFAULT 0 CHECK(tentativas >= 0),
        lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token) = 36),
        lease_ate INTEGER,
        proxima_tentativa_em INTEGER,
        erro_codigo TEXT CHECK(erro_codigo IS NULL OR length(erro_codigo) <= 80),
        hash_pdf TEXT CHECK(hash_pdf IS NULL OR length(hash_pdf) = 64),
        documento_id INTEGER REFERENCES faturamento_documentos(id) ON DELETE RESTRICT
          CHECK(documento_id IS NULL OR documento_id > 0),
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(conta_id, message_id, part_path),
        FOREIGN KEY(conta_id, message_id)
          REFERENCES gmail_mensagens(conta_id, message_id) ON DELETE RESTRICT,
        CHECK((estado = 'em_processamento') =
          (lease_token IS NOT NULL AND lease_ate IS NOT NULL)),
        CHECK((estado = 'falha_temporaria') = (proxima_tentativa_em IS NOT NULL)),
        CHECK(
          (estado IN ('capturado','duplicado') AND
            documento_id IS NOT NULL AND hash_pdf IS NOT NULL) OR
          (estado NOT IN ('capturado','duplicado') AND
            documento_id IS NULL AND hash_pdf IS NULL)
        )
      );

      CREATE INDEX IF NOT EXISTS gmail_mensagens_reservas
        ON gmail_mensagens(conta_id, tentativas, id)
        WHERE estado IN ('pendente','falha_temporaria','em_processamento');
      CREATE INDEX IF NOT EXISTS gmail_anexos_reservas
        ON gmail_anexos(conta_id, tentativas, id)
        WHERE estado IN ('pendente','falha_temporaria','em_processamento');
      CREATE INDEX IF NOT EXISTS gmail_anexos_documento
        ON gmail_anexos(documento_id) WHERE documento_id IS NOT NULL;

      INSERT OR IGNORE INTO gmail_mensagens(conta_id,message_id,estado)
        SELECT DISTINCT conta_id,message_id,'detalhada' FROM gmail_anexos;
    `);
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}
