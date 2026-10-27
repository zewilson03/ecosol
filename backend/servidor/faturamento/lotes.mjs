// Visão derivada dos recebimentos existentes: nenhuma cópia de valores financeiros.
function dataDoPeriodo(valor) {
  const [data] = String(valor ?? "").split("T");
  const [ano, mes, dia] = data.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : null;
}

function horaDoPeriodo(valor) {
  return String(valor ?? "").slice(11, 16) || null;
}

function chaveDoLote(recebimento) {
  if (!recebimento.gmail_captura_id)
    return { id: recebimento.lote, rotulo: recebimento.lote };
  const inicio = recebimento.gmail_inicio_local;
  const fim = recebimento.gmail_fim_local;
  const dataInicio = dataDoPeriodo(inicio);
  const dataFim = dataDoPeriodo(fim);
  const data = dataFim ?? dataInicio ?? "sem período";
  const inicioCompleto = [dataInicio, horaDoPeriodo(inicio)]
    .filter(Boolean)
    .join(" ");
  const fimCompleto = [dataFim, horaDoPeriodo(fim)].filter(Boolean).join(" ");
  const intervalo =
    dataInicio && dataInicio === dataFim
      ? [horaDoPeriodo(inicio), horaDoPeriodo(fim)].filter(Boolean).join("–")
      : [inicioCompleto, fimCompleto].filter(Boolean).join("–");
  return {
    id: `gmail-captura-${recebimento.gmail_captura_id}`,
    rotulo: `Gmail · ${data}${intervalo ? ` · ${intervalo}` : ""}`,
  };
}

export function listarLotes(banco, { avancado = false, avaliar } = {}) {
  const recebimentos = banco
    .prepare(
      `SELECT r.*,d.classificacao,d.finalidade,d.excluido_em,
      c.id AS gmail_captura_id,c.inicio_local AS gmail_inicio_local,c.fim_local AS gmail_fim_local
    FROM faturamento_recebimentos_pdf r
    LEFT JOIN faturamento_documentos d ON d.id=r.documento_id
    LEFT JOIN gmail_anexos a ON a.id=r.gmail_anexo_id
    LEFT JOIN gmail_capturas_periodo c ON c.id=(
      SELECT m.captura_id FROM gmail_capturas_periodo_mensagens m
      JOIN gmail_capturas_periodo cp ON cp.id=m.captura_id
       WHERE cp.conta_id=a.conta_id AND m.message_id=a.message_id
       ORDER BY cp.iniciado_em DESC,cp.id DESC LIMIT 1
    )
    ORDER BY r.id`,
    )
    .all();
  if (avancado)
    recebimentos.push(
      ...banco
        .prepare(
          `SELECT 'gmail-'||a.id AS id,a.nome,
    'gmail-'||a.conta_id AS lote,'gmail' AS origem,NULL AS documento_id,
    c.id AS gmail_captura_id,c.inicio_local AS gmail_inicio_local,c.fim_local AS gmail_fim_local,
    COALESCE(a.erro_codigo,a.estado) AS motivo,'pendente' AS codigo
    FROM gmail_anexos a
    LEFT JOIN gmail_capturas_periodo c ON c.id=(
      SELECT m.captura_id FROM gmail_capturas_periodo_mensagens m
      JOIN gmail_capturas_periodo cp ON cp.id=m.captura_id
       WHERE cp.conta_id=a.conta_id AND m.message_id=a.message_id
       ORDER BY cp.iniciado_em DESC,cp.id DESC LIMIT 1
    )
    WHERE NOT EXISTS
    (SELECT 1 FROM faturamento_recebimentos_pdf r WHERE r.gmail_anexo_id=a.id)`,
        )
        .all(),
    );
  const lotes = new Map();
  for (const r of recebimentos) {
    // Triagem Gmail permanece restrita ao nível 3.
    if (!avancado && r.origem === "gmail" && r.classificacao !== "fatura")
      continue;
    const chave = chaveDoLote(r);
    if (!lotes.has(chave.id))
      lotes.set(chave.id, {
        id: chave.id,
        lote: r.lote,
        rotulo: chave.rotulo,
        recebido: 0,
        aptas: 0,
        pendentes: 0,
        duplicadas: 0,
        valor_centavos: 0,
        itens: [],
      });
    const lote = lotes.get(chave.id);
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
