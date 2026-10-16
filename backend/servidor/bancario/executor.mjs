import { randomUUID } from "node:crypto";
import { obterBanco } from "../bancoDeDados.mjs";
import { criarAdaptadorSicoobSimulado } from "./adaptadorSimulado.mjs";
import { FalhaDeIntegracaoBancaria } from "./contrato.mjs";
import { conferirOperacaoAntesDoPrimeiroEnvio } from "./operacoes.mjs";

const cincoMinutos = 5 * 60_000;
const quinzeMinutos = 15 * 60_000;

function esperaAposFalha(tentativas) {
  return Math.min(15_000 * 2 ** Math.min(tentativas, 6), quinzeMinutos);
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

function auditarServico(banco, operacaoId, acao, anterior, novo, detalhes) {
  banco
    .prepare(
      `INSERT INTO bancario_auditoria_operacoes
       (operacao_id,ator_id,ator_nome,acao,estado_anterior,estado_novo,detalhes)
       VALUES(?,0,'Serviço bancário',?,?,?,?)`,
    )
    .run(operacaoId, acao, anterior, novo, JSON.stringify(detalhes ?? {}));
}

function assumirProxima(banco, executorId, agora) {
  return emTransacao(banco, () => {
    const controle = banco
      .prepare("SELECT pausado FROM bancario_controle_executor WHERE id=1")
      .get();
    if (!controle || controle.pausado) return null;
    const intencao = banco
      .prepare(
        `SELECT i.*,o.idempotencia,o.snapshot,o.estado AS operacao_estado,
                o.provedor_id,o.tipo
         FROM bancario_intencoes i
         JOIN bancario_operacoes o ON o.id=i.operacao_id
         WHERE (
           (i.estado IN ('pendente','resultado_desconhecido')
             AND COALESCE(i.proxima_tentativa_em,0)<=?)
           OR (i.estado='processando' AND COALESCE(i.posse_ate,0)<?)
         )
         ORDER BY CASE i.estado
           WHEN 'resultado_desconhecido' THEN 0
           WHEN 'processando' THEN 1 ELSE 2 END,
           i.criado_em,i.id
         LIMIT 1`,
      )
      .get(agora, agora);
    if (!intencao) return null;

    const etapa =
      intencao.estado === "pendente" &&
      intencao.operacao_estado === "envio_pendente"
        ? "envio"
        : "consulta";
    if (etapa === "envio") {
      const operacao = banco
        .prepare("SELECT * FROM bancario_operacoes WHERE id=?")
        .get(intencao.operacao_id);
      try {
        conferirOperacaoAntesDoPrimeiroEnvio(banco, operacao);
      } catch (erro) {
        banco
          .prepare(
            `UPDATE bancario_intencoes
             SET estado='falhou',posse_por=NULL,posse_ate=NULL,
                 atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(intencao.id);
        banco
          .prepare(
            `UPDATE bancario_operacoes
             SET estado='falhou',ultimo_codigo='VALIDACAO_ANTES_ENVIO',
                 atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(intencao.operacao_id);
        auditarServico(
          banco,
          intencao.operacao_id,
          "Envio bloqueado pela revalidação",
          "envio_pendente",
          "falhou",
          { intencao_id: intencao.id, codigo: "VALIDACAO_ANTES_ENVIO" },
        );
        return { bloqueada: true, codigo: "VALIDACAO_ANTES_ENVIO" };
      }
    }
    if (etapa === "consulta" && intencao.operacao_estado === "envio_pendente") {
      banco
        .prepare(
          `UPDATE bancario_operacoes
           SET estado='resultado_desconhecido',ultimo_codigo='POSSE_EXPIRADA',
               atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
        )
        .run(intencao.operacao_id);
      auditarServico(
        banco,
        intencao.operacao_id,
        "Posse expirada; envio considerado inconclusivo",
        "envio_pendente",
        "resultado_desconhecido",
        { intencao_id: intencao.id },
      );
      intencao.operacao_estado = "resultado_desconhecido";
    }

    banco
      .prepare(
        `UPDATE bancario_intencoes
         SET estado='processando',tentativas=tentativas+1,posse_por=?,posse_ate=?,
             atualizado_em=CURRENT_TIMESTAMP
         WHERE id=?`,
      )
      .run(executorId, agora + cincoMinutos, intencao.id);
    const tentativaId = randomUUID();
    const correlacao = randomUUID();
    banco
      .prepare(
        `INSERT INTO bancario_tentativas
         (id,intencao_id,operacao_id,etapa,correlacao)
         VALUES(?,?,?,?,?)`,
      )
      .run(tentativaId, intencao.id, intencao.operacao_id, etapa, correlacao);
    return {
      ...intencao,
      snapshot: JSON.parse(intencao.snapshot),
      etapa,
      tentativa_id: tentativaId,
      correlacao,
      numero_tentativa: intencao.tentativas + 1,
    };
  });
}

function finalizar(banco, trabalho, resultado, agora) {
  return emTransacao(banco, () => {
    const posse = banco
      .prepare("SELECT estado,posse_por FROM bancario_intencoes WHERE id=?")
      .get(trabalho.id);
    if (
      posse?.estado !== "processando" ||
      posse.posse_por !== trabalho.executor
    )
      return { ignorada: true, motivo: "posse_perdida" };

    let estadoIntencao;
    let estadoOperacao = trabalho.operacao_estado;
    let proxima = null;
    if (resultado.categoria === "sucesso") {
      estadoIntencao = "concluida";
      estadoOperacao =
        resultado.estado === "liquidada" ? "liquidada" : "registrada";
    } else if (resultado.categoria === "rejeitada") {
      estadoIntencao = "falhou";
      estadoOperacao = "rejeitada";
    } else if (
      resultado.categoria === "resultado_desconhecido" ||
      resultado.categoria === "nao_encontrada"
    ) {
      estadoIntencao = "resultado_desconhecido";
      estadoOperacao = "resultado_desconhecido";
      proxima = agora + esperaAposFalha(trabalho.numero_tentativa);
    } else if (resultado.categoria === "falha_segura") {
      if (trabalho.etapa === "envio" && trabalho.numero_tentativa >= 8) {
        estadoIntencao = "falhou";
        estadoOperacao = "falhou";
      } else {
        estadoIntencao =
          trabalho.etapa === "envio" ? "pendente" : "resultado_desconhecido";
        estadoOperacao =
          trabalho.etapa === "envio"
            ? "envio_pendente"
            : "resultado_desconhecido";
        proxima = agora + esperaAposFalha(trabalho.numero_tentativa);
      }
    } else {
      throw new Error("Categoria interna de resultado bancário inválida.");
    }

    banco
      .prepare(
        `UPDATE bancario_tentativas
         SET resultado=?,codigo=?,concluido_em=CURRENT_TIMESTAMP WHERE id=?`,
      )
      .run(
        resultado.categoria,
        resultado.codigo ?? null,
        trabalho.tentativa_id,
      );
    banco
      .prepare(
        `UPDATE bancario_intencoes
         SET estado=?,posse_por=NULL,posse_ate=NULL,proxima_tentativa_em=?,
             atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
      )
      .run(estadoIntencao, proxima, trabalho.id);
    banco
      .prepare(
        `UPDATE bancario_operacoes
         SET estado=?,provedor_id=COALESCE(?,provedor_id),ultimo_codigo=?,
             atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
      )
      .run(
        estadoOperacao,
        resultado.provedor_id ?? null,
        resultado.codigo ?? null,
        trabalho.operacao_id,
      );
    if (estadoOperacao !== trabalho.operacao_estado)
      auditarServico(
        banco,
        trabalho.operacao_id,
        `Executor: ${resultado.categoria}`,
        trabalho.operacao_estado,
        estadoOperacao,
        { intencao_id: trabalho.id, tentativa_id: trabalho.tentativa_id },
      );
    return { ignorada: false, estadoIntencao, estadoOperacao };
  });
}

export function criarExecutorBancario({
  banco = obterBanco(),
  adaptador,
  relogio = () => Date.now(),
  executorId = randomUUID(),
} = {}) {
  if (!adaptador) throw new Error("Informe o adaptador bancário.");
  let emAndamento = false;
  return {
    id: executorId,
    async processarUma() {
      if (emAndamento) return { processada: false, motivo: "em_andamento" };
      emAndamento = true;
      try {
        const trabalho = assumirProxima(banco, executorId, relogio());
        if (!trabalho) return { processada: false, motivo: "sem_trabalho" };
        if (trabalho.bloqueada)
          return {
            processada: true,
            motivo: "bloqueada_antes_envio",
            codigo: trabalho.codigo,
          };
        trabalho.executor = executorId;
        let resultado;
        try {
          resultado =
            trabalho.etapa === "envio"
              ? await adaptador.registrarCobranca({
                  idempotencia: trabalho.idempotencia,
                  snapshot: trabalho.snapshot,
                  correlacao: trabalho.correlacao,
                  tentativa: trabalho.numero_tentativa,
                })
              : await adaptador.consultarCobranca({
                  idempotencia: trabalho.idempotencia,
                  provedor_id: trabalho.provedor_id,
                  correlacao: trabalho.correlacao,
                  tentativa: trabalho.numero_tentativa,
                });
        } catch (erro) {
          resultado = {
            categoria:
              erro instanceof FalhaDeIntegracaoBancaria && erro.seguroRepetir
                ? "falha_segura"
                : "resultado_desconhecido",
            codigo:
              erro instanceof FalhaDeIntegracaoBancaria
                ? erro.codigo
                : "FALHA_NAO_CLASSIFICADA",
          };
        }
        const conclusao = finalizar(banco, trabalho, resultado, relogio());
        return { processada: true, trabalho, resultado, conclusao };
      } finally {
        emAndamento = false;
      }
    },
  };
}

export function iniciarExecutorBancarioSeConfigurado() {
  const modo = String(process.env.BANCARIO_EXECUTOR_MODO ?? "desligado")
    .trim()
    .toLowerCase();
  if (modo === "desligado" || !modo) return null;
  if (modo !== "simulado")
    throw new Error("Modo de executor bancário ainda não suportado.");
  const ambiente = String(process.env.SICOOB_AMBIENTE ?? "homologacao")
    .trim()
    .toLowerCase();
  if (ambiente !== "homologacao")
    throw new Error("O simulador bancário só pode operar em homologação.");
  const banco = obterBanco();
  const executor = criarExecutorBancario({
    banco,
    adaptador: criarAdaptadorSicoobSimulado({ banco }),
  });
  const executar = () => {
    void executor.processarUma().catch(() => {
      // A falha categorizada fica na tentativa; não registrar payloads bancários.
    });
  };
  executar();
  setInterval(executar, 5_000).unref();
  return executor;
}
