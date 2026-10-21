import Decimal from "decimal.js";
import { cpfValidoParaCadastro } from "../validacaoDeCpf.mjs";

const D = Decimal.clone({ precision: 36, rounding: Decimal.ROUND_HALF_UP });

export function falhar(mensagem, status = 400) {
  const erro = new Error(mensagem);
  erro.status = status;
  throw erro;
}

export function texto(valor, nome, limite = 160) {
  const resultado = String(valor ?? "").trim();
  if (!resultado || resultado.length > limite)
    falhar(`Informe ${nome} (até ${limite} caracteres).`);
  return resultado;
}

export function decimal(valor, nome, casas = 6, maximo = "1000000000") {
  const entrada = String(valor ?? "").trim();
  // Formato canônico ou decimal brasileiro sem separador de milhares.
  if (!new RegExp(`^\\d{1,10}([.,]\\d{1,${casas}})?$`).test(entrada))
    falhar(
      `Informe ${nome} sem separador de milhares, com até ${casas} casas decimais.`,
    );
  const numero = new D(entrada.replace(",", "."));
  if (numero.gt(maximo)) falhar(`${nome}: valor acima do limite.`);
  return numero.toFixed();
}

export function competencia(valor) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(valor)))
    falhar("Informe uma competência válida.");
  return String(valor);
}

export function dataValida(valor) {
  const s = String(valor ?? "");
  const data = new Date(s + "T12:00:00Z");
  if (
    !/^20\d{2}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(data.getTime()) ||
    data.toISOString().slice(0, 10) !== s
  )
    falhar("Informe uma data de vencimento válida.");
  return s;
}

export function normalizarUc(valor) {
  const s = String(valor ?? "").trim();
  if (!/^[\d.\- ]{1,30}$/.test(s))
    falhar("Informe a unidade consumidora numérica.");
  const uc = s.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!/^\d{1,20}$/.test(uc) || /^0+$/.test(uc))
    falhar("Unidade consumidora inválida.");
  return uc;
}

