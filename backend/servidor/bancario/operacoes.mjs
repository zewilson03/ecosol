import { createHash, randomUUID } from "node:crypto";
import { obterBanco } from "../bancoDeDados.mjs";
import { temPapelCritico } from "./permissoes.mjs";

const STATUS_FATURA_APROVADA = "Aprovada — aguardando emissão";

function falhar(mensagem, status = 400) {
  const erro = new Error(mensagem);
  erro.status = status;
  throw erro;
}

function ordenar(valor) {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === "object")
    return Object.fromEntries(
      Object.keys(valor)
        .sort()
        .map((chave) => [chave, ordenar(valor[chave])]),
    );
  return valor;
}

export function jsonCanonico(valor) {
  return JSON.stringify(ordenar(valor));
}

export function hashCanonico(valor) {
  return createHash("sha256").update(jsonCanonico(valor)).digest("hex");
}

function configuracaoLocal() {
  const ambiente = String(process.env.SICOOB_AMBIENTE ?? "homologacao")
    .trim()
    .toLowerCase();
  if (!new Set(["homologacao", "producao"]).has(ambiente))
    falhar("Configure SICOOB_AMBIENTE como homologacao ou producao.", 500);
  const contaReferencia = String(
    process.env.SICOOB_CONTA_REFERENCIA ??
      (ambiente === "homologacao" ? "sicoob-homologacao" : ""),
  ).trim();
  if (!contaReferencia || contaReferencia.length > 80)
    falhar("Configure uma referência interna válida para a conta Sicoob.", 500);
  return { ambiente, contaReferencia };
}

function transacaoImediata(acao) {
  const banco = obterBanco();
  banco.exec("BEGIN IMMEDIATE");
  try {
    const resultado = acao(banco);
    banco.exec("COMMIT");
    return resultado;
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

function registrarAuditoria(
  banco,
  operacaoId,
  administrador,
  acao,
  estadoAnterior,
  estadoNovo,
  detalhes = {},
) {
  banco
    .prepare(
      `INSERT INTO bancario_auditoria_operacoes
       (operacao_id,ator_id,ator_nome,acao,estado_anterior,estado_novo,detalhes)
       VALUES(?,?,?,?,?,?,?)`,
    )
    .run(
      operacaoId,
      administrador.id,
      administrador.nome,
      acao,
      estadoAnterior,
      estadoNovo,
      jsonCanonico(detalhes),
    );
}

function faturaAprovada(banco, documentoId) {
  return banco
    .prepare(
      `SELECT d.id,d.hash,d.nome,d.memoria,d.unidade_id,d.competencia,d.status,
              d.finalidade,d.versao,d.excluido_em,u.uc,u.cliente_id,
              u.cliente_provisorio_id,u.cliente_operacional_id,u.pendencia_cadastro,
              c.name AS cliente_nome,c.cpf AS cliente_documento
       FROM faturamento_documentos d
       LEFT JOIN faturamento_unidades u ON u.id=d.unidade_id
       LEFT JOIN customers c ON c.id=u.cliente_id
       WHERE d.id=?`,
    )
    .get(documentoId);
}

function conferirFaturaParaOperacao(fatura) {
  if (!fatura) falhar("Fatura não encontrada.", 404);
  if (
    fatura.status !== STATUS_FATURA_APROVADA ||
    fatura.finalidade !== "cobranca" ||
    fatura.excluido_em !== null ||
    !fatura.memoria
  )
    falhar("A fatura precisa estar aprovada e aguardando emissão.", 409);
  if (
    !fatura.unidade_id ||
    !fatura.cliente_id ||
    !fatura.cliente_documento ||
    fatura.cliente_provisorio_id !== null ||
    fatura.cliente_operacional_id !== null ||
    String(fatura.pendencia_cadastro ?? "").trim()
  )
    falhar("Complete o cadastro definitivo do cliente antes da emissão.", 409);
  let memoria;
  try {
    memoria = JSON.parse(fatura.memoria);
  } catch {
    falhar("A memória aprovada da cobrança está corrompida.", 409);
  }
  if (
    !Number.isSafeInteger(memoria.total_centavos) ||
    memoria.total_centavos <= 0
  )
    falhar("O total aprovado da cobrança é inválido.", 409);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(memoria.vencimento_ecosol ?? "")))
    falhar("O vencimento aprovado da cobrança é inválido.", 409);
  return memoria;
}

