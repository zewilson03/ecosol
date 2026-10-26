import Decimal from "decimal.js";

const D = Decimal.clone({ precision: 36, rounding: Decimal.ROUND_HALF_UP });
const DIA_EM_MILISSEGUNDOS = 24 * 60 * 60 * 1000;

export const REGRA_ENCARGOS_ATRASO = "ecosol-encargos-atraso-v1";

function dataUtc(valor, nome) {
  const texto = String(valor ?? "");
  const data = new Date(`${texto}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(texto) ||
    !Number.isFinite(data.getTime()) ||
    data.toISOString().slice(0, 10) !== texto
  )
    throw new Error(`${nome} inválida para calcular os encargos de atraso.`);
  return data;
}

function centavosSeguros(valor, nome) {
  const numero = new D(valor)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
  if (!Number.isSafeInteger(numero) || numero < 0)
    throw new Error(`${nome} excedeu o limite monetário seguro.`);
  return numero;
}

export function hojeEmSaoPaulo(agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);
  const parte = (tipo) => partes.find((item) => item.type === tipo)?.value;
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}

export function calcularEncargosAtraso({
  principal_centavos,
  vencimento,
  data_referencia,
}) {
  if (!Number.isSafeInteger(principal_centavos) || principal_centavos <= 0)
    throw new Error("O principal da cobrança vencida deve ser positivo.");
  const vencimentoUtc = dataUtc(vencimento, "Data de vencimento");
  const referenciaUtc = dataUtc(data_referencia, "Data de referência");
  const diasAtraso = Math.floor(
    (referenciaUtc.getTime() - vencimentoUtc.getTime()) / DIA_EM_MILISSEGUNDOS,
  );

  if (diasAtraso <= 1)
    return {
      regra: REGRA_ENCARGOS_ATRASO,
      principal_centavos,
      dias_atraso: Math.max(0, diasAtraso),
      dias_juros: 0,
      multa_percentual: "3.00",
      juros_mensal_percentual: "1.50",
      juros_diario_percentual: "0.05",
      multa_centavos: 0,
      juros_centavos: 0,
      total_centavos: 0,
    };

  const diasJuros = diasAtraso - 1;
  const principal = new D(principal_centavos);
  const multaCentavos = centavosSeguros(
    principal.times("0.03"),
    "A multa por atraso",
  );
  const jurosCentavos = centavosSeguros(
    principal.times("0.015").div(30).times(diasJuros),
    "Os juros por atraso",
  );
  const totalCentavos = multaCentavos + jurosCentavos;
  if (!Number.isSafeInteger(totalCentavos))
    throw new Error(
      "Os encargos de atraso excederam o limite monetário seguro.",
    );

  return {
    regra: REGRA_ENCARGOS_ATRASO,
    principal_centavos,
    dias_atraso: diasAtraso,
    dias_juros: diasJuros,
    multa_percentual: "3.00",
    juros_mensal_percentual: "1.50",
    juros_diario_percentual: "0.05",
    multa_centavos: multaCentavos,
    juros_centavos: jurosCentavos,
    total_centavos: totalCentavos,
  };
}
