import { createHash } from "node:crypto";
import { FalhaDeIntegracaoBancaria } from "./contrato.mjs";

function provedorId(idempotencia) {
  return `SIM-${createHash("sha256").update(idempotencia).digest("hex").slice(0, 20).toUpperCase()}`;
}

/**
 * Simula somente o contrato interno do Ecosol. Não representa endpoints,
 * campos, códigos ou garantias reais do Sicoob.
 */
export function criarAdaptadorSicoobSimulado({ banco, decidir } = {}) {
  if (!banco) throw new Error("Informe o banco temporário do simulador.");
  const decidirCenario = decidir ?? (() => "sucesso");
  return {
    nome: "sicoob-simulado",
    async registrarCobranca({ idempotencia, snapshot, tentativa }) {
      const anterior = banco
        .prepare(
          "SELECT provedor_id,estado FROM bancario_simulador_cobrancas WHERE idempotencia=?",
        )
        .get(idempotencia);
      if (anterior)
        return {
          categoria: "sucesso",
          provedor_id: anterior.provedor_id,
          estado: anterior.estado,
          codigo: "SIM_REPETICAO_IDEMPOTENTE",
        };

      const cenario = await decidirCenario({
        etapa: "envio",
        idempotencia,
        tentativa,
      });
      if (cenario === "rejeitada")
        return { categoria: "rejeitada", codigo: "SIM_REJEITADA" };
      if (cenario === "indisponivel_antes_envio")
        throw new FalhaDeIntegracaoBancaria("SIM_INDISPONIVEL", {
          seguroRepetir: true,
        });
      if (cenario === "timeout_sem_aceite")
        throw new FalhaDeIntegracaoBancaria("SIM_TIMEOUT_SEM_REGISTRO");

      const id = provedorId(idempotencia);
      banco
        .prepare(
          `INSERT INTO bancario_simulador_cobrancas
           (idempotencia,provedor_id,estado,valor_centavos)
           VALUES(?,?,'registrada',?)`,
        )
        .run(idempotencia, id, snapshot.cobranca.valor_centavos);
      if (cenario === "aceitar_e_timeout")
        throw new FalhaDeIntegracaoBancaria("SIM_TIMEOUT_APOS_ACEITE");
      return {
        categoria: "sucesso",
        provedor_id: id,
        estado: "registrada",
        codigo: "SIM_REGISTRADA",
      };
    },

    async consultarCobranca({ idempotencia, tentativa }) {
      const cenario = await decidirCenario({
        etapa: "consulta",
        idempotencia,
        tentativa,
      });
      if (cenario === "consulta_indisponivel")
        throw new FalhaDeIntegracaoBancaria("SIM_CONSULTA_INDISPONIVEL", {
          seguroRepetir: true,
        });
      const cobranca = banco
        .prepare(
          "SELECT provedor_id,estado FROM bancario_simulador_cobrancas WHERE idempotencia=?",
        )
        .get(idempotencia);
      if (!cobranca)
        return { categoria: "nao_encontrada", codigo: "SIM_NAO_ENCONTRADA" };
      return {
        categoria: "sucesso",
        provedor_id: cobranca.provedor_id,
        estado: cobranca.estado,
        codigo: "SIM_CONSULTA_CONFIRMADA",
      };
    },
  };
}
