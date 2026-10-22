import { randomUUID } from "node:crypto";
import { obterBanco } from "../bancoDeDados.mjs";
import { criarAdaptadorSicoobSimulado } from "./adaptadorSimulado.mjs";
import { conciliarCobranca } from "./conciliacaoCobrancas.mjs";

function falhar(mensagem, status, codigo) {
  const erro = new Error(mensagem);
  erro.status = status;
  erro.codigo = codigo;
  throw erro;
}

function auditarBloqueio(banco, operacaoId, administrador, codigo) {
  const operacao = banco
    .prepare("SELECT estado FROM bancario_operacoes WHERE id=?")
    .get(String(operacaoId ?? "").trim());
  if (!operacao) return;
  banco
    .prepare(
      `INSERT INTO bancario_auditoria_operacoes
       (operacao_id,ator_id,ator_nome,acao,estado_anterior,estado_novo,detalhes)
       VALUES(?,?,?,'Conciliação manual bloqueada',?,?,?)`,
    )
    .run(
      String(operacaoId).trim(),
      administrador.id,
      String(administrador.nome).trim(),
      operacao.estado,
      operacao.estado,
      JSON.stringify({ codigo }),
    );
}

export function criarAdaptadorDeConciliacaoManual({
  banco = obterBanco(),
  variaveis = process.env,
} = {}) {
  const modo = String(variaveis.BANCARIO_EXECUTOR_MODO ?? "desligado")
    .trim()
    .toLowerCase();
  const ambiente = String(variaveis.SICOOB_AMBIENTE ?? "homologacao")
    .trim()
    .toLowerCase();
  if (modo !== "simulado" || ambiente !== "homologacao")
    falhar(
      "A conciliação manual está disponível somente no simulador de homologação nesta entrega.",
      409,
      "CONCILIACAO_MANUAL_INDISPONIVEL",
    );
  return criarAdaptadorSicoobSimulado({ banco });
}

export async function executarConciliacaoManual({
  operacaoId,
  administrador,
  banco = obterBanco(),
  variaveis = process.env,
  adaptador,
  relogio,
} = {}) {
  if (!administrador?.id || !String(administrador.nome ?? "").trim())
    falhar("Use uma conta nominal da equipe.", 403, "ATOR_INVALIDO");
  const recentes = Number(
    banco
      .prepare(
        `SELECT COUNT(*) AS total FROM bancario_reconciliacoes_cobranca
         WHERE operacao_id=? AND solicitado_por=?
           AND iniciado_em>=datetime('now','-15 minutes')`,
      )
      .get(String(operacaoId ?? "").trim(), administrador.id).total,
  );
  if (recentes >= 5) {
    auditarBloqueio(
      banco,
      operacaoId,
      administrador,
      "CONCILIACAO_LIMITE_ATINGIDO",
    );
    falhar(
      "Limite de consultas atingido para esta cobrança. Aguarde 15 minutos.",
      429,
      "CONCILIACAO_LIMITE_ATINGIDO",
    );
  }
  let resultado;
  try {
    resultado = await conciliarCobranca({
      operacaoId,
      banco,
      adaptador:
        adaptador ?? criarAdaptadorDeConciliacaoManual({ banco, variaveis }),
      relogio,
      executorId: `manual-${randomUUID()}`,
      solicitante: administrador,
    });
  } catch (erro) {
    if (erro?.status) {
      if (Number(erro.status) >= 400 && Number(erro.status) < 500)
        auditarBloqueio(
          banco,
          operacaoId,
          administrador,
          /^[A-Z0-9_]{1,80}$/.test(String(erro.codigo ?? ""))
            ? erro.codigo
            : "CONCILIACAO_INVALIDA",
        );
      throw erro;
    }
    const codigo = String(erro?.codigo ?? "");
    falhar(
      "O serviço de consulta está indisponível. A tentativa foi registrada sem alterar a cobrança.",
      503,
      /^[A-Z0-9_]{1,80}$/.test(codigo) ? codigo : "CONCILIACAO_FALHA_INTERNA",
    );
  }
  if (resultado.ignorada)
    return Object.freeze({
      resultado: "ignorada",
      codigo: "CONCILIACAO_POSSE_PERDIDA",
    });
  const codigo = String(resultado.codigo ?? "");
  return Object.freeze({
    resultado: resultado.resultado,
    estado_anterior: resultado.estadoAnterior,
    estado_atual: resultado.estadoAtual,
    codigo: /^[A-Z0-9_]{1,80}$/.test(codigo)
      ? codigo
      : "CONCILIACAO_INCONCLUSIVA",
  });
}
