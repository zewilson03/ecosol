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

export function validarUnidade(campos) {
  const usina_id =
    campos.usina_id === undefined ||
    campos.usina_id === null ||
    campos.usina_id === ""
      ? null
      : Number(campos.usina_id);
  if (usina_id !== null && (!Number.isSafeInteger(usina_id) || usina_id < 1))
    falhar("Selecione uma usina válida.");
  const email = texto(campos.email, "o e-mail", 180).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) falhar("E-mail inválido.");
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
    desconto: decimal(campos.desconto, "o desconto percentual", 2, "100"),
    inicio: competencia(campos.inicio),
  };
}

export function calcularCobranca({
  injecao,
  unitario,
  bandeira,
  desconto,
  total_equatorial,
  ajuste_gdii,
  modalidade,
}) {
  if (!["GDI", "GDII"].includes(modalidade)) falhar("Modalidade inválida.");
  const entradas = {
    injecao: decimal(injecao, "a injeção SCEE"),
    unitario: decimal(unitario, "a tarifa unitária", 9, "100"),
    bandeira: decimal(bandeira, "a bandeira em R$/kWh", 9, "100"),
    desconto: decimal(desconto, "o desconto", 2, "100"),
    total_equatorial: decimal(total_equatorial, "o total Equatorial", 2),
    ajuste_gdii: decimal(ajuste_gdii, "o ajuste GDII", 2),
    modalidade,
  };
  if (modalidade === "GDI" && !new D(entradas.ajuste_gdii).isZero())
    falhar("GDI deve ter ajuste GDII igual a zero.");
  const tarifa = new D(entradas.unitario).plus(entradas.bandeira);
  if (!tarifa.gt(0)) falhar("A tarifa completa deve ser maior que zero.");
  const consumo = new D(entradas.injecao)
    .times(tarifa)
    .times(new D(1).minus(new D(entradas.desconto).div(100)))
    .toDecimalPlaces(2);
  const total = consumo
    .plus(entradas.total_equatorial)
    .minus(entradas.ajuste_gdii);
  if (!total.gt(0))
    falhar(
      "Cobrança zerada ou negativa: confira as parcelas antes de prosseguir.",
    );
  return {
    regra: "ecosol-v1",
    entradas,
    tarifa_completa: tarifa.toFixed(),
    consumo_centavos: consumo.times(100).toNumber(),
    equatorial_centavos: new D(entradas.total_equatorial).times(100).toNumber(),
    ajuste_centavos: new D(entradas.ajuste_gdii).times(100).toNumber(),
    total_centavos: total.times(100).toNumber(),
  };
}