function linhaCompleta(banco, operacaoId) {
  const operacao = banco
    .prepare(
      `SELECT o.*,
              p.name AS preparador_nome,
              COALESCE(a.aprovador_id,auto.proprietario_id) AS aprovador_id,
              COALESCE(a.criado_em,auto.criado_em) AS aprovado_em,
              (auto.id IS NOT NULL) AS autoaprovada,
              aprov.name AS aprovador_nome
       FROM bancario_operacoes o
       JOIN staff_users p ON p.id=o.preparado_por
       LEFT JOIN bancario_aprovacoes a
         ON a.operacao_id=o.id AND a.operacao_versao=o.versao
       LEFT JOIN bancario_autoaprovacoes_proprietario auto
         ON auto.operacao_id=o.id AND auto.operacao_versao=o.versao
       LEFT JOIN staff_users aprov ON aprov.id=COALESCE(a.aprovador_id,auto.proprietario_id)
       WHERE o.id=?`,
    )
    .get(operacaoId);
  if (!operacao) falhar("Operação bancária não encontrada.", 404);
  const snapshot = JSON.parse(operacao.snapshot);
  if (snapshot.cliente?.documento) {
    const documento = String(snapshot.cliente.documento).replace(/\D/g, "");
    snapshot.cliente.documento = `${"*".repeat(Math.max(0, documento.length - 4))}${documento.slice(-4)}`;
  }
  return {
    ...operacao,
    snapshot,
    intencao:
      banco
        .prepare(
          `SELECT id,acao,estado,tentativas,criado_em,atualizado_em
           FROM bancario_intencoes WHERE operacao_id=? AND operacao_versao=?
           ORDER BY criado_em DESC LIMIT 1`,
        )
        .get(operacao.id, operacao.versao) ?? null,
    tentativas: banco
      .prepare(
        `SELECT id,etapa,correlacao,resultado,codigo,iniciado_em,concluido_em
         FROM bancario_tentativas WHERE operacao_id=?
         ORDER BY iniciado_em DESC,id DESC`,
      )
      .all(operacao.id),
    auditoria: banco
      .prepare(
        `SELECT ator_nome,acao,estado_anterior,estado_novo,criado_em
         FROM bancario_auditoria_operacoes WHERE operacao_id=?
         ORDER BY id DESC`,
      )
      .all(operacao.id),
  };
}

