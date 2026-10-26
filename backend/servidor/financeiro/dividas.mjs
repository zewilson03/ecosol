import { obterVisaoDeRecebiveis } from "./recebiveis.mjs";
import { calcularEncargosAtraso } from "./encargosAtraso.mjs";

export const LIMITE_PADRAO_ALERTA_DIVIDA_CENTAVOS = 1_000_000;

function limiteConfigurado() {
  const texto = String(
    process.env.ECOSOL_LIMITE_ALERTA_DIVIDA_CENTAVOS ??
      LIMITE_PADRAO_ALERTA_DIVIDA_CENTAVOS,
  );
  if (!/^\d+$/.test(texto))
    throw new Error("O limite de alerta de dívida possui formato inválido.");
  const limite = Number(texto);
  if (!Number.isSafeInteger(limite) || limite <= 0)
    throw new Error("O limite de alerta de dívida deve ser positivo.");
  return limite;
}

export function obterApuracaoDeDividas(
  banco,
  consulta = {},
  hoje,
  limiteCentavos = limiteConfigurado(),
) {
  if (!Number.isSafeInteger(limiteCentavos) || limiteCentavos <= 0)
    throw new Error("O limite de alerta de dívida deve ser positivo.");

  const visao = obterVisaoDeRecebiveis(
    banco,
    { ...consulta, status: "vencido" },
    hoje,
  );
  const porUc = new Map();
  const semUc = [];

  for (const recebivel of visao.recebiveis) {
    if (!recebivel.uc) {
      semUc.push(recebivel.id);
      continue;
    }
    const encargosCalculados = calcularEncargosAtraso({
      principal_centavos: recebivel.valor_centavos,
      vencimento: recebivel.vencimento,
      data_referencia: visao.hoje,
    });
    const encargosTransferidos = Number(
      recebivel.encargos_transferidos_centavos ?? 0,
    );
    if (!Number.isSafeInteger(encargosTransferidos) || encargosTransferidos < 0)
      throw new Error("O total de encargos transferidos é inválido.");
    const encargos = encargosTransferidos
      ? {
          ...encargosCalculados,
          multa_centavos: 0,
          juros_centavos: 0,
          total_centavos: 0,
        }
      : encargosCalculados;
    const atual = porUc.get(recebivel.uc) ?? {
      uc: recebivel.uc,
      cliente: recebivel.cliente,
      principal_centavos: 0,
      encargos_centavos: 0,
      total_centavos: 0,
      cobrancas: [],
    };
    atual.principal_centavos += recebivel.valor_centavos;
    atual.encargos_centavos += encargos.total_centavos;
    atual.total_centavos += recebivel.valor_centavos + encargos.total_centavos;
    if (!Number.isSafeInteger(atual.total_centavos))
      throw new Error("A dívida acumulada excedeu o limite seguro de cálculo.");
    atual.cobrancas.push({
      operacao_id: recebivel.id,
      documento_id: recebivel.documento_id,
      competencia: recebivel.competencia,
      vencimento: recebivel.vencimento,
      principal_centavos: recebivel.valor_centavos,
      dias_atraso: encargos.dias_atraso,
      dias_juros: encargos.dias_juros,
      encargos_transferidos_centavos: encargosTransferidos,
      multa_centavos: encargos.multa_centavos,
      juros_centavos: encargos.juros_centavos,
      encargos_centavos: encargos.total_centavos,
      total_centavos: recebivel.valor_centavos + encargos.total_centavos,
    });
    porUc.set(recebivel.uc, atual);
  }

  const dividas = [...porUc.values()]
    .map((divida) => ({
      ...divida,
      alerta: divida.total_centavos > limiteCentavos,
    }))
    .sort(
      (primeira, segunda) =>
        segunda.total_centavos - primeira.total_centavos ||
        primeira.uc.localeCompare(segunda.uc),
    );

  const valorTotalCentavos = dividas.reduce((total, divida) => {
    const proximo = total + divida.total_centavos;
    if (!Number.isSafeInteger(proximo))
      throw new Error("O total de dívidas excedeu o limite seguro de cálculo.");
    return proximo;
  }, 0);

  return {
    data_referencia: visao.hoje,
    limite_alerta_centavos: limiteCentavos,
    totais: {
      unidades: dividas.length,
      alertas: dividas.filter((divida) => divida.alerta).length,
      valor_centavos: valorTotalCentavos,
      cobrancas_sem_uc: semUc.length,
    },
    dividas,
  };
}
