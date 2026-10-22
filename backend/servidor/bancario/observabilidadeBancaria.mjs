import { obterBanco } from "../bancoDeDados.mjs";

const tabelasDeEstado = new Set([
  "bancario_operacoes",
  "bancario_intencoes",
  "bancario_reconciliacoes_cobranca",
]);

function falhar(mensagem) {
  const erro = new Error(mensagem);
  erro.status = 400;
  throw erro;
}

function contagens(banco, tabela) {
  if (!tabelasDeEstado.has(tabela))
    throw new Error("Tabela de observabilidade inválida.");
  return Object.fromEntries(
    banco
      .prepare(
        `SELECT estado,COUNT(*) AS quantidade FROM ${tabela} GROUP BY estado`,
      )
      .all()
      .map((item) => [item.estado, Number(item.quantidade)]),
  );
}

function instanteSqlite(valor) {
  if (!valor) return null;
  const data = Date.parse(`${String(valor).replace(" ", "T")}Z`);
  return Number.isFinite(data) ? data : null;
}

function idadeSegundos(valor, agora) {
  const instante = instanteSqlite(valor);
  return instante === null
    ? null
    : Math.max(0, Math.floor((agora - instante) / 1_000));
}

function codigoSeguro(valor) {
  const codigo = String(valor ?? "").trim();
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(codigo) ? codigo : null;
}

function acaoNecessaria(item, agora) {
  if (item.estado === "aguardando_aprovacao") return "APROVAR_OPERACAO";
  if (item.estado === "aprovada") return "ENFILEIRAR_OPERACAO";
  if (item.estado === "resultado_desconhecido") return "CONCILIAR_COBRANCA";
  if (["rejeitada", "falhou"].includes(item.estado)) return "REVISAR_FALHA";
  if (item.estado === "cancelamento_pendente") return "ACOMPANHAR_CANCELAMENTO";
  if (item.estado === "agendada") return "ACOMPANHAR_PAGAMENTO";
  if (
    item.reconciliacao_estado === "processando" &&
    Number(item.reconciliacao_posse_ate) < agora
  )
    return "RECUPERAR_CONCILIACAO";
  if (["inconclusiva", "falhou"].includes(item.reconciliacao_estado))
    return "REVISAR_CONCILIACAO";
  if (item.estado === "envio_pendente") return "ACOMPANHAR_ENVIO";
  return null;
}

function prioridade(acao) {
  if (
    ["CONCILIAR_COBRANCA", "RECUPERAR_CONCILIACAO", "REVISAR_FALHA"].includes(
      acao,
    )
  )
    return "alta";
  if (acao) return "media";
  return "informativa";
}

const pesoPrioridade = Object.freeze({ alta: 0, media: 1, informativa: 2 });

function ordenarPendencias(a, b) {
  const porPrioridade =
    pesoPrioridade[a.prioridade] - pesoPrioridade[b.prioridade];
  if (porPrioridade) return porPrioridade;
  const idadeA = a.idade_estado_segundos ?? -1;
  const idadeB = b.idade_estado_segundos ?? -1;
  if (idadeA !== idadeB) return idadeB - idadeA;
  return a.operacao_id.localeCompare(b.operacao_id);
}