export function documentoValido(valor) {
  if (cpfValidoParaCadastro(valor)) return String(valor).replace(/\D/g, "");
  const s = String(valor ?? "").trim();
  if (!/^(\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/.test(s))
    falhar("Informe um CPF ou CNPJ numérico válido.");
  const cnpj = s.replace(/\D/g, "");
  if (/^(\d)\1+$/.test(cnpj)) falhar("CNPJ inválido.");
  for (let tamanho = 12; tamanho <= 13; tamanho++) {
    let peso = tamanho - 7,
      soma = 0;
    for (let i = 0; i < tamanho; i++) {
      soma += Number(cnpj[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    if (Number(cnpj[tamanho]) !== (resto < 2 ? 0 : 11 - resto))
      falhar("CNPJ inválido.");
  }
  return cnpj;
}

export function validarUnidade(campos, { emailOpcional = false } = {}) {
  const usina_id =
    campos.usina_id === undefined ||
    campos.usina_id === null ||
    campos.usina_id === ""
      ? null
      : Number(campos.usina_id);
  if (usina_id !== null && (!Number.isSafeInteger(usina_id) || usina_id < 1))
    falhar("Selecione uma usina válida.");
  const email = String(campos.email ?? "")
    .trim()
    .toLowerCase();
  if (
    email.length > 180 ||
    (!email && !emailOpcional) ||
    (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    falhar("E-mail inválido.");
  const dia = Number(campos.dia_vencimento);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31)
    falhar("O dia preferido deve estar entre 1 e 31.");
  return {
    usina_id,
    uc: normalizarUc(campos.uc),
    nome: texto(campos.nome, "o nome"),
    documento: documentoValido(campos.documento),
    email,
    dia_vencimento: dia,
  };
}

export function validarContrato(campos) {
  if (!["GDI", "GDII"].includes(campos.modalidade))
    falhar("Selecione GDI ou GDII.");
  return {
    modalidade: campos.modalidade,
    desconto: decimal(campos.desconto, "o desconto percentual", 6, "100"),
    inicio: competencia(campos.inicio),
  };
}

export function calcularCobranca({
  modelo_calculo = "fixa",
  consumo_total,
  iluminacao,
  ajustes_pix,
  injecao,
  unitario,
  bandeira,
  tarifa_total,
  desconto,
  total_equatorial,
  ajuste_gdii,
  modalidade,
  juros,
  multa,
}) {
  if (ajustes_pix !== undefined)
    falhar(
      "PIX não habilitado: falta homologar origem e consumo único do ajuste.",
    );
  if (!["fixa", "classico"].includes(modelo_calculo))
    falhar("Modelo de cálculo inválido.");
  if (modelo_calculo === "classico") {
    // Central calculate_boleto(classic_rateio=True): E/F/H/I/M/O.
    // Ausência de célula vira zero; valores manuais inválidos continuam rejeitados.
    // Este caminho exige seleção explícita no motor, sem inferir modelo por usina.
    const celula = (valor, nome, casas = 6, limite = "1000000000") =>
      decimal(
        valor === undefined || valor === null || valor === "" ? "0" : valor,
        nome,
        casas,
        limite,
      );
    if (
      tarifa_total ||
      [juros, multa, ajuste_gdii].some(
        (v) =>
          v !== undefined &&
          v !== null &&
          v !== "" &&
          !new D(decimal(v, "o encargo", 2)).isZero(),
      )
    )
      falhar(
        "Modelo clássico exige componentes da tarifa; encargos e GDII não têm correspondência comprovada.",
      );
    const entradas = {
      injecao: celula(injecao, "a injeção SCEE"),
      consumo_total: celula(consumo_total, "o consumo total"),
      unitario: new D(celula(unitario, "a tarifa unitária", 6, "100")).toFixed(
        6,
      ),
      bandeira: new D(celula(bandeira, "a bandeira", 6, "100")).toFixed(6),
      desconto: celula(desconto, "o desconto percentual", 6, "100"),
      iluminacao: celula(iluminacao, "a iluminação", 2),
    };
    const tarifa = new D(entradas.unitario).plus(entradas.bandeira);
    const consumo = new D(entradas.injecao)
      .times(tarifa)
      .times(new D(1).minus(new D(entradas.desconto).div(100)));
    const tarifaMinima = new D(entradas.consumo_total)
      .minus(entradas.injecao)
      .times(tarifa);
    const total = consumo.plus(tarifaMinima).plus(entradas.iluminacao);
    const final = total.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
    if (!final.gt(0))
      falhar(
        "Cobrança zerada ou negativa: confira as parcelas antes de prosseguir.",
      );
    return {
      regra: "ecosol-classico-v1-central",
      modelo_calculo,
      entradas,
      tarifa_completa: tarifa.toFixed(6),
      consumo_bruto: consumo.toFixed(),
      tarifa_minima_bruto: tarifaMinima.toFixed(),
      total_bruto: total.toFixed(),
      precisao: {
        tarifa: 6,
        moeda: 2,
        arredondamento: "ROUND_HALF_EVEN",
        etapa: "total",
      },
      consumo_centavos: consumo.toDecimalPlaces(2).times(100).toNumber(),
      total_centavos: final.times(100).toNumber(),
    };
  }
  if (!["GDI", "GDII"].includes(modalidade)) falhar("Modalidade inválida.");
  const energiaInjetada = decimal(injecao, "a injeção SCEE");
  const totalEquatorial = decimal(total_equatorial, "o total Equatorial", 2);
  const valorJuros = decimal(
    juros === undefined || juros === "" ? "0" : juros,
    "os juros",
    2,
  );
  const valorMulta = decimal(
    multa === undefined || multa === "" ? "0" : multa,
    "a multa",
    2,
  );
  const temEncargos =
    !new D(valorJuros).isZero() || !new D(valorMulta).isZero();
  const parcelasEncargos = temEncargos
    ? {
        juros_centavos: new D(valorJuros).times(100).toNumber(),
        multa_centavos: new D(valorMulta).times(100).toNumber(),
      }
    : {};
  const entradasEncargos = temEncargos
    ? { juros: valorJuros, multa: valorMulta }
    : {};
  const semInjecao = new D(energiaInjetada).isZero();
  const ajuste = decimal(
    (semInjecao || modalidade === "GDI") &&
      (ajuste_gdii === "" || ajuste_gdii == null)
      ? "0"
      : ajuste_gdii,
    "o ajuste GDII",
    2,
  );
  if (semInjecao) {
    if (!new D(ajuste).isZero())
      falhar("Sem injeção SCEE, o ajuste GDII deve ser zero.");
    if (!new D(totalEquatorial).gt(0))
      falhar("Total Equatorial zerado: não há cobrança a calcular.");
    const totalSemInjecao = new D(totalEquatorial)
      .minus(valorJuros)
      .minus(valorMulta);
    if (!totalSemInjecao.gt(0))
      falhar("Cobrança zerada ou negativa após abater juros e multa.");
    return {
      regra: temEncargos
        ? "ecosol-v2-encargos-sem-injecao"
        : "ecosol-v1-sem-injecao",
      entradas: {
        injecao: "0",
        unitario: "0.000000",
        bandeira: "0.000000",
        desconto: "0",
        total_equatorial: totalEquatorial,
        ajuste_gdii: "0",
        modalidade,
        ...entradasEncargos,
      },
      tarifa_completa: "0.000000",
      consumo_bruto: "0",
      total_bruto: totalSemInjecao.toFixed(),
      precisao: {
        tarifa: 6,
        moeda: 2,
        arredondamento: "ROUND_HALF_UP",
        etapa: "total",
      },
      consumo_centavos: 0,
      equatorial_centavos: new D(totalEquatorial).times(100).toNumber(),
      ajuste_centavos: 0,
      ...parcelasEncargos,
      total_centavos: totalSemInjecao.times(100).toNumber(),
    };
  }
  const tarifaManual = String(tarifa_total ?? "").trim()
    ? new D(decimal(tarifa_total, "a tarifa total", 6, "100")).toFixed(6)
    : "";
  const componente = (valor, nome) => {
    const informado = String(valor ?? "").trim();
    return informado
      ? new D(decimal(informado, nome, 6, "100")).toFixed(6)
      : "";
  };
  const entradas = {
    injecao: energiaInjetada,
    unitario: componente(unitario, "a tarifa unitária"),
    bandeira: componente(bandeira, "a bandeira em R$/kWh"),
    desconto: decimal(desconto, "o desconto", 6, "100"),
    total_equatorial: totalEquatorial,
    ajuste_gdii: ajuste,
    modalidade,
    ...entradasEncargos,
  };
  if (modalidade === "GDI" && !new D(entradas.ajuste_gdii).isZero())
    falhar("GDI deve ter ajuste GDII igual a zero.");
  if (!tarifaManual && (!entradas.unitario || !entradas.bandeira))
    falhar(
      "Informe os componentes da tarifa ou preencha a tarifa final manual.",
    );
  const tarifaDosComponentes = tarifaManual
    ? null
    : new D(entradas.unitario).plus(entradas.bandeira);
  // A conferência pode registrar uma tarifa final validada manualmente. Os
  // componentes continuam armazenados como evidência; nunca tentamos deduzir
  // ou alterar um deles a partir da tarifa final.
  const tarifa = tarifaManual ? new D(tarifaManual) : tarifaDosComponentes;
  if (!tarifa.gt(0)) falhar("A tarifa completa deve ser maior que zero.");
  const consumo = new D(entradas.injecao)
    .times(tarifa)
    .times(new D(1).minus(new D(entradas.desconto).div(100)));
  const total = consumo
    .plus(entradas.total_equatorial)
    .minus(valorJuros)
    .minus(valorMulta)
    .minus(entradas.ajuste_gdii);
  // Central: decimal_to_br_text(boleto, 2) formata Decimal com HALF_EVEN.
  // Aplicar somente no fechamento da fórmula fixa, nunca nas parcelas.
  const totalArredondado = total.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  if (!totalArredondado.gt(0))
    falhar(
      "Cobrança zerada ou negativa: confira as parcelas antes de prosseguir.",
    );
  return {
    regra: "ecosol-v4-arredondamento-central",
    entradas,
    tarifa_completa: tarifa.toFixed(6),
    consumo_bruto: consumo.toFixed(),
    total_bruto: total.toFixed(),
    precisao: {
      tarifa: 6,
      moeda: 2,
      arredondamento: "ROUND_HALF_EVEN",
      etapa: "total",
    },
    // Compatibilidade de apresentação: esta parcela em centavos NÃO alimenta
    // a fórmula. Somente o total exato acima é arredondado para cobrança.
    consumo_centavos: consumo.toDecimalPlaces(2).times(100).toNumber(),
    equatorial_centavos: new D(entradas.total_equatorial).times(100).toNumber(),
    ajuste_centavos: new D(entradas.ajuste_gdii).times(100).toNumber(),
    ...parcelasEncargos,
    total_centavos: totalArredondado.times(100).toNumber(),
  };
}
