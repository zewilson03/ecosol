// Esta camada só autoriza o adaptador já existente para PDFs Gmail que já
// chegaram à conferência. Não associa UC, nem altera cadastro, planilha ou PDF.
export async function simularDocumentoCentral({ banco, documentoId, simular }) {
  const documento = banco
    .prepare(
      `SELECT d.id FROM faturamento_documentos d
       JOIN gmail_anexos a ON a.documento_id=d.id
       WHERE d.id=? AND d.classificacao='fatura' AND d.finalidade='cobranca'
         AND d.excluido_em IS NULL AND a.estado='capturado'`,
    )
    .get(documentoId);
  if (!documento) throw new Error("documento_gmail_indisponivel");
  const resultado = await simular({ documentos: [documentoId] });
  const simulacao = resultado?.resultados?.[0];
  if (
    !simulacao ||
    simulacao.documento !== documentoId ||
    !["simulada", "revisar"].includes(simulacao.situacao)
  )
    throw new Error("simulacao_central_invalida");
  return simulacao;
}