export function obterObservabilidadeBancaria({
  banco = obterBanco(),
  limite = 50,
  relogio = Date.now,
  variaveis = process.env,
} = {}) {
  const limiteNumerico = Number(limite);
  if (
    !Number.isInteger(limiteNumerico) ||
    limiteNumerico < 1 ||
    limiteNumerico > 200
  )
    falhar("O limite deve ser um inteiro entre 1 e 200.");
  const agora = Number(relogio());
  if (!Number.isSafeInteger(agora) || agora < 0)
    throw new Error("Relógio inválido para observabilidade bancária.");

  const controle = banco
    .prepare(
      "SELECT pausado,alterado_em FROM bancario_controle_executor WHERE id=1",
    )
    .get();
  const operacoesPorEstado = contagens(banco, "bancario_operacoes");
  const intencoesPorEstado = contagens(banco, "bancario_intencoes");
  const reconciliacoesPorEstado = contagens(
    banco,
    "bancario_reconciliacoes_cobranca",
  );

  const linhas = banco
    .prepare(
      `SELECT o.id,o.tipo,o.ambiente,o.moeda,o.valor_centavos,o.vencimento,
              o.estado,o.ultimo_codigo,o.provedor_id,o.criado_em,o.atualizado_em,
              (SELECT i.estado FROM bancario_intencoes i
               WHERE i.operacao_id=o.id ORDER BY i.criado_em DESC,i.id DESC LIMIT 1)
                AS intencao_estado,
              (SELECT i.tentativas FROM bancario_intencoes i
               WHERE i.operacao_id=o.id ORDER BY i.criado_em DESC,i.id DESC LIMIT 1)
                AS intencao_tentativas,
              (SELECT t.resultado FROM bancario_tentativas t
               WHERE t.operacao_id=o.id ORDER BY t.iniciado_em DESC,t.id DESC LIMIT 1)
                AS tentativa_resultado,
              (SELECT t.codigo FROM bancario_tentativas t
               WHERE t.operacao_id=o.id ORDER BY t.iniciado_em DESC,t.id DESC LIMIT 1)
                AS tentativa_codigo,
              (SELECT t.iniciado_em FROM bancario_tentativas t
               WHERE t.operacao_id=o.id ORDER BY t.iniciado_em DESC,t.id DESC LIMIT 1)
                AS tentativa_iniciada_em,
              (SELECT r.estado FROM bancario_reconciliacoes_cobranca r
               WHERE r.operacao_id=o.id ORDER BY r.tentativa DESC,r.iniciado_em DESC LIMIT 1)
                AS reconciliacao_estado,
              (SELECT r.codigo FROM bancario_reconciliacoes_cobranca r
               WHERE r.operacao_id=o.id ORDER BY r.tentativa DESC,r.iniciado_em DESC LIMIT 1)
                AS reconciliacao_codigo,
              (SELECT r.tentativa FROM bancario_reconciliacoes_cobranca r
               WHERE r.operacao_id=o.id ORDER BY r.tentativa DESC,r.iniciado_em DESC LIMIT 1)
                AS reconciliacao_tentativa,
              (SELECT r.posse_ate FROM bancario_reconciliacoes_cobranca r
               WHERE r.operacao_id=o.id ORDER BY r.tentativa DESC,r.iniciado_em DESC LIMIT 1)
                AS reconciliacao_posse_ate
       FROM bancario_operacoes o
       WHERE o.estado NOT IN ('cancelada','liquidada','paga','estornada','registrada')
          OR EXISTS(
            SELECT 1 FROM bancario_reconciliacoes_cobranca r
            WHERE r.operacao_id=o.id AND r.estado IN ('processando','inconclusiva','falhou')
          )
       ORDER BY o.atualizado_em ASC,o.id ASC`,
    )
    .all();

  const todasAsPendencias = linhas.map((linha) => {
    const acao = acaoNecessaria(linha, agora);
    const historicoConciliacao = banco
      .prepare(
        `SELECT estado,estado_anterior,estado_observado,codigo,tentativa,
                solicitado_por_nome,iniciado_em,concluido_em
         FROM bancario_reconciliacoes_cobranca
         WHERE operacao_id=?
         ORDER BY tentativa DESC,iniciado_em DESC LIMIT 5`,
      )
      .all(linha.id)
      .map((item) =>
        Object.freeze({
          estado: item.estado,
          estado_anterior: item.estado_anterior,
          estado_observado: item.estado_observado,
          codigo: codigoSeguro(item.codigo),
          tentativa: Number(item.tentativa),
          solicitado_por: item.solicitado_por_nome
            ? String(item.solicitado_por_nome).slice(0, 200)
            : "Serviço bancário",
          iniciado_em: item.iniciado_em,
          concluido_em: item.concluido_em,
        }),
      );
    return Object.freeze({
      operacao_id: linha.id,
      tipo: linha.tipo,
      ambiente: linha.ambiente,
      moeda: linha.moeda,
      valor_centavos: Number(linha.valor_centavos),
      vencimento: linha.vencimento,
      estado: linha.estado,
      idade_estado_segundos: idadeSegundos(linha.atualizado_em, agora),
      criado_em: linha.criado_em,
      atualizado_em: linha.atualizado_em,
      provedor_identificado: Boolean(linha.provedor_id),
      ultimo_codigo: codigoSeguro(linha.ultimo_codigo),
      intencao: linha.intencao_estado
        ? Object.freeze({
            estado: linha.intencao_estado,
            tentativas: Number(linha.intencao_tentativas ?? 0),
          })
        : null,
      ultima_tentativa: linha.tentativa_iniciada_em
        ? Object.freeze({
            resultado: linha.tentativa_resultado,
            codigo: codigoSeguro(linha.tentativa_codigo),
            iniciado_em: linha.tentativa_iniciada_em,
          })
        : null,
      reconciliacao: linha.reconciliacao_estado
        ? Object.freeze({
            estado: linha.reconciliacao_estado,
            codigo: codigoSeguro(linha.reconciliacao_codigo),
            tentativa: Number(linha.reconciliacao_tentativa),
            posse_expirada:
              linha.reconciliacao_estado === "processando" &&
              Number(linha.reconciliacao_posse_ate) < agora,
          })
        : null,
      historico_conciliacao: Object.freeze(historicoConciliacao),
      acao_necessaria: acao,
      prioridade: prioridade(acao),
    });
  });
  todasAsPendencias.sort(ordenarPendencias);
  const pendencias = todasAsPendencias.slice(0, limiteNumerico);

  return Object.freeze({
    gerado_em: new Date(agora).toISOString(),
    ambiente: String(variaveis.SICOOB_AMBIENTE ?? "homologacao").toLowerCase(),
    executor: Object.freeze({
      pausado: !controle || Boolean(controle.pausado),
      modo: String(
        variaveis.BANCARIO_EXECUTOR_MODO ?? "desligado",
      ).toLowerCase(),
      alterado_em: controle?.alterado_em ?? null,
    }),
    resumo: Object.freeze({
      operacoes_por_estado: Object.freeze(operacoesPorEstado),
      intencoes_por_estado: Object.freeze(intencoesPorEstado),
      reconciliacoes_por_estado: Object.freeze(reconciliacoesPorEstado),
      pendencias_total: todasAsPendencias.length,
      pendencias_listadas: pendencias.length,
      exigem_intervencao: todasAsPendencias.filter(
        (item) => item.acao_necessaria,
      ).length,
      resultado_limitado: todasAsPendencias.length > pendencias.length,
    }),
    pendencias: Object.freeze(pendencias),
    limite: limiteNumerico,
  });
}