export function criarOperacaoDeCobranca(documentoId, administrador) {
  if (!Number.isSafeInteger(documentoId) || documentoId <= 0)
    falhar("Informe uma fatura válida.");
  if (!administrador?.id) falhar("Use uma conta nominal da equipe.", 403);
  const configuracao = configuracaoLocal();
  return transacaoImediata((banco) => {
    const fatura = faturaAprovada(banco, documentoId);
    const memoria = conferirFaturaParaOperacao(fatura);
    const snapshot = {
      versao: 1,
      tipo: "cobranca",
      origem: {
        documento_id: fatura.id,
        documento_hash: fatura.hash,
        documento_versao: fatura.versao,
        nome: fatura.nome,
      },
      cliente: {
        id: fatura.cliente_id,
        nome: fatura.cliente_nome,
        documento: fatura.cliente_documento,
      },
      unidade: {
        id: fatura.unidade_id,
        uc: fatura.uc,
        competencia: fatura.competencia,
      },
      cobranca: {
        valor_centavos: memoria.total_centavos,
        moeda: "BRL",
        vencimento: memoria.vencimento_ecosol,
      },
      memoria_calculo: memoria,
    };
    const snapshotHash = hashCanonico(snapshot);
    const idempotencia = hashCanonico({
      tipo: "cobranca",
      ambiente: configuracao.ambiente,
      conta: configuracao.contaReferencia,
      origem: "faturamento_documento",
      origem_id: String(fatura.id),
      origem_versao: fatura.versao,
      snapshot_hash: snapshotHash,
    });
    const existente = banco
      .prepare(
        `SELECT id,idempotencia,snapshot_hash FROM bancario_operacoes
         WHERE tipo='cobranca' AND ambiente=? AND conta_referencia=?
           AND origem_tipo='faturamento_documento' AND origem_id=? AND origem_versao=?`,
      )
      .get(
        configuracao.ambiente,
        configuracao.contaReferencia,
        String(fatura.id),
        fatura.versao,
      );
    if (existente) {
      if (
        existente.idempotencia !== idempotencia ||
        existente.snapshot_hash !== snapshotHash
      )
        falhar(
          "A mesma versão da fatura possui conteúdo divergente. Recalcule antes de prosseguir.",
          409,
        );
      return { criada: false, operacao: linhaCompleta(banco, existente.id) };
    }

    const operacaoId = randomUUID();
    banco
      .prepare(
        `INSERT INTO bancario_operacoes
         (id,tipo,ambiente,conta_referencia,origem_tipo,origem_id,
          origem_versao,idempotencia,valor_centavos,vencimento,snapshot,
          snapshot_hash,estado,preparado_por)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        operacaoId,
        "cobranca",
        configuracao.ambiente,
        configuracao.contaReferencia,
        "faturamento_documento",
        String(fatura.id),
        fatura.versao,
        idempotencia,
        memoria.total_centavos,
        memoria.vencimento_ecosol,
        jsonCanonico(snapshot),
        snapshotHash,
        "aguardando_aprovacao",
        administrador.id,
      );
    registrarAuditoria(
      banco,
      operacaoId,
      administrador,
      "Operação de cobrança preparada",
      null,
      "aguardando_aprovacao",
      { origem_id: String(fatura.id), origem_versao: fatura.versao },
    );
    return { criada: true, operacao: linhaCompleta(banco, operacaoId) };
  });
}

export function aprovarOperacao(
  operacaoId,
  administrador,
  confirmacaoAutoaprovacao = false,
) {
  if (!/^[0-9a-f-]{36}$/.test(String(operacaoId)))
    falhar("Operação bancária inválida.");
  return transacaoImediata((banco) => {
    const operacao = banco
      .prepare("SELECT * FROM bancario_operacoes WHERE id=?")
      .get(operacaoId);
    if (!operacao) falhar("Operação bancária não encontrada.", 404);
    const autoaprovacao = operacao.preparado_por === administrador.id;
    if (autoaprovacao && !temPapelCritico(administrador.id, "proprietario"))
      falhar("Quem preparou a operação não pode aprová-la.", 409);
    if (autoaprovacao && confirmacaoAutoaprovacao !== true)
      falhar("Confirme explicitamente a autoaprovação desta operação.", 400);
    const aprovacaoExistente = banco
      .prepare(
        `SELECT aprovador_id FROM bancario_aprovacoes
         WHERE operacao_id=? AND operacao_versao=?
         UNION ALL
         SELECT proprietario_id FROM bancario_autoaprovacoes_proprietario
         WHERE operacao_id=? AND operacao_versao=?`,
      )
      .get(operacao.id, operacao.versao, operacao.id, operacao.versao);
    if (aprovacaoExistente)
      return { alterada: false, operacao: linhaCompleta(banco, operacao.id) };
    if (operacao.estado !== "aguardando_aprovacao")
      falhar("Esta operação não está aguardando aprovação.", 409);
    if (autoaprovacao) {
      banco
        .prepare(
          `INSERT INTO bancario_autoaprovacoes_proprietario
           (operacao_id,operacao_versao,snapshot_hash,proprietario_id)
           VALUES(?,?,?,?)`,
        )
        .run(
          operacao.id,
          operacao.versao,
          operacao.snapshot_hash,
          administrador.id,
        );
    } else {
      banco
        .prepare(
          `INSERT INTO bancario_aprovacoes
           (operacao_id,operacao_versao,snapshot_hash,preparador_id,aprovador_id)
           VALUES(?,?,?,?,?)`,
        )
        .run(
          operacao.id,
          operacao.versao,
          operacao.snapshot_hash,
          operacao.preparado_por,
          administrador.id,
        );
    }
    banco
      .prepare(
        `UPDATE bancario_operacoes
         SET estado='aprovada',atualizado_em=CURRENT_TIMESTAMP
         WHERE id=? AND estado='aguardando_aprovacao'`,
      )
      .run(operacao.id);
    registrarAuditoria(
      banco,
      operacao.id,
      administrador,
      autoaprovacao ? "Autoaprovação pelo Proprietário" : "Operação aprovada",
      "aguardando_aprovacao",
      "aprovada",
      { snapshot_hash: operacao.snapshot_hash, autoaprovacao },
    );
    return { alterada: true, operacao: linhaCompleta(banco, operacao.id) };
  });
}

function conferirOrigemImutavel(banco, operacao) {
  if (operacao.origem_tipo !== "faturamento_documento")
    falhar("Origem da operação ainda não suportada.", 409);
  const fatura = faturaAprovada(banco, Number(operacao.origem_id));
  const memoria = conferirFaturaParaOperacao(fatura);
  const snapshot = JSON.parse(operacao.snapshot);
  if (
    fatura.versao !== operacao.origem_versao ||
    fatura.hash !== snapshot.origem.documento_hash ||
    hashCanonico(memoria) !== hashCanonico(snapshot.memoria_calculo)
  )
    falhar(
      "A fatura mudou após a preparação. Crie e aprove uma nova operação.",
      409,
    );
}

function conferirAprovacaoAindaValida(banco, operacao) {
  const autoaprovacao = banco
    .prepare(
      `SELECT 1 FROM bancario_autoaprovacoes_proprietario a
       JOIN equipe_papeis_criticos p
         ON p.staff_id=a.proprietario_id AND p.papel='proprietario'
       JOIN staff_users s ON s.id=p.staff_id AND s.access_level=3
       WHERE a.operacao_id=? AND a.operacao_versao=?
         AND a.snapshot_hash=? AND a.proprietario_id=?`,
    )
    .get(
      operacao.id,
      operacao.versao,
      operacao.snapshot_hash,
      operacao.preparado_por,
    );
  if (autoaprovacao) return;
  const aprovacao = banco
    .prepare(
      `SELECT 1
       FROM bancario_aprovacoes a
       JOIN bancario_papeis_equipe p
         ON p.staff_id=a.aprovador_id AND p.papel='aprovador_financeiro'
       WHERE a.operacao_id=? AND a.operacao_versao=?
         AND a.snapshot_hash=? AND a.preparador_id=?`,
    )
    .get(
      operacao.id,
      operacao.versao,
      operacao.snapshot_hash,
      operacao.preparado_por,
    );
  if (!aprovacao)
    falhar(
      "A aprovação perdeu validade porque o aprovador não possui mais a permissão necessária.",
      409,
    );
}

export function conferirOperacaoAntesDoPrimeiroEnvio(banco, operacao) {
  conferirAprovacaoAindaValida(banco, operacao);
  conferirOrigemImutavel(banco, operacao);
}

export function enfileirarOperacao(operacaoId, administrador) {
  if (!/^[0-9a-f-]{36}$/.test(String(operacaoId)))
    falhar("Operação bancária inválida.");
  return transacaoImediata((banco) => {
    const operacao = banco
      .prepare("SELECT * FROM bancario_operacoes WHERE id=?")
      .get(operacaoId);
    if (!operacao) falhar("Operação bancária não encontrada.", 404);
    const existente = banco
      .prepare(
        `SELECT id FROM bancario_intencoes
         WHERE operacao_id=? AND operacao_versao=? AND acao='registrar_cobranca'`,
      )
      .get(operacao.id, operacao.versao);
    if (existente)
      return { criada: false, operacao: linhaCompleta(banco, operacao.id) };
    if (operacao.estado !== "aprovada")
      falhar("A operação precisa estar aprovada antes de entrar na fila.", 409);
    conferirOperacaoAntesDoPrimeiroEnvio(banco, operacao);
    const intencaoId = randomUUID();
    banco
      .prepare(
        `INSERT INTO bancario_intencoes
         (id,operacao_id,operacao_versao,acao,estado,proxima_tentativa_em)
         VALUES(?,?,?,'registrar_cobranca','pendente',?)`,
      )
      .run(intencaoId, operacao.id, operacao.versao, Date.now());
    banco
      .prepare(
        `UPDATE bancario_operacoes
         SET estado='envio_pendente',atualizado_em=CURRENT_TIMESTAMP
         WHERE id=? AND estado='aprovada'`,
      )
      .run(operacao.id);
    registrarAuditoria(
      banco,
      operacao.id,
      administrador,
      "Emissão colocada na fila",
      "aprovada",
      "envio_pendente",
      { intencao_id: intencaoId },
    );
    return { criada: true, operacao: linhaCompleta(banco, operacao.id) };
  });
}

export function listarOperacoes() {
  return obterBanco()
    .prepare(
      `SELECT o.id,o.tipo,o.ambiente,o.conta_referencia,o.origem_tipo,
              o.origem_id,o.origem_versao,o.moeda,o.valor_centavos,
              o.vencimento,o.estado,o.versao,o.criado_em,o.atualizado_em,
              p.name AS preparador_nome,
              COALESCE(a.aprovador_id,auto.proprietario_id) AS aprovador_id,
              (auto.id IS NOT NULL) AS autoaprovada,
              aprov.name AS aprovador_nome,
              (SELECT COUNT(*) FROM bancario_tentativas t
               WHERE t.operacao_id=o.id) AS total_tentativas
       FROM bancario_operacoes o
       JOIN staff_users p ON p.id=o.preparado_por
       LEFT JOIN bancario_aprovacoes a
         ON a.operacao_id=o.id AND a.operacao_versao=o.versao
       LEFT JOIN bancario_autoaprovacoes_proprietario auto
         ON auto.operacao_id=o.id AND auto.operacao_versao=o.versao
       LEFT JOIN staff_users aprov ON aprov.id=COALESCE(a.aprovador_id,auto.proprietario_id)
       ORDER BY o.criado_em DESC,o.id DESC`,
    )
    .all();
}

export function obterOperacao(operacaoId) {
  return linhaCompleta(obterBanco(), operacaoId);
}
