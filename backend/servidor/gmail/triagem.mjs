function documentoDaConta(banco, contaId, documentoId) {
  return banco
    .prepare(
      `SELECT d.id,d.nome,d.classificacao,d.versao,d.status,
              d.memoria,d.unidade_id,d.competencia,d.excluido_em
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
         AND d.excluido_em IS NULL
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
         AND d.excluido_em IS NULL
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
  if (
    !documento ||
    documento.classificacao === "fatura" ||
    documento.excluido_em !== null
  )
    return null;
  return banco
    .prepare("SELECT pdf FROM faturamento_documentos WHERE id=?")
    .get(documentoId).pdf;
}

export function classificarDocumentoGmail({
  banco,
  contaId,
  documentoId,
  versao,
  destino,
  administrador,
}) {
  const resultado = classificarDocumentosGmail({
    banco,
    contaId,
    itens: [{ id: documentoId, versao }],
    destino,
    administrador,
    permitirInalterado: false,
  });
  return resultado.itens[0];
}

export function classificarDocumentosGmail({
  banco,
  contaId,
  itens,
  destino,
  administrador,
  permitirInalterado = true,
}) {
  if (!["fatura", "nao_fatura"].includes(destino))
    throw new Error("destino_invalido");
  if (
    !Array.isArray(itens) ||
    itens.length < 1 ||
    itens.length > 500 ||
    itens.some(
      (item) =>
        !item ||
        !Number.isSafeInteger(item.id) ||
        item.id < 1 ||
        !Number.isSafeInteger(item.versao) ||
        item.versao < 1,
    ) ||
    new Set(itens.map((item) => item.id)).size !== itens.length
  )
    throw new Error("selecao_invalida");
  banco.exec("BEGIN IMMEDIATE");
  try {
    const documentos = itens.map((item) => {
      const documento = documentoDaConta(banco, contaId, item.id);
      if (
        !documento ||
        documento.classificacao === "fatura" ||
        documento.excluido_em !== null
      )
        throw new Error("documento_indisponivel");
      if (documento.versao !== item.versao) throw new Error("versao_obsoleta");
      if (documento.classificacao === destino && !permitirInalterado)
        throw new Error("classificacao_inalterada");
      if (
        documento.status !== "Pendente de revisão" ||
        documento.memoria !== null ||
        documento.unidade_id !== null ||
        documento.competencia !== null
      )
        throw new Error("estado_financeiro_incompativel");
      return documento;
    });
    const atualizar = banco.prepare(
      `UPDATE faturamento_documentos
       SET classificacao=?,versao=versao+1,atualizado_em=CURRENT_TIMESTAMP
       WHERE id=? AND versao=?`,
    );
    const historico = banco.prepare(
      `INSERT INTO faturamento_historico
       (documento_id,responsavel,administrador_id,acao,dados)
       VALUES (?,?,?,?,?)`,
    );
    const resultado = documentos.map((documento) => {
      if (documento.classificacao === destino)
        return {
          id: documento.id,
          classificacao: destino,
          versao: documento.versao,
          alterado: false,
        };
      if (atualizar.run(destino, documento.id, documento.versao).changes !== 1)
        throw new Error("versao_obsoleta");
      historico.run(
        documento.id,
        administrador.nome,
        administrador.id,
        "Classificação de PDF Gmail",
        JSON.stringify({
          contaId,
          anterior: documento.classificacao,
          novo: destino,
        }),
      );
      return {
        id: documento.id,
        classificacao: destino,
        versao: documento.versao + 1,
        alterado: true,
      };
    });
    banco.exec("COMMIT");
    return {
      itens: resultado,
      alterados: resultado.filter((item) => item.alterado).length,
    };
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

export function excluirDocumentosGmail({
  banco,
  contaId,
  itens,
  administrador,
  confirmacao,
}) {
  if (confirmacao !== "EXCLUIR") throw new Error("confirmacao_invalida");
  if (
    !Array.isArray(itens) ||
    itens.length < 1 ||
    itens.length > 500 ||
    itens.some(
      (item) =>
        !item ||
        !Number.isSafeInteger(item.id) ||
        item.id < 1 ||
        !Number.isSafeInteger(item.versao) ||
        item.versao < 1,
    ) ||
    new Set(itens.map((item) => item.id)).size !== itens.length
  )
    throw new Error("selecao_invalida");
  banco.exec("BEGIN IMMEDIATE");
  try {
    const documentos = itens.map((item) => {
      const documento = documentoDaConta(banco, contaId, item.id);
      if (
        !documento ||
        documento.classificacao === "fatura" ||
        documento.excluido_em !== null
      )
        throw new Error("documento_indisponivel");
      if (documento.versao !== item.versao) throw new Error("versao_obsoleta");
      if (
        documento.status !== "Pendente de revisão" ||
        documento.memoria !== null ||
        documento.unidade_id !== null ||
        documento.competencia !== null
      )
        throw new Error("estado_financeiro_incompativel");
      const compartilhado = banco
        .prepare(
          `SELECT EXISTS(
             SELECT 1 FROM gmail_anexos
             WHERE documento_id=? AND conta_id<>?
           ) OR EXISTS(
             SELECT 1 FROM faturamento_recebimentos_pdf
             WHERE documento_id=? AND origem<>'gmail'
           ) AS compartilhado`,
        )
        .get(documento.id, contaId, documento.id).compartilhado;
      if (compartilhado) throw new Error("documento_compartilhado");
      return documento;
    });
    const excluir = banco.prepare(
      `UPDATE faturamento_documentos
       SET pdf=X'',texto='',extracao='{}',dados='{}',
           excluido_em=CURRENT_TIMESTAMP,versao=versao+1,
           atualizado_em=CURRENT_TIMESTAMP
       WHERE id=? AND versao=? AND excluido_em IS NULL`,
    );
    const historico = banco.prepare(
      `INSERT INTO faturamento_historico
       (documento_id,responsavel,administrador_id,acao,dados)
       VALUES (?,?,?,?,?)`,
    );
    for (const documento of documentos) {
      if (excluir.run(documento.id, documento.versao).changes !== 1)
        throw new Error("versao_obsoleta");
      historico.run(
        documento.id,
        administrador.nome,
        administrador.id,
        "Exclusão definitiva de PDF Gmail",
        JSON.stringify({ contaId, classificacao: documento.classificacao }),
      );
    }
    banco.exec("COMMIT");
    return { excluidos: documentos.length };
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
