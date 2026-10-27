export const papeisBancarios = [
  "consulta_auditoria",
  "operador_financeiro",
  "aprovador_financeiro",
  "administrador_integracao",
];

export function prepararBancario(banco) {
  banco.exec(`
    CREATE TABLE IF NOT EXISTS equipe_papeis_criticos (
      staff_id INTEGER PRIMARY KEY REFERENCES staff_users(id) ON DELETE CASCADE,
      papel TEXT NOT NULL CHECK(papel IN ('proprietario','guardiao_recuperacao')),
      concedido_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    DROP TRIGGER IF EXISTS equipe_papel_critico_nivel_insert;
    CREATE TRIGGER equipe_papel_critico_nivel_insert
    BEFORE INSERT ON equipe_papeis_criticos
    WHEN NEW.papel='proprietario' AND
      (SELECT access_level FROM staff_users WHERE id=NEW.staff_id)<>3
    BEGIN
      SELECT RAISE(ABORT, 'Papel crítico exige nível 3');
    END;
    DROP TRIGGER IF EXISTS equipe_papel_critico_nivel_update;
    CREATE TRIGGER equipe_papel_critico_nivel_update
    BEFORE UPDATE OF access_level ON staff_users
    WHEN NEW.access_level<>3 AND EXISTS(
      SELECT 1 FROM equipe_papeis_criticos
      WHERE staff_id=NEW.id AND papel='proprietario'
    )
    BEGIN
      SELECT RAISE(ABORT, 'Remova o papel crítico antes de reduzir o nível');
    END;
    CREATE TRIGGER IF NOT EXISTS equipe_papel_critico_limite_insert
    BEFORE INSERT ON equipe_papeis_criticos
    WHEN (SELECT COUNT(*) FROM equipe_papeis_criticos WHERE papel=NEW.papel)>=
      CASE NEW.papel WHEN 'proprietario' THEN 2 ELSE 1 END
    BEGIN
      SELECT RAISE(ABORT, 'Limite de contas para papel crítico atingido');
    END;
    CREATE TRIGGER IF NOT EXISTS equipe_papel_critico_limite_update
    BEFORE UPDATE OF papel ON equipe_papeis_criticos
    WHEN OLD.papel<>NEW.papel AND
      (SELECT COUNT(*) FROM equipe_papeis_criticos WHERE papel=NEW.papel)>=
      CASE NEW.papel WHEN 'proprietario' THEN 2 ELSE 1 END
    BEGIN
      SELECT RAISE(ABORT, 'Limite de contas para papel crítico atingido');
    END;
    CREATE TABLE IF NOT EXISTS bancario_credencial_confirmacao (
      id INTEGER PRIMARY KEY CHECK(id=1),
      proprietario_principal_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
      senha_hash TEXT NOT NULL,
      versao INTEGER NOT NULL DEFAULT 1 CHECK(versao>=1),
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      alterado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bancario_recuperacoes_credencial (
      id TEXT PRIMARY KEY,
      proprietario_principal_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
      codigo_hash TEXT NOT NULL CHECK(length(codigo_hash)=64),
      expira_em INTEGER NOT NULL,
      usado_em INTEGER,
      solicitado_em INTEGER NOT NULL,
      CHECK(expira_em>solicitado_em)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS bancario_recuperacao_credencial_ativa
      ON bancario_recuperacoes_credencial(proprietario_principal_id)
      WHERE usado_em IS NULL;
    CREATE TABLE IF NOT EXISTS bancario_auditoria_credencial (
      id INTEGER PRIMARY KEY,
      ator_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
      evento TEXT NOT NULL CHECK(evento IN
        ('cadastrada','alterada','recuperacao_solicitada','recuperada')),
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bancario_papeis_equipe (
      staff_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
      papel TEXT NOT NULL CHECK(papel IN (
        'consulta_auditoria',
        'operador_financeiro',
        'aprovador_financeiro',
        'administrador_integracao'
      )),
      concedido_por INTEGER NOT NULL,
      concedido_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(staff_id, papel),
      CHECK(staff_id <> concedido_por)
    );
    CREATE INDEX IF NOT EXISTS bancario_papeis_por_papel
      ON bancario_papeis_equipe(papel, staff_id);

    CREATE TABLE IF NOT EXISTS bancario_auditoria_permissoes (
      id INTEGER PRIMARY KEY,
      staff_id INTEGER NOT NULL,
      papel TEXT NOT NULL,
      acao TEXT NOT NULL CHECK(acao IN ('concedido', 'revogado')),
      responsavel_id INTEGER NOT NULL,
      responsavel_nome TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS bancario_auditoria_staff
      ON bancario_auditoria_permissoes(staff_id, criado_em DESC);

    CREATE TABLE IF NOT EXISTS bancario_operacoes (
      id TEXT PRIMARY KEY,
      tipo TEXT NOT NULL CHECK(tipo IN ('cobranca','pagamento')),
      ambiente TEXT NOT NULL CHECK(ambiente IN ('homologacao','producao')),
      conta_referencia TEXT NOT NULL CHECK(conta_referencia<>''),
      origem_tipo TEXT NOT NULL CHECK(origem_tipo IN ('faturamento_documento','manual')),
      origem_id TEXT NOT NULL CHECK(origem_id<>''),
      origem_versao INTEGER NOT NULL CHECK(origem_versao>=1),
      idempotencia TEXT NOT NULL UNIQUE CHECK(length(idempotencia)=64),
      moeda TEXT NOT NULL DEFAULT 'BRL' CHECK(moeda='BRL'),
      valor_centavos INTEGER NOT NULL CHECK(valor_centavos>0),
      vencimento TEXT,
      snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
      snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
      provedor_id TEXT CHECK(
        provedor_id IS NULL OR length(trim(provedor_id))>0
      ),
      ultimo_codigo TEXT,
      estado TEXT NOT NULL CHECK(estado IN (
        'aguardando_aprovacao','aprovada','envio_pendente',
        'resultado_desconhecido','registrada','rejeitada',
        'cancelamento_pendente','cancelada','liquidada',
        'agendada','paga','falhou','estornada'
      )),
      preparado_por INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
      versao INTEGER NOT NULL DEFAULT 1 CHECK(versao>=1),
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tipo,ambiente,conta_referencia,origem_tipo,origem_id,origem_versao)
    );
    CREATE INDEX IF NOT EXISTS bancario_operacoes_estado
      ON bancario_operacoes(estado, criado_em);
    CREATE INDEX IF NOT EXISTS bancario_operacoes_origem
      ON bancario_operacoes(origem_tipo, origem_id, origem_versao);

    CREATE TABLE IF NOT EXISTS bancario_encargos_atraso (
      id TEXT PRIMARY KEY,
      operacao_origem_id TEXT NOT NULL REFERENCES bancario_operacoes(id) ON DELETE RESTRICT,
      operacao_destino_id TEXT NOT NULL REFERENCES bancario_operacoes(id) ON DELETE RESTRICT,
      unidade_id INTEGER NOT NULL,
      data_referencia TEXT NOT NULL,
      dias_atraso INTEGER NOT NULL CHECK(dias_atraso>1),
      dias_juros INTEGER NOT NULL CHECK(dias_juros=dias_atraso-1),
      principal_centavos INTEGER NOT NULL CHECK(principal_centavos>0),
      multa_centavos INTEGER NOT NULL CHECK(multa_centavos>=0),
      juros_centavos INTEGER NOT NULL CHECK(juros_centavos>=0),
      total_centavos INTEGER NOT NULL CHECK(total_centavos>=0),
      regra TEXT NOT NULL CHECK(regra='ecosol-encargos-atraso-v1'),
      estado TEXT NOT NULL DEFAULT 'aplicado'
        CHECK(estado IN ('aplicado','liberado')),
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      liberado_em TEXT,
      CHECK(operacao_origem_id<>operacao_destino_id),
      CHECK(total_centavos=multa_centavos+juros_centavos),
      CHECK((estado='aplicado' AND liberado_em IS NULL) OR
            (estado='liberado' AND liberado_em IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS bancario_encargo_origem_ativo
      ON bancario_encargos_atraso(operacao_origem_id)
      WHERE estado='aplicado';
    CREATE INDEX IF NOT EXISTS bancario_encargos_destino
      ON bancario_encargos_atraso(operacao_destino_id,estado);

    CREATE TABLE IF NOT EXISTS bancario_artefatos_cobranca (
      operacao_id TEXT PRIMARY KEY REFERENCES bancario_operacoes(id) ON DELETE RESTRICT,
      nosso_numero TEXT NOT NULL CHECK(length(trim(nosso_numero))>0),
      linha_digitavel TEXT,
      codigo_barras TEXT,
      qr_code TEXT,
      pdf BLOB,
      pdf_sha256 TEXT CHECK(pdf_sha256 IS NULL OR length(pdf_sha256)=64),
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(linha_digitavel IS NULL OR (
        length(linha_digitavel) BETWEEN 40 AND 60 AND
        linha_digitavel NOT GLOB '*[^0-9]*'
      )),
      CHECK(codigo_barras IS NULL OR (
        length(codigo_barras) BETWEEN 40 AND 60 AND
        codigo_barras NOT GLOB '*[^0-9]*'
      ))
    );

    CREATE TABLE IF NOT EXISTS bancario_reconciliacoes_cobranca (
      id TEXT PRIMARY KEY,
      operacao_id TEXT NOT NULL REFERENCES bancario_operacoes(id) ON DELETE RESTRICT,
      correlacao TEXT NOT NULL UNIQUE,
      estado TEXT NOT NULL CHECK(estado IN
        ('processando','concluida','inconclusiva','falhou')),
      estado_anterior TEXT NOT NULL,
      estado_observado TEXT,
      codigo TEXT,
      tentativa INTEGER NOT NULL DEFAULT 1 CHECK(tentativa>=1),
      solicitado_por INTEGER,
      solicitado_por_nome TEXT,
      posse_por TEXT,
      posse_ate INTEGER,
      iniciado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      concluido_em TEXT,
      CHECK((estado='processando' AND posse_por IS NOT NULL AND posse_ate IS NOT NULL) OR
            (estado<>'processando' AND posse_por IS NULL AND posse_ate IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS bancario_reconciliacao_em_andamento
      ON bancario_reconciliacoes_cobranca(operacao_id)
      WHERE estado='processando';
    CREATE INDEX IF NOT EXISTS bancario_reconciliacoes_operacao
      ON bancario_reconciliacoes_cobranca(operacao_id,iniciado_em DESC);

    CREATE TABLE IF NOT EXISTS bancario_aprovacoes (
      id INTEGER PRIMARY KEY,
      operacao_id TEXT NOT NULL REFERENCES bancario_operacoes(id) ON DELETE RESTRICT,
      operacao_versao INTEGER NOT NULL,
      snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
      preparador_id INTEGER NOT NULL,
      aprovador_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(preparador_id<>aprovador_id),
      UNIQUE(operacao_id,operacao_versao)
    );

    -- Exceção explícita: o Proprietário pode aprovar a própria operação.
    -- A tabela separada preserva o CHECK de segregação das aprovações comuns.
    CREATE TABLE IF NOT EXISTS bancario_autoaprovacoes_proprietario (
      id INTEGER PRIMARY KEY,
      operacao_id TEXT NOT NULL REFERENCES bancario_operacoes(id) ON DELETE RESTRICT,
      operacao_versao INTEGER NOT NULL,
      snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
      proprietario_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(operacao_id,operacao_versao)
    );

    -- Pagamentos representam saída de dinheiro e só podem ser aprovados pelo
    -- Proprietário após confirmação da senha atual. A evidência registra o
    -- evento, sem persistir senha ou token de confirmação.
    CREATE TABLE IF NOT EXISTS bancario_aprovacoes_pagamento_proprietario (
      id INTEGER PRIMARY KEY,
      operacao_id TEXT NOT NULL REFERENCES bancario_operacoes(id) ON DELETE RESTRICT,
      operacao_versao INTEGER NOT NULL,
      snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
      proprietario_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(operacao_id,operacao_versao)
    );

    CREATE TABLE IF NOT EXISTS bancario_intencoes (
      id TEXT PRIMARY KEY,
      operacao_id TEXT NOT NULL REFERENCES bancario_operacoes(id) ON DELETE RESTRICT,
      operacao_versao INTEGER NOT NULL,
      acao TEXT NOT NULL CHECK(acao IN ('registrar_cobranca','cancelar_cobranca','executar_pagamento')),
      estado TEXT NOT NULL DEFAULT 'pendente'
        CHECK(estado IN ('pendente','processando','concluida','falhou','resultado_desconhecido')),
      tentativas INTEGER NOT NULL DEFAULT 0 CHECK(tentativas>=0),
      posse_por TEXT,
      posse_ate INTEGER,
      proxima_tentativa_em INTEGER,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(operacao_id,operacao_versao,acao)
    );
    CREATE INDEX IF NOT EXISTS bancario_intencoes_fila
      ON bancario_intencoes(estado, proxima_tentativa_em, criado_em);

    CREATE TABLE IF NOT EXISTS bancario_tentativas (
      id TEXT PRIMARY KEY,
      intencao_id TEXT NOT NULL REFERENCES bancario_intencoes(id) ON DELETE RESTRICT,
      operacao_id TEXT NOT NULL REFERENCES bancario_operacoes(id) ON DELETE RESTRICT,
      etapa TEXT NOT NULL CHECK(etapa IN ('envio','consulta')),
      correlacao TEXT NOT NULL,
      resultado TEXT CHECK(resultado IN
        ('sucesso','rejeitada','falha_segura','resultado_desconhecido','nao_encontrada')),
      codigo TEXT,
      iniciado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      concluido_em TEXT
    );
    CREATE INDEX IF NOT EXISTS bancario_tentativas_operacao
      ON bancario_tentativas(operacao_id, iniciado_em DESC);

    CREATE TABLE IF NOT EXISTS bancario_controle_executor (
      id INTEGER PRIMARY KEY CHECK(id=1),
      pausado INTEGER NOT NULL DEFAULT 1 CHECK(pausado IN (0,1)),
      alterado_por INTEGER,
      alterado_por_nome TEXT,
      alterado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO bancario_controle_executor(id,pausado) VALUES(1,1);

    CREATE TABLE IF NOT EXISTS bancario_auditoria_executor (
      id INTEGER PRIMARY KEY,
      ator_id INTEGER NOT NULL,
      ator_nome TEXT NOT NULL,
      acao TEXT NOT NULL CHECK(acao IN ('pausado','retomado')),
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bancario_simulador_cobrancas (
      idempotencia TEXT PRIMARY KEY CHECK(length(idempotencia)=64),
      provedor_id TEXT NOT NULL UNIQUE,
      estado TEXT NOT NULL CHECK(estado IN ('registrada','liquidada','cancelada')),
      valor_centavos INTEGER NOT NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bancario_auditoria_operacoes (
      id INTEGER PRIMARY KEY,
      operacao_id TEXT NOT NULL,
      ator_id INTEGER NOT NULL,
      ator_nome TEXT NOT NULL,
      acao TEXT NOT NULL,
      estado_anterior TEXT,
      estado_novo TEXT NOT NULL,
      detalhes TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detalhes)),
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS bancario_auditoria_operacao
      ON bancario_auditoria_operacoes(operacao_id, id);

    DROP TRIGGER IF EXISTS bancario_operacao_transicao_valida;
    CREATE TRIGGER bancario_operacao_transicao_valida
    BEFORE UPDATE OF estado ON bancario_operacoes
    WHEN OLD.estado<>NEW.estado AND NOT (
      (OLD.estado='aguardando_aprovacao' AND NEW.estado='aprovada') OR
      (OLD.estado='aprovada' AND NEW.estado='envio_pendente') OR
      (OLD.estado='envio_pendente' AND NEW.estado IN
        ('resultado_desconhecido','registrada','rejeitada','agendada','paga','falhou')) OR
      (OLD.estado='resultado_desconhecido' AND NEW.estado IN
        ('registrada','rejeitada','liquidada','agendada','paga','falhou','cancelamento_pendente')) OR
      (OLD.estado='registrada' AND NEW.estado IN
        ('liquidada','cancelamento_pendente')) OR
      (OLD.estado='cancelamento_pendente' AND NEW.estado IN
        ('cancelada','resultado_desconhecido','falhou')) OR
      (OLD.estado='agendada' AND NEW.estado IN
        ('paga','cancelamento_pendente','falhou')) OR
      (OLD.estado='paga' AND NEW.estado='estornada') OR
      (OLD.estado='falhou' AND NEW.estado='cancelada') OR
      (OLD.estado='cancelada' AND NEW.estado='aprovada')
    )
    BEGIN
      SELECT RAISE(ABORT, 'Transição bancária inválida');
    END;

    CREATE TRIGGER IF NOT EXISTS bancario_aprovacao_confere_operacao
    BEFORE INSERT ON bancario_aprovacoes
    WHEN NOT EXISTS (
      SELECT 1 FROM bancario_operacoes o
      WHERE o.id=NEW.operacao_id
        AND o.versao=NEW.operacao_versao
        AND o.snapshot_hash=NEW.snapshot_hash
        AND o.preparado_por=NEW.preparador_id
        AND o.estado='aguardando_aprovacao'
    )
    BEGIN
      SELECT RAISE(ABORT, 'Aprovação não corresponde à operação atual');
    END;

    CREATE TRIGGER IF NOT EXISTS bancario_autoaprovacao_confere_operacao
    BEFORE INSERT ON bancario_autoaprovacoes_proprietario
    WHEN NOT EXISTS (
      SELECT 1 FROM bancario_operacoes o
      JOIN equipe_papeis_criticos p
        ON p.staff_id=NEW.proprietario_id AND p.papel='proprietario'
      JOIN staff_users s ON s.id=p.staff_id AND s.access_level=3
      WHERE o.id=NEW.operacao_id
        AND o.versao=NEW.operacao_versao
        AND o.snapshot_hash=NEW.snapshot_hash
        AND o.preparado_por=NEW.proprietario_id
        AND o.estado='aguardando_aprovacao'
    )
    BEGIN
      SELECT RAISE(ABORT, 'Autoaprovação exige Proprietário e operação própria atual');
    END;

    DROP TRIGGER IF EXISTS bancario_pagamento_aprovacao_exige_proprietario;
    CREATE TRIGGER bancario_pagamento_aprovacao_exige_proprietario
    BEFORE INSERT ON bancario_aprovacoes_pagamento_proprietario
    WHEN NOT EXISTS (
      SELECT 1 FROM bancario_operacoes o
      JOIN equipe_papeis_criticos p
        ON p.staff_id=NEW.proprietario_id AND p.papel='proprietario'
      JOIN staff_users s ON s.id=p.staff_id AND s.access_level=3
      WHERE o.id=NEW.operacao_id
        AND o.tipo='pagamento'
        AND o.versao=NEW.operacao_versao
        AND o.snapshot_hash=NEW.snapshot_hash
        AND o.estado='aguardando_aprovacao'
    )
    BEGIN
      SELECT RAISE(ABORT, 'Pagamento exige aprovação atual do Proprietário');
    END;

    DROP TRIGGER IF EXISTS bancario_intencao_exige_aprovacao;
    CREATE TRIGGER bancario_intencao_exige_aprovacao
    BEFORE INSERT ON bancario_intencoes
    WHEN NOT (
      EXISTS (
      SELECT 1
      FROM bancario_operacoes o
      WHERE o.id=NEW.operacao_id
        AND o.tipo='cobranca'
        AND o.versao=NEW.operacao_versao
        AND o.estado='aprovada'
        AND NEW.acao IN ('registrar_cobranca','cancelar_cobranca')
      ) OR EXISTS (
      SELECT 1
      FROM bancario_operacoes o
      JOIN bancario_aprovacoes_pagamento_proprietario a
        ON a.operacao_id=o.id AND a.operacao_versao=o.versao
       AND a.snapshot_hash=o.snapshot_hash
      JOIN equipe_papeis_criticos p
        ON p.staff_id=a.proprietario_id AND p.papel='proprietario'
      JOIN staff_users s ON s.id=p.staff_id AND s.access_level=3
      WHERE o.id=NEW.operacao_id
        AND o.tipo='pagamento'
        AND o.versao=NEW.operacao_versao
        AND o.estado='aprovada'
        AND NEW.acao='executar_pagamento'
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'Intenção bancária sem aprovação válida');
    END;
  `);

  // Migração aditiva para bancos que inicializaram o módulo na entrega anterior.
  const colunasOperacoes = banco
    .prepare("PRAGMA table_info(bancario_operacoes)")
    .all();
  if (!colunasOperacoes.some((coluna) => coluna.name === "provedor_id"))
    banco.exec("ALTER TABLE bancario_operacoes ADD COLUMN provedor_id TEXT");
  if (!colunasOperacoes.some((coluna) => coluna.name === "ultimo_codigo"))
    banco.exec("ALTER TABLE bancario_operacoes ADD COLUMN ultimo_codigo TEXT");
  const colunasReconciliacoes = banco
    .prepare("PRAGMA table_info(bancario_reconciliacoes_cobranca)")
    .all();
  if (!colunasReconciliacoes.some((coluna) => coluna.name === "tentativa"))
    banco.exec(
      "ALTER TABLE bancario_reconciliacoes_cobranca ADD COLUMN tentativa INTEGER NOT NULL DEFAULT 1 CHECK(tentativa>=1)",
    );
  if (!colunasReconciliacoes.some((coluna) => coluna.name === "posse_por"))
    banco.exec(
      "ALTER TABLE bancario_reconciliacoes_cobranca ADD COLUMN posse_por TEXT",
    );
  if (!colunasReconciliacoes.some((coluna) => coluna.name === "posse_ate"))
    banco.exec(
      "ALTER TABLE bancario_reconciliacoes_cobranca ADD COLUMN posse_ate INTEGER",
    );
  if (!colunasReconciliacoes.some((coluna) => coluna.name === "solicitado_por"))
    banco.exec(
      "ALTER TABLE bancario_reconciliacoes_cobranca ADD COLUMN solicitado_por INTEGER",
    );
  if (
    !colunasReconciliacoes.some(
      (coluna) => coluna.name === "solicitado_por_nome",
    )
  )
    banco.exec(
      "ALTER TABLE bancario_reconciliacoes_cobranca ADD COLUMN solicitado_por_nome TEXT",
    );
  banco.exec(`
    CREATE INDEX IF NOT EXISTS bancario_reconciliacoes_limite_manual
    ON bancario_reconciliacoes_cobranca(
      operacao_id,solicitado_por,iniciado_em DESC
    )
  `);
  // Não tente "corrigir" identificadores financeiros durante a inicialização.
  // Dados antigos ambíguos exigem conciliação humana antes que a unicidade possa
  // ser imposta com segurança.
  const identificadorVazio = banco
    .prepare(
      `SELECT 1
       FROM bancario_operacoes
       WHERE provedor_id IS NOT NULL AND length(trim(provedor_id))=0
       LIMIT 1`,
    )
    .get();
  if (identificadorVazio) {
    const erro = new Error(
      "Há operação bancária com identificador do provedor vazio. Concilie os dados antes de iniciar o serviço.",
    );
    erro.codigo = "PROVEDOR_ID_INVALIDO_EXISTENTE";
    throw erro;
  }

  const identificadorDuplicado = banco
    .prepare(
      `SELECT 1
       FROM bancario_operacoes
       WHERE provedor_id IS NOT NULL AND length(trim(provedor_id))>0
       GROUP BY
         lower(trim(ambiente)),
         lower(trim(conta_referencia)),
         trim(provedor_id)
       HAVING COUNT(*)>1
       LIMIT 1`,
    )
    .get();
  if (identificadorDuplicado) {
    const erro = new Error(
      "Há identificadores bancários duplicados na mesma conta e ambiente. Concilie os dados antes de iniciar o serviço.",
    );
    erro.codigo = "PROVEDOR_ID_DUPLICADO_EXISTENTE";
    throw erro;
  }

  banco.exec(`
    CREATE TRIGGER IF NOT EXISTS bancario_provedor_id_nao_vazio_insert
    BEFORE INSERT ON bancario_operacoes
    WHEN NEW.provedor_id IS NOT NULL AND length(trim(NEW.provedor_id))=0
    BEGIN
      SELECT RAISE(ABORT, 'Identificador do provedor não pode ser vazio');
    END;

    CREATE TRIGGER IF NOT EXISTS bancario_provedor_id_nao_vazio_update
    BEFORE UPDATE OF provedor_id ON bancario_operacoes
    WHEN NEW.provedor_id IS NOT NULL AND length(trim(NEW.provedor_id))=0
    BEGIN
      SELECT RAISE(ABORT, 'Identificador do provedor não pode ser vazio');
    END;

    CREATE UNIQUE INDEX IF NOT EXISTS bancario_operacoes_provedor_unico
      ON bancario_operacoes(
        lower(trim(ambiente)),
        lower(trim(conta_referencia)),
        trim(provedor_id)
      )
      WHERE provedor_id IS NOT NULL AND length(trim(provedor_id))>0;
  `);
}
