export const papeisBancarios = [
  "consulta_auditoria",
  "operador_financeiro",
  "aprovador_financeiro",
  "administrador_integracao",
];

export function prepararBancario(banco) {
  banco.exec(`
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
      provedor_id TEXT,
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
      (OLD.estado='paga' AND NEW.estado='estornada')
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

    CREATE TRIGGER IF NOT EXISTS bancario_intencao_exige_aprovacao
    BEFORE INSERT ON bancario_intencoes
    WHEN NOT EXISTS (
      SELECT 1
      FROM bancario_operacoes o
      JOIN bancario_aprovacoes a
        ON a.operacao_id=o.id AND a.operacao_versao=o.versao
       AND a.snapshot_hash=o.snapshot_hash
      WHERE o.id=NEW.operacao_id
        AND o.versao=NEW.operacao_versao
        AND o.estado='aprovada'
        AND (
          (o.tipo='cobranca' AND NEW.acao IN ('registrar_cobranca','cancelar_cobranca')) OR
          (o.tipo='pagamento' AND NEW.acao='executar_pagamento')
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
}
