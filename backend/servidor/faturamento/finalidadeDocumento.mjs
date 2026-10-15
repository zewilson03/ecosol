function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function identificarFinalidadeDocumento(texto) {
  const normal = normalizar(texto);
  const temGrandezasContratadas = /GRANDEZAS\s+CONTRATADAS/.test(normal);
  const temDemanda = /\bDEMANDA\s*-?\s*KW\b/.test(normal);
  const temDemandaGeracao = /\bDEMANDA\s+GERACAO\s*-?\s*KW\b/.test(normal);

  const linhas = normal.split(/\r?\n/);
  const inicio = linhas.findIndex((linha) => /^\s*FORNECIMENTO\b/.test(linha));
  const fim = linhas.findIndex(
    (linha, indice) =>
      indice > inicio && /^\s*(?:ITENS FINANCEIROS|TOTAL)\b/.test(linha),
  );
  const itens =
    inicio >= 0
      ? linhas
          .slice(inicio + 1, fim > inicio ? fim : undefined)
          .filter(
            (linha) =>
              /\b(?:KWH|KW|KVARH)\b/.test(linha) && /\d/.test(linha),
          ).length
      : 0;
  const temConsumoScee = /\bCONSUMO(?:\s+HR|\s+FP|\s+P)?\s+SCEE\b/.test(normal);
  // Alguns PDFs não expõem o título azul na camada de texto. As duas linhas
  // específicas do quadro continuam sendo uma evidência inequívoca.
  const porDemanda = temDemanda && temDemandaGeracao;
  const porQuantidade = temConsumoScee && itens > 10;
  return {
    finalidade: porDemanda || porQuantidade ? "pagamento" : "cobranca",
    motivo: porDemanda
      ? "grandezas_contratadas_com_demanda"
      : porQuantidade
        ? "consumo_scee_com_mais_de_10_itens"
        : null,
    evidencias: {
      grandezas_contratadas: temGrandezasContratadas,
      demanda: temDemanda,
      demanda_geracao: temDemandaGeracao,
      consumo_scee: temConsumoScee,
      quantidade_itens: itens,
    },
  };
}
