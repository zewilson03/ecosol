import Decimal from "decimal.js";

const D = Decimal.clone({ precision: 50 });
export const escalasFinanceiras = Object.freeze({
  injecao: 6,
  unitario: 6,
  bandeira: 6,
  tarifa_total: 6,
  desconto: 6,
  total_equatorial: 2,
  ajuste_gdii: 2,
  juros: 2,
  multa: 2,
});

// Somente o importador confiável informa tipo=numero/percentual. Texto digitado
// não recebe tolerância IEEE754. Não confundir escala exibida com precisão real.
export function normalizarDecimalImportado(
  valor,
  { origem, tipo = "texto", casas, escalaFixa = false },
) {
  const bruto = String(valor ?? "");
  const registro = {
    bruto,
    normalizado: null,
    origem,
    tipo,
    casas,
    situacao: "pendente",
  };
  if (!origem || !Number.isInteger(casas) || casas < 0 || casas > 9)
    throw new Error("Contrato de normalização inválido.");
  const texto = bruto.trim().replace(",", ".");
  const numerico = tipo === "numero" || tipo === "percentual";
  if (
    !numerico &&
    !new RegExp(`^\\d+${casas ? `(\\.\\d{1,${casas}})?` : ""}$`).test(texto)
  )
    return {
      valor: bruto,
      registro: { ...registro, situacao: "precisao_ou_formato_invalido" },
    };
  if (
    !(numerico ? /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i : /^\d+(?:\.\d+)?$/).test(
      texto,
    )
  )
    return { valor: bruto, registro };
  const numero = new D(texto);
  if (!numero.isFinite() || numero.gt("1000000000"))
    return { valor: bruto, registro };
  if (numero.decimalPlaces() <= casas) {
    const normalizado = escalaFixa ? numero.toFixed(casas) : numero.toFixed();
    return {
      valor: normalizado,
      registro: { ...registro, normalizado, situacao: "exato" },
    };
  }
  const candidato = numero.toDecimalPlaces(casas, Decimal.ROUND_HALF_UP);
  // Limite relativo de uma unidade de precisão binária. Não usar tolerância
  // absoluta: isso transformaria valores pequenos legítimos em zero.
  const tolerancia = numero.abs().times("0.0000000000000002220446049250313");
  if (numerico && numero.minus(candidato).abs().lte(tolerancia)) {
    const normalizado = escalaFixa
      ? candidato.toFixed(casas)
      : candidato.toFixed();
    return {
      valor: normalizado,
      registro: { ...registro, normalizado, situacao: "residuo_ieee754" },
    };
  }
  return {
    valor: bruto,
    registro: { ...registro, situacao: "precisao_excedente" },
  };
}

export function normalizarDadosFinanceiros(
  entrada,
  { origem, tipo = "texto" },
) {
  const dados = { ...entrada },
    registros = {};
  for (const [campo, casas] of Object.entries(escalasFinanceiras)) {
    if (entrada?.[campo] === undefined || String(entrada[campo]).trim() === "")
      continue;
    const resultado = normalizarDecimalImportado(entrada[campo], {
      origem,
      tipo,
      casas,
      escalaFixa: ["unitario", "bandeira", "tarifa_total"].includes(campo),
    });
    dados[campo] = resultado.valor;
    registros[campo] = resultado.registro;
  }
  return { dados, registros };
}
