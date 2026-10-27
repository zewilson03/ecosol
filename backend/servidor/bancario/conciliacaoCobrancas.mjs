import { randomUUID } from "node:crypto";
import { obterBanco } from "../bancoDeDados.mjs";
import { FalhaDeIntegracaoBancaria } from "./contrato.mjs";

const estadosConsultaveis = new Set([
  "registrada",
  "resultado_desconhecido",
  "liquidada",
]);
const duracaoPosseMs = 5 * 60_000;

function falhar(mensagem, status = 400, codigo = "CONCILIACAO_INVALIDA") {
  const erro = new Error(mensagem);
  erro.status = status;
  erro.codigo = codigo;
  throw erro;
}

function emTransacao(banco, acao) {
  banco.exec("BEGIN IMMEDIATE");
  try {
    const resultado = acao();
    banco.exec("COMMIT");
    return resultado;
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

function auditarRecuperacao(banco, operacao, anterior) {
  banco
    .prepare(
      `INSERT INTO bancario_auditoria_operacoes
     (operacao_id,ator_id,ator_nome,acao,estado_anterior,estado_novo,detalhes)
     VALUES(?,0,'Serviço bancário','Recuperação de conciliação expirada',?,?,?)`,
    )
    .run(
      operacao.id,
      operacao.estado,
      operacao.estado,
      JSON.stringify({
        reconciliacao_id: anterior.id,
        correlacao: anterior.correlacao,
        codigo: "CONCILIACAO_POSSE_EXPIRADA",
      }),
    );
}

function iniciar(banco, operacaoId, executorId, agora, solicitante) {
  return emTransacao(banco, () => {
    const operacao = banco
      .prepare("SELECT * FROM bancario_operacoes WHERE id=?")
      .get(operacaoId);
    if (!operacao) falhar("Operação bancária não encontrada.", 404);
    if (operacao.tipo !== "cobranca")
      falhar("Somente cobranças podem ser conciliadas por este serviço.", 409);
    if (!estadosConsultaveis.has(operacao.estado))
      falhar("A cobrança ainda não está pronta para conciliação.", 409);
    if (!String(operacao.provedor_id ?? "").trim())
      falhar(
        "A cobrança não possui nosso número para consulta segura.",
        409,
        "CONCILIACAO_SEM_NOSSO_NUMERO",
      );

    const anterior = banco
      .prepare(
        `SELECT id,correlacao,posse_ate
       FROM bancario_reconciliacoes_cobranca
       WHERE operacao_id=? AND estado='processando'`,
      )
      .get(operacao.id);
    if (anterior && Number(anterior.posse_ate) >= agora)
      falhar(
        "Esta cobrança já possui uma conciliação em andamento.",
        409,
        "CONCILIACAO_EM_ANDAMENTO",
      );
    if (anterior) {
      const expirada = banco
        .prepare(
          `UPDATE bancario_reconciliacoes_cobranca
         SET estado='inconclusiva',codigo='CONCILIACAO_POSSE_EXPIRADA',
             posse_por=NULL,posse_ate=NULL,concluido_em=CURRENT_TIMESTAMP
         WHERE id=? AND estado='processando' AND posse_ate<?`,
        )
        .run(anterior.id, agora);
      if (expirada.changes !== 1)
        falhar(
          "Esta cobrança já possui uma conciliação em andamento.",
          409,
          "CONCILIACAO_EM_ANDAMENTO",
        );
      auditarRecuperacao(banco, operacao, anterior);
    }

    const tentativa = Number(
      banco
        .prepare(
          `SELECT COALESCE(MAX(tentativa),0)+1 AS proxima
         FROM bancario_reconciliacoes_cobranca WHERE operacao_id=?`,
        )
        .get(operacao.id).proxima,
    );
    const id = randomUUID();
    const correlacao = randomUUID();
    banco
      .prepare(
        `INSERT INTO bancario_reconciliacoes_cobranca
       (id,operacao_id,correlacao,estado,estado_anterior,tentativa,
        solicitado_por,solicitado_por_nome,posse_por,posse_ate)
       VALUES(?,?,?,'processando',?,?,?,?,?,?)`,
      )
      .run(
        id,
        operacao.id,
        correlacao,
        operacao.estado,
        tentativa,
        solicitante?.id ?? null,
        solicitante?.nome ?? null,
        executorId,
        agora + duracaoPosseMs,
      );
    if (solicitante) {
      banco
        .prepare(
          `INSERT INTO bancario_auditoria_operacoes
           (operacao_id,ator_id,ator_nome,acao,estado_anterior,estado_novo,detalhes)
           VALUES(?,?,?,'Conciliação manual solicitada',?,?,?)`,
        )
        .run(
          operacao.id,
          solicitante.id,
          solicitante.nome,
          operacao.estado,
          operacao.estado,
          JSON.stringify({ tentativa, reconciliacao_id: id }),
        );
    }
    return {
      id,
      correlacao,
      executorId,
      tentativa,
      operacaoId: operacao.id,
      estadoAnterior: operacao.estado,
      provedorId: operacao.provedor_id,
      idempotencia: operacao.idempotencia,
      snapshot: JSON.parse(operacao.snapshot),
    };
  });
}

function concluir(banco, trabalho, resultado) {
  return emTransacao(banco, () => {
    const reconciliacao = banco
      .prepare(
        "SELECT estado,posse_por FROM bancario_reconciliacoes_cobranca WHERE id=?",
      )
      .get(trabalho.id);
    if (
      reconciliacao?.estado !== "processando" ||
      reconciliacao.posse_por !== trabalho.executorId
    )
      return { ignorada: true, motivo: "posse_perdida" };

    const operacao = banco
      .prepare(
        "SELECT estado,provedor_id,valor_centavos FROM bancario_operacoes WHERE id=?",
      )
      .get(trabalho.operacaoId);
    if (!operacao) falhar("Operação bancária não encontrada.", 404);

    const provedorRecebido = String(resultado?.provedor_id ?? "").trim();
    const provedorEsperado = String(operacao.provedor_id ?? "").trim();
    const estadoObservado = String(resultado?.estado ?? "").trim();
    const valorPagoInformado = resultado?.valor_pago_centavos != null;
    const valorPago = Number(resultado?.valor_pago_centavos);
    const valorPagoValido =
      !valorPagoInformado ||
      (Number.isSafeInteger(valorPago) && valorPago >= 0);
    const valorConfere =
      !valorPagoInformado || valorPago === Number(operacao.valor_centavos);
    const sucessoValido =
      resultado?.categoria === "sucesso" &&
      provedorRecebido &&
      provedorRecebido === provedorEsperado &&
      new Set(["registrada", "liquidada"]).has(estadoObservado) &&
      valorPagoValido &&
      (estadoObservado !== "liquidada" || valorConfere);

    let estadoReconciliacao = "inconclusiva";
    let estadoNovo = operacao.estado;
    let codigo = String(resultado?.codigo ?? "CONCILIACAO_INCONCLUSIVA");
    if (sucessoValido) {
      estadoReconciliacao = "concluida";
      if (estadoObservado === "liquidada") estadoNovo = "liquidada";
      else if (operacao.estado === "resultado_desconhecido")
        estadoNovo = "registrada";
    } else if (
      resultado?.categoria === "sucesso" &&
      provedorRecebido !== provedorEsperado
    ) {
      codigo = "CONCILIACAO_PROVEDOR_DIVERGENTE";
    } else if (!valorPagoValido) {
      codigo = "CONCILIACAO_VALOR_INVALIDO";
    } else if (
      resultado?.categoria === "sucesso" &&
      estadoObservado === "liquidada" &&
      valorPagoInformado &&
      valorPago < Number(operacao.valor_centavos)
    ) {
      codigo = "CONCILIACAO_PAGAMENTO_PARCIAL";
    } else if (
      resultado?.categoria === "sucesso" &&
      estadoObservado === "liquidada" &&
      valorPagoInformado &&
      valorPago > Number(operacao.valor_centavos)
    ) {
      codigo = "CONCILIACAO_VALOR_EXCEDENTE";
    } else if (
      resultado?.categoria === "sucesso" &&
      estadoObservado === "estornada"
    ) {
      codigo = "CONCILIACAO_ESTORNO_REQUER_REVISAO";
    }

    if (estadoNovo !== operacao.estado)
      banco
        .prepare(
          `UPDATE bancario_operacoes
         SET estado=?,ultimo_codigo=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
        )
        .run(estadoNovo, codigo, trabalho.operacaoId);

    banco
      .prepare(
        `UPDATE bancario_reconciliacoes_cobranca
       SET estado=?,estado_observado=?,codigo=?,posse_por=NULL,posse_ate=NULL,
           concluido_em=CURRENT_TIMESTAMP
       WHERE id=? AND estado='processando' AND posse_por=?`,
      )
      .run(
        estadoReconciliacao,
        estadoObservado || null,
        codigo,
        trabalho.id,
        trabalho.executorId,
      );
    banco
      .prepare(
        `INSERT INTO bancario_auditoria_operacoes
       (operacao_id,ator_id,ator_nome,acao,estado_anterior,estado_novo,detalhes)
       VALUES(?,0,'Serviço bancário','Conciliação de cobrança',?,?,?)`,
      )
      .run(
        trabalho.operacaoId,
        operacao.estado,
        estadoNovo,
        JSON.stringify({
          reconciliacao_id: trabalho.id,
          correlacao: trabalho.correlacao,
          tentativa: trabalho.tentativa,
          resultado: estadoReconciliacao,
          codigo,
        }),
      );
    return {
      conciliacaoId: trabalho.id,
      resultado: estadoReconciliacao,
      estadoAnterior: operacao.estado,
      estadoAtual: estadoNovo,
      codigo,
    };
  });
}

function registrarFalha(banco, trabalho, erro) {
  const codigo =
    erro instanceof FalhaDeIntegracaoBancaria
      ? erro.codigo
      : "CONCILIACAO_FALHA_INTERNA";
  emTransacao(banco, () => {
    const alteracao = banco
      .prepare(
        `UPDATE bancario_reconciliacoes_cobranca
       SET estado='falhou',codigo=?,posse_por=NULL,posse_ate=NULL,
           concluido_em=CURRENT_TIMESTAMP
       WHERE id=? AND estado='processando' AND posse_por=?`,
      )
      .run(codigo, trabalho.id, trabalho.executorId);
    if (alteracao.changes !== 1) return;
    banco
      .prepare(
        `INSERT INTO bancario_auditoria_operacoes
       (operacao_id,ator_id,ator_nome,acao,estado_anterior,estado_novo,detalhes)
       VALUES(?,0,'Serviço bancário','Falha na conciliação de cobrança',?,?,?)`,
      )
      .run(
        trabalho.operacaoId,
        trabalho.estadoAnterior,
        trabalho.estadoAnterior,
        JSON.stringify({
          reconciliacao_id: trabalho.id,
          correlacao: trabalho.correlacao,
          tentativa: trabalho.tentativa,
          codigo,
        }),
      );
  });
}

export async function conciliarCobranca({
  operacaoId,
  adaptador,
  banco = obterBanco(),
  relogio = Date.now,
  executorId = randomUUID(),
  solicitante = null,
} = {}) {
  if (!adaptador?.consultarCobranca)
    falhar("Adaptador bancário indisponível.", 503);
  const agora = Number(relogio());
  if (!Number.isSafeInteger(agora) || agora < 0)
    falhar("Relógio inválido para conciliação.", 500);
  const identificadorExecutor = String(executorId ?? "").trim();
  if (!identificadorExecutor || identificadorExecutor.length > 100)
    falhar("Identificador do executor inválido.", 500);
  const solicitanteSeguro = solicitante
    ? {
        id: Number(solicitante.id),
        nome: String(solicitante.nome ?? "").trim(),
      }
    : null;
  if (
    solicitanteSeguro &&
    (!Number.isSafeInteger(solicitanteSeguro.id) ||
      solicitanteSeguro.id < 1 ||
      !solicitanteSeguro.nome ||
      solicitanteSeguro.nome.length > 200)
  )
    falhar("Solicitante inválido para auditoria.", 500);
  const trabalho = iniciar(
    banco,
    String(operacaoId ?? "").trim(),
    identificadorExecutor,
    agora,
    solicitanteSeguro,
  );
  try {
    const resultado = await adaptador.consultarCobranca({
      idempotencia: trabalho.idempotencia,
      provedor_id: trabalho.provedorId,
      snapshot: trabalho.snapshot,
      correlacao: trabalho.correlacao,
      tentativa: trabalho.tentativa,
    });
    return concluir(banco, trabalho, resultado);
  } catch (erro) {
    registrarFalha(banco, trabalho, erro);
    throw erro;
  }
}
