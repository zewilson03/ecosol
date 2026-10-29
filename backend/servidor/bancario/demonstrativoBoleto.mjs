import Decimal from "decimal.js";

const D = Decimal.clone({ precision: 36, rounding: Decimal.ROUND_HALF_EVEN });

function centavos(valor) {
  const numero = new D(valor)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN)
    .times(100)
    .toNumber();
  if (!Number.isSafeInteger(numero))
    throw new Error("Valor monetário inválido.");
  return numero;
}

/** Apenas apresentação: a cobrança aprovada e seu snapshot permanecem intactos. */
export function montarDemonstrativoBoleto(snapshot, consumoTotalExtraido) {
  if (
    snapshot?.tipo !== "cobranca" ||
    !snapshot.memoria_calculo?.entradas ||
    !snapshot.memoria_calculo?.tarifa_completa
  )
    return null;
  const memoria = snapshot.memoria_calculo;
  const entrada = memoria.entradas;
  const injetada = new D(entrada.injecao ?? "0");
  const tarifa = new D(memoria.tarifa_completa ?? "0");
  const desconto = new D(entrada.desconto ?? "0");
  const energiaSemDesconto = injetada.times(tarifa);
  const energiaComDesconto = energiaSemDesconto.times(
    new D(1).minus(desconto.div(100)),
  );
  const encargosAtraso = new D(
    snapshot.cobranca?.encargos_atraso_centavos ?? 0,
  ).div(100);
  const classico = memoria.modelo_calculo === "classico";
  const equatorial = classico
    ? null
    : new D(memoria.equatorial_centavos ?? 0).div(100);
  const base = classico
    ? new D(memoria.tarifa_minima_bruto ?? "0").plus(entrada.iluminacao ?? "0")
    : equatorial
        .minus(new D(memoria.juros_centavos ?? 0).div(100))
        .minus(new D(memoria.multa_centavos ?? 0).div(100))
        .minus(new D(memoria.ajuste_centavos ?? 0).div(100));
  const valorFinal = snapshot.cobranca?.valor_centavos;
  if (!Number.isSafeInteger(valorFinal) || valorFinal <= 0)
    throw new Error("Cobrança sem valor aprovado.");
  if (
    !Number.isSafeInteger(memoria.total_centavos) ||
    memoria.total_centavos +
      (snapshot.cobranca?.encargos_atraso_centavos ?? 0) !==
      valorFinal
  )
    throw new Error("Valor bancário diverge do cálculo aprovado.");
  const referencia = centavos(
    energiaSemDesconto.plus(base).plus(encargosAtraso),
  );
  const consumoTotal =
    consumoTotalExtraido ?? (classico ? entrada.consumo_total : null);
  const consumoTotalValido =
    consumoTotal != null &&
    /^\d+(?:\.\d{1,2})?$/.test(String(consumoTotal)) &&
    new D(consumoTotal).gt(0) &&
    new D(consumoTotal).gte(injetada)
      ? String(consumoTotal)
      : null;
  return {
    consumo_total_kwh: consumoTotalValido,
    energia_injetada_kwh: injetada.toFixed(2),
    tarifa_kwh: tarifa.toFixed(6),
    desconto_percentual: desconto.toString(),
    energia_sem_desconto_centavos: centavos(energiaSemDesconto),
    energia_com_desconto_centavos: centavos(energiaComDesconto),
    equatorial_centavos: equatorial === null ? null : centavos(equatorial),
    tarifa_minima_centavos: classico
      ? centavos(memoria.tarifa_minima_bruto ?? "0")
      : 0,
    iluminacao_centavos: classico ? centavos(entrada.iluminacao ?? "0") : 0,
    juros_equatorial_centavos: memoria.juros_centavos ?? 0,
    multa_equatorial_centavos: memoria.multa_centavos ?? 0,
    ajuste_gdii_centavos: memoria.ajuste_centavos ?? 0,
    encargos_atraso_centavos: snapshot.cobranca?.encargos_atraso_centavos ?? 0,
    referencia_sem_desconto_centavos: referencia,
    total_ecosol_centavos: valorFinal,
    economia_centavos: Math.max(0, referencia - valorFinal),
    modelo_calculo: memoria.modelo_calculo ?? "fixa",
  };
}
