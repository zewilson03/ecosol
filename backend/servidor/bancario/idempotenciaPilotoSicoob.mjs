import { createHash } from "node:crypto";

function ordenar(valor) {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === "object")
    return Object.fromEntries(
      Object.keys(valor)
        .sort()
        .map((chave) => [chave, ordenar(valor[chave])]),
    );
  return valor;
}

function hash(valor) {
  return createHash("sha256")
    .update(JSON.stringify(ordenar(valor)))
    .digest("hex");
}

function texto(valor) {
  return String(valor ?? "").trim();
}

function digitos(valor) {
  return texto(valor).replace(/\D/g, "");
}

function entradaEfetiva(entrada) {
  const cliente = entrada?.cliente ?? {};
  return {
    cliente: {
      documento: digitos(cliente.documento),
      nome: texto(cliente.nome),
      endereco: texto(cliente.endereco),
      bairro: texto(cliente.bairro),
      cidade: texto(cliente.cidade),
      cep: digitos(cliente.cep),
      uf: texto(cliente.uf).toUpperCase(),
      email: texto(cliente.email).toLowerCase() || null,
    },
    uc: texto(entrada?.uc) || "PILOTO-SICOOB",
    valor_centavos: Number(entrada?.valor_centavos),
    vencimento: texto(entrada?.vencimento),
  };
}

function destinoEfetivo(configuracao) {
  const cobranca = configuracao?.cobranca ?? {};
  return {
    ambiente: texto(configuracao?.ambiente),
    contrato_api: texto(configuracao?.contratoVersao),
    numero_cliente: cobranca.numeroCliente ?? null,
    codigo_modalidade: cobranca.codigoModalidade ?? null,
    numero_conta_corrente: cobranca.numeroContaCorrente ?? null,
    especie_documento: texto(cobranca.codigoEspecieDocumento),
    identificacao_emissao: cobranca.identificacaoEmissaoBoleto ?? null,
    identificacao_distribuicao:
      cobranca.identificacaoDistribuicaoBoleto ?? null,
    numero_contrato_cobranca: cobranca.numeroContratoCobranca ?? null,
    gerar_pdf: cobranca.gerarPdf === true,
  };
}

/**
 * A chave representa uma versão imutável do boleto e do destino bancário.
 * Credenciais, certificados, URLs e tokens não participam da identidade.
 */
export function criarIdempotenciaPilotoSicoob({
  entrada,
  configuracao,
  revisao = 2,
} = {}) {
  if (!Number.isInteger(revisao) || revisao < 2 || revisao > 99)
    throw new Error("A revisão idempotente do piloto é inválida.");
  return hash({
    versao_identidade: revisao,
    provedor: "sicoob",
    operacao: "registrar_boleto_piloto",
    destino: destinoEfetivo(configuracao),
    entrada: entradaEfetiva(entrada),
  });
}

/** Mantida somente para reconhecer registros criados pelo emissor anterior. */
export function criarIdempotenciaLegadaPilotoSicoob(entrada) {
  // Compatibilidade byte a byte: a versão anterior usava JSON.stringify sem
  // ordenação canônica. Alterar isso impediria localizar o registro antigo.
  return createHash("sha256")
    .update(
      JSON.stringify({
        versao: 1,
        ambiente: "producao",
        contrato_api: "cobranca-v3-numero-cliente-contrato-sisbr",
        entrada,
      }),
    )
    .digest("hex");
}

export function avaliarHistoricoPilotoSicoob({
  registroAtual,
  registroLegado,
} = {}) {
  if (registroAtual)
    return Object.freeze({
      permitida: false,
      motivo: "PILOTO_JA_REGISTRADO_LOCALMENTE",
      estado: registroAtual.estado,
      codigo: registroAtual.codigo ?? null,
    });

  if (!registroLegado)
    return Object.freeze({ permitida: true, migraRejeicaoLegada: false });

  if (registroLegado.estado !== "rejeitada")
    return Object.freeze({
      permitida: false,
      motivo: "PILOTO_LEGADO_EXIGE_RECONCILIACAO",
      estado: registroLegado.estado,
      codigo: registroLegado.codigo ?? null,
    });

  // Rejeição negocial definitiva não produziu boleto. Uma única tentativa na
  // identidade v2 é segura; a partir dela, o próprio registro v2 bloqueia replay.
  return Object.freeze({ permitida: true, migraRejeicaoLegada: true });
}
