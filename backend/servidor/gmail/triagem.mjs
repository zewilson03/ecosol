function documentoDaConta(banco, contaId, documentoId) {
  return banco
    .prepare(
      `SELECT d.id,d.nome,d.pdf,d.classificacao,d.versao,d.status,
              d.memoria,d.unidade_id,d.competencia
       FROM faturamento_documentos d
       WHERE d.id=? AND EXISTS (
         SELECT 1 FROM gmail_anexos a
         WHERE a.documento_id=d.id AND a.conta_id=?
       )`,
    )
    .get(documentoId, contaId);
}

export function listarTriagemGmail(banco, contaId, antesId = null) {
  const itens = banco
    .prepare(
      `SELECT d.id,d.nome,d.classificacao,d.versao,d.criado_em
       FROM faturamento_documentos d
       WHERE d.classificacao IN ('triagem','nao_fatura')
         AND (? IS NULL OR d.id<?)
         AND EXISTS (
           SELECT 1 FROM gmail_anexos a
           WHERE a.documento_id=d.id AND a.conta_id=?
         )
       ORDER BY d.id DESC LIMIT 51`,
    )
    .all(antesId, antesId, contaId);
  const mais = itens.length > 50;
  const pagina = itens.slice(0, 50);
  const contagens = banco
    .prepare(
      `SELECT d.classificacao,COUNT(*) quantidade
       FROM faturamento_documentos d
       WHERE d.classificacao IN ('triagem','nao_fatura')
         AND EXISTS (
           SELECT 1 FROM gmail_anexos a
           WHERE a.documento_id=d.id AND a.conta_id=?
         )
       GROUP BY d.classificacao`,
    )
    .all(contaId);
  return {
    itens: pagina,
    proximoAntes: mais ? pagina.at(-1).id : null,
    contagens,
  };
}

export function obterPdfTriagemGmail(banco, contaId, documentoId) {
  const documento = documentoDaConta(banco, contaId, documentoId);
  return documento && documento.classificacao !== "fatura"
    ? documento.pdf
    : null;
}

export function classificarDocumentoGmail({
  banco,
  contaId,
  documentoId,
  versao,
  destino,
  administrador,
}) {
  if (!Number.isSafeInteger(versao) || versao < 1)
    throw new Error("versao_invalida");
  if (!["fatura", "nao_fatura"].includes(destino))
    throw new Error("destino_invalido");
  banco.exec("BEGIN IMMEDIATE");
  try {
    const documento = documentoDaConta(banco, contaId, documentoId);
    if (!documento || documento.classificacao === "fatura")
      throw new Error("documento_indisponivel");
    if (documento.versao !== versao) throw new Error("versao_obsoleta");
    if (documento.classificacao === destino)
      throw new Error("classificacao_inalterada");
    if (
      documento.status !== "Pendente de revisão" ||
      documento.memoria !== null ||
      documento.unidade_id !== null ||
      documento.competencia !== null
    )
      throw new Error("estado_financeiro_incompativel");
    banco
      .prepare(
        `UPDATE faturamento_documentos
         SET classificacao=?,versao=versao+1,atualizado_em=CURRENT_TIMESTAMP
         WHERE id=? AND versao=?`,
      )
      .run(destino, documentoId, versao);
    banco
      .prepare(
        `INSERT INTO faturamento_historico
         (documento_id,responsavel,administrador_id,acao,dados)
         VALUES (?,?,?,?,?)`,
      )
      .run(
        documentoId,
        administrador.nome,
        administrador.id,
        "Classificação de PDF Gmail",
        JSON.stringify({
          contaId,
          anterior: documento.classificacao,
          novo: destino,
        }),
      );
    banco.exec("COMMIT");
    return { id: documentoId, classificacao: destino, versao: versao + 1 };
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

// Operação única e explícita do piloto de 06/10/2026. Nunca executada no
// startup: só depois de backup e conferência da quantidade esperada.
export function separarTermosDoPiloto(banco, contaId, quantidadeEsperada = 47) {
  banco.exec("BEGIN IMMEDIATE");
  try {
    const candidatos = banco
      .prepare(
        `SELECT DISTINCT d.id,d.classificacao,d.status,d.memoria,
                d.unidade_id,d.competencia,d.versao
         FROM faturamento_documentos d
         JOIN faturamento_recebimentos_pdf r ON r.documento_id=d.id
         JOIN gmail_anexos a ON a.id=r.gmail_anexo_id
         WHERE a.conta_id=? AND r.origem='gmail'
           AND lower(d.nome) LIKE 'termo%'`,
      )
      .all(contaId);
    if (candidatos.length !== quantidadeEsperada)
      throw new Error("quantidade_divergente");
    const contarRecebimentos = banco.prepare(
      "SELECT COUNT(*) total,SUM(CASE WHEN origem='gmail' THEN 1 ELSE 0 END) gmail FROM faturamento_recebimentos_pdf WHERE documento_id=?",
    );
    const contarAcoes = banco.prepare(
      "SELECT COUNT(*) total FROM faturamento_historico WHERE documento_id=? AND acao<>'Importação de PDF'",
    );
    for (const documento of candidatos) {
      const recebimentos = contarRecebimentos.get(documento.id);
      if (
        documento.classificacao !== "fatura" ||
        documento.status !== "Pendente de revisão" ||
        documento.memoria !== null ||
        documento.unidade_id !== null ||
        documento.competencia !== null ||
        documento.versao !== 1 ||
        recebimentos.total !== 1 ||
        recebimentos.gmail !== 1 ||
        contarAcoes.get(documento.id).total !== 0
      )
        throw new Error("estado_divergente");
    }
    const atualizar = banco.prepare(
      `UPDATE faturamento_documentos SET classificacao='triagem',
       versao=versao+1,atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND versao=1`,
    );
    const historico = banco.prepare(
      `INSERT INTO faturamento_historico
       (documento_id,responsavel,administrador_id,acao,dados)
       VALUES (?,'Migração triagem Gmail',NULL,'Reclassificação para triagem Gmail',?)`,
    );
    for (const documento of candidatos) {
      if (atualizar.run(documento.id).changes !== 1)
        throw new Error("conflito_concorrente");
      historico.run(
        documento.id,
        JSON.stringify({ contaId, anterior: "fatura", novo: "triagem" }),
      );
    }
    banco.exec("COMMIT");
    return candidatos.length;
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}
