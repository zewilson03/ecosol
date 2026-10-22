function falhar(campo) {
  const erro = new Error(`Dado obrigatório para o boleto Sicoob: ${campo}.`);
  erro.codigo = "SICOOB_COBRANCA_INCOMPLETA";
  erro.campo = campo;
  throw erro;
}

function texto(valor, campo, limite) {
  const resultado = String(valor ?? "").trim();
  if (!resultado || resultado.length > limite || /[\r\n]/.test(resultado))
    falhar(campo);
  return resultado;
}

function digitos(valor, campo, tamanhos) {
  const resultado = String(valor ?? "").replace(/\D/g, "");
  if (!tamanhos.includes(resultado.length)) falhar(campo);
  return resultado;
}

function inteiro(
  valor,
  campo,
  { minimo = 0, maximo = Number.MAX_SAFE_INTEGER } = {},
) {
  const resultado = Number(valor);
  if (
    !Number.isSafeInteger(resultado) ||
    resultado < minimo ||
    resultado > maximo
  )
    falhar(campo);
  return resultado;
}

function dataIso(valor, campo) {
  const resultado = String(valor ?? "");
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(resultado)) falhar(campo);
  const data = new Date(`${resultado}T00:00:00Z`);
  if (
    Number.isNaN(data.getTime()) ||
    data.toISOString().slice(0, 10) !== resultado
  )
    falhar(campo);
  return resultado;
}

function reaisDosCentavos(valor, campo) {
  const centavos = inteiro(valor, campo, { minimo: 1, maximo: 999_999_999_99 });
  return Number((centavos / 100).toFixed(2));
}

function uf(valor) {
  const resultado = String(valor ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(resultado)) falhar("UF do pagador");
  return resultado;
}

function email(valor) {
  const resultado = texto(valor, "e-mail do pagador", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resultado))
    falhar("e-mail do pagador");
  return resultado;
}

/**
 * Converte uma intenção congelada do Ecosol no corpo da Cobrança Bancária v3.
 * Nenhum código de modalidade, conta ou política de encargos é presumido.
 */
export function mapearCobrancaParaSicoob({ operacao, pagador, convenio } = {}) {
  const idempotencia = texto(operacao?.idempotencia, "idempotência", 128);
  const seuNumero = texto(
    operacao?.seuNumero ?? idempotencia.slice(0, 18),
    "seu número",
    18,
  );
  const identificacao = texto(
    operacao?.identificacaoBoletoEmpresa ?? idempotencia.slice(0, 20),
    "identificação do boleto na empresa",
    20,
  );
  const emissao = dataIso(operacao?.dataEmissao, "data de emissão");
  const vencimento = dataIso(operacao?.vencimento, "data de vencimento");
  if (vencimento < emissao) falhar("vencimento anterior à emissão");

  return {
    numeroCliente: inteiro(convenio?.numeroCliente, "número do cliente", {
      minimo: 1,
    }),
    codigoModalidade: inteiro(convenio?.codigoModalidade, "modalidade", {
      minimo: 1,
    }),
    numeroContaCorrente: inteiro(
      convenio?.numeroContaCorrente,
      "conta corrente",
      { minimo: 1 },
    ),
    codigoEspecieDocumento: texto(
      convenio?.codigoEspecieDocumento,
      "espécie do documento",
      8,
    ),
    dataEmissao: emissao,
    seuNumero,
    identificacaoBoletoEmpresa: identificacao,
    identificacaoEmissaoBoleto: inteiro(
      convenio?.identificacaoEmissaoBoleto,
      "identificação de emissão",
      { minimo: 1 },
    ),
    identificacaoDistribuicaoBoleto: inteiro(
      convenio?.identificacaoDistribuicaoBoleto,
      "identificação de distribuição",
      { minimo: 1 },
    ),
    valor: reaisDosCentavos(operacao?.valorCentavos, "valor"),
    dataVencimento: vencimento,
    numeroParcela: inteiro(operacao?.numeroParcela ?? 1, "número da parcela", {
      minimo: 1,
    }),
    pagador: {
      numeroCpfCnpj: digitos(
        pagador?.documento,
        "CPF/CNPJ do pagador",
        [11, 14],
      ),
      nome: texto(pagador?.nome, "nome do pagador", 120),
      endereco: texto(pagador?.endereco, "endereço do pagador", 160),
      bairro: texto(pagador?.bairro, "bairro do pagador", 80),
      cidade: texto(pagador?.cidade, "cidade do pagador", 80),
      cep: digitos(pagador?.cep, "CEP do pagador", [8]),
      uf: uf(pagador?.uf),
      ...(pagador?.email ? { email: email(pagador.email) } : {}),
    },
    mensagensInstrucao: Array.isArray(operacao?.mensagensInstrucao)
      ? operacao.mensagensInstrucao
          .slice(0, 5)
          .map((mensagem, indice) =>
            texto(mensagem, `instrução ${indice + 1}`, 160),
          )
      : [],
    gerarPdf: convenio?.gerarPdf === true,
    numeroContratoCobranca: inteiro(
      convenio?.numeroContratoCobranca,
      "contrato de cobrança",
      { minimo: 1 },
    ),
    tipoFormularioImpressaoPDF: inteiro(
      convenio?.tipoFormularioImpressaoPDF,
      "formulário de impressão",
      { minimo: 1 },
    ),
  };
}
