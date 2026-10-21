// Visão derivada dos recebimentos existentes: nenhuma cópia de valores financeiros.
export function listarLotes(banco, { avancado = false, avaliar } = {}) {
  const recebimentos = banco
    .prepare(
      `SELECT r.*,d.classificacao,d.finalidade,d.excluido_em
    FROM faturamento_recebimentos_pdf r LEFT JOIN faturamento_documentos d ON d.id=r.documento_id
    ORDER BY r.id`,
    )
    .all();
  if (avancado)
    recebimentos.push(
      ...banco
        .prepare(
          `SELECT 'gmail-'||a.id AS id,a.nome,
    'gmail-'||a.conta_id AS lote,'gmail' AS origem,NULL AS documento_id,
    COALESCE(a.erro_codigo,a.estado) AS motivo,'pendente' AS codigo
    FROM gmail_anexos a WHERE NOT EXISTS
    (SELECT 1 FROM faturamento_recebimentos_pdf r WHERE r.gmail_anexo_id=a.id)`,
        )
        .all(),
    );
  const lotes = new Map();
  for (const r of recebimentos) {
    // Triagem Gmail permanece restrita ao nível 3.
    if (!avancado && r.origem === "gmail" && r.classificacao !== "fatura")
      continue;
    if (!lotes.has(r.lote))
      lotes.set(r.lote, {
        lote: r.lote,
        recebido: 0,
        aptas: 0,
        pendentes: 0,
        duplicadas: 0,
        valor_centavos: 0,
        itens: [],
      });
    const lote = lotes.get(r.lote);
    let estado = "pendente",
      motivo = r.motivo,
      valor = 0,
      versao = null,
      status = null;
    if (r.codigo === "duplicada") estado = "duplicada";
    else if (
      r.documento_id &&
      r.classificacao === "fatura" &&
      r.finalidade === "cobranca" &&
      !r.excluido_em
    ) {
      try {
        const avaliacao = avaliar(r.documento_id);
        ({ motivo, versao, status } = avaliacao);
        valor = avaliacao.valor_centavos;
        estado = avaliacao.apta ? "apta" : "pendente";
      } catch (erro) {
        motivo = erro.status
          ? erro.message
          : "Não foi possível avaliar; revise a fatura.";
      }
    } else if (r.documento_id)
      motivo = r.excluido_em
        ? "Documento excluído."
        : r.classificacao !== "fatura"
          ? "Aguardando triagem ou classificado como não fatura."
          : "Documento destinado a pagamento, sem cobrança ao cliente.";
    lote.recebido++;
    lote[
      estado === "apta"
        ? "aptas"
        : estado === "duplicada"
          ? "duplicadas"
          : "pendentes"
    ]++;
    lote.valor_centavos += valor;
    lote.itens.push({
      id: r.id,
      nome: r.nome,
      origem: r.origem,
      documento_id: r.documento_id,
      estado,
      motivo,
      valor_centavos: valor,
      versao,
      status,
    });
  }
  return [...lotes.values()];
}
