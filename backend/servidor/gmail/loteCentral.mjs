import { modoTemporarioDeHomologacaoCentral } from "../centralFaturas.mjs";
import { createHash } from "node:crypto";

function motivo(valor) {
  return typeof valor === "string" && valor.trim()
    ? valor.trim()
    : "motivo_nao_informado";
}

function documentosDaCaptura(banco, contaId, capturaId) {
  const captura = banco
    .prepare(
      `SELECT id,conta_id,estado,inicio_local,fim_local,capturados,duplicados,
              triagem,falhas
         FROM gmail_capturas_periodo WHERE id=? AND conta_id=?`,
    )
    .get(capturaId, contaId);
  if (!captura) throw new Error("captura_periodo_indisponivel");
  if (captura.estado !== "concluida")
    throw new Error("captura_periodo_nao_concluida");

  const documentos = banco
    .prepare(
      `SELECT d.id,d.nome,d.classificacao,d.finalidade,d.versao,d.competencia,
              d.unidade_id,d.hash,
              MAX(CASE WHEN a.estado='capturado' THEN 1 ELSE 0 END) AS tem_anexo_capturado
         FROM gmail_capturas_periodo_mensagens m
         JOIN gmail_capturas_periodo c ON c.id=m.captura_id
         JOIN gmail_anexos a ON a.conta_id=c.conta_id AND a.message_id=m.message_id
         JOIN faturamento_documentos d ON d.id=a.documento_id
        WHERE c.id=? AND c.conta_id=? AND d.excluido_em IS NULL
        GROUP BY d.id
        ORDER BY d.id`,
    )
    .all(capturaId, contaId);
  return { captura: { ...captura }, documentos: documentos.map((item) => ({ ...item })) };
}

function revisar(documento, motivos, simulacao = null) {
  return {
    ...documento,
    situacao: "revisar",
    modo: null,
    motivos: motivos.map(motivo),
    simulacao,
  };
}

function preparacaoDocumentalInterrompida(resultado) {
  return Array.isArray(resultado?.itens) &&
    resultado.itens.some(
      (item) =>
        item?.documental?.situacao === "revisar" &&
        String(item.documental.motivo ?? "").includes(
          "diretorio_de_homologacao_ja_existe",
        ),
    );
}

// Não grava a prévia. O chamador pode repetir a operação com segurança e só
// recebe documentos que pertencem à captura persistida do período informado.
export async function prepararLoteCentralDaCaptura({
  banco,
  contaId,
  capturaId,
  localizar,
  simular,
  processarDocumental = null,
  processarFinanceiro = null,
  obterPreparacao = null,
  salvarPreparacao = null,
  obterAssinaturaFonte = async () => "fonte_central_nao_versionada",
}) {
  const { captura, documentos } = documentosDaCaptura(banco, contaId, capturaId);
  const assinaturaFonte = await obterAssinaturaFonte();
  if (typeof assinaturaFonte !== "string" || !assinaturaFonte.trim())
    throw new Error("assinatura_da_fonte_central_invalida");
  const chaveIdempotencia = createHash("sha256")
    .update(
      JSON.stringify(
        {
          documentos: documentos.map((documento) => [
            documento.id,
            documento.versao,
            documento.hash ?? null,
          ]),
          fonteCentral: assinaturaFonte,
        },
      ),
    )
    .digest("hex");
  const anterior = obterPreparacao?.({ capturaId });
  if (
    anterior?.chave_idempotencia === chaveIdempotencia &&
    !preparacaoDocumentalInterrompida(anterior.resultado)
  )
    return anterior.resultado;
  const elegiveisParaSimulacao = documentos.filter(
    (item) =>
      item.tem_anexo_capturado === 1 &&
      ["triagem", "fatura"].includes(item.classificacao) &&
      item.finalidade === "cobranca",
  );
  const localizadosPorId = new Map();
  if (elegiveisParaSimulacao.length) {
    try {
      const resposta = await localizar({
        documentos: elegiveisParaSimulacao.map((item) => item.id),
      });
      for (const item of resposta?.resultados ?? []) {
        if (Number.isSafeInteger(item?.documento))
          localizadosPorId.set(item.documento, item);
      }
    } catch (erro) {
      for (const item of elegiveisParaSimulacao)
        localizadosPorId.set(item.id, {
          documento: item.id,
          situacao: "revisar",
          motivo: `localizacao_central_indisponivel:${motivo(erro?.message)}`,
        });
    }
  }

  const modosPorId = new Map();
  for (const documento of elegiveisParaSimulacao) {
    const localizado = localizadosPorId.get(documento.id);
    // A identidade documental pode ser suficiente para Royer, mesmo quando a
    // linha financeira ainda não foi localizada. A modalidade continua sendo
    // o único critério para liberar cálculo de boleto.
    if (!["segura", "identificada"].includes(localizado?.situacao)) continue;
    const modo = modoTemporarioDeHomologacaoCentral(localizado.usina);
    if (modo) modosPorId.set(documento.id, modo);
  }
  const simulacoesPorId = new Map();
  const financeiros = elegiveisParaSimulacao.filter(
    (documento) =>
      modosPorId.get(documento.id) === "financeiro" &&
      localizadosPorId.get(documento.id)?.situacao === "segura",
  );
  if (financeiros.length) {
    try {
      const resposta = await simular({ documentos: financeiros.map((item) => item.id) });
      for (const item of resposta?.resultados ?? []) {
        if (Number.isSafeInteger(item?.documento)) simulacoesPorId.set(item.documento, item);
      }
    } catch (erro) {
      for (const item of financeiros)
        simulacoesPorId.set(item.id, {
          documento: item.id,
          situacao: "revisar",
          motivos: [`simulacao_central_indisponivel:${motivo(erro?.message)}`],
        });
    }
  }

  let itens = documentos.map((documento) => {
    if (documento.tem_anexo_capturado !== 1)
      return revisar(documento, ["anexo_nao_disponivel_no_lote"]);
    if (!["triagem", "fatura"].includes(documento.classificacao))
      return revisar(documento, ["documento_nao_classificado_como_fatura"]);
    if (documento.finalidade !== "cobranca")
      return revisar(documento, ["documento_nao_destinado_a_cobranca"]);
    const localizacao = localizadosPorId.get(documento.id);
    if (!localizacao)
      return revisar(documento, ["localizacao_central_sem_resultado"]);
    const modo = modosPorId.get(documento.id);
    if (localizacao.situacao === "identificada" && modo === "documental")
      return {
        ...documento,
        situacao: "preparado",
        modo,
        motivos: [],
        simulacao: localizacao,
      };
    if (localizacao.situacao !== "segura")
      return revisar(documento, [
        localizacao.motivoFinanceiro ?? localizacao.motivo ?? "localizacao_central_revisar",
      ], localizacao);
    if (!modo)
      return revisar(documento, ["modalidade_operacional_nao_confirmada"], localizacao);
    if (modo === "documental")
      return {
        ...documento,
        situacao: "preparado",
        modo,
        motivos: [],
        simulacao: localizacao,
      };
    const simulacao = simulacoesPorId.get(documento.id);
    if (!simulacao)
      return revisar(documento, ["simulacao_central_sem_resultado"], localizacao);
    if (simulacao.situacao !== "simulada")
      return revisar(documento, simulacao.motivos ?? ["simulacao_central_revisar"], simulacao);
    return {
      ...documento,
      situacao: "preparado",
      modo,
      motivos: [],
      simulacao,
    };
  });
  const financeirosPreparados = itens.filter(
    (item) =>
      item.modo === "financeiro" &&
      item.situacao === "preparado" &&
      item.simulacao?.situacao === "simulada",
  );
  const documentais = itens
    .filter(
      (item) =>
        ["segura", "identificada", "simulada"].includes(item.simulacao?.situacao) &&
        item.simulacao?.cliente &&
        item.simulacao?.usina &&
        item.simulacao?.ucNova &&
        item.modo !== "financeiro",
    )
    .map((item) => item.id);
  const documentaisPorId = new Map();
  if (processarFinanceiro && financeirosPreparados.length) {
    const gruposFinanceiros = new Map();
    for (const item of financeirosPreparados) {
      const { planilha, mesFaturamento, usina } = item.simulacao;
      if (!planilha || !mesFaturamento || !usina) {
        documentaisPorId.set(item.id, {
          situacao: "revisar",
          motivo: "dados_financeiros_da_central_incompletos",
        });
        continue;
      }
      const chave = JSON.stringify([planilha, mesFaturamento, usina]);
      gruposFinanceiros.set(chave, [...(gruposFinanceiros.get(chave) ?? []), item]);
    }
    let sequenciaFinanceira = 0;
    for (const grupo of gruposFinanceiros.values()) {
      sequenciaFinanceira += 1;
      const documentosDoGrupo = grupo.map((item) => item.id);
      try {
        const resultado = await processarFinanceiro({
          documentos: documentosDoGrupo,
          chaveIdempotencia,
          sequencia: sequenciaFinanceira,
        });
        const pdfsPorDocumento = new Map(
          (resultado?.pdfs ?? [])
            .filter((pdf) => Number.isSafeInteger(pdf?.documento))
            .map((pdf) => [pdf.documento, pdf]),
        );
        for (const item of grupo) {
          const pdf = pdfsPorDocumento.get(item.id);
          if (!pdf) {
            documentaisPorId.set(item.id, {
              situacao: "revisar",
              motivo: "processamento_financeiro_central_incompleto",
            });
            continue;
          }
          documentaisPorId.set(item.id, {
            situacao: "pronto",
            pdfFinal: pdf.pdf_final,
            pdfImpressao: pdf.pdf_impressao,
            nomeFinal: pdf.nomeFinal,
            valorBoleto: pdf.valor_boleto ?? item.simulacao.valorBoleto,
          });
        }
      } catch (erro) {
        for (const item of grupo)
          documentaisPorId.set(item.id, {
            situacao: "revisar",
            motivo: `processamento_financeiro_central_indisponivel:${motivo(erro?.message)}`,
          });
      }
    }
  }
  if (processarDocumental && documentais.length) {
    for (let inicio = 0; inicio < documentais.length; inicio += 10) {
      const grupo = documentais.slice(inicio, inicio + 10);
      try {
        const resultado = await processarDocumental({
          documentos: grupo,
          chaveIdempotencia,
          sequencia: inicio / 10 + 1,
        });
        for (const pdf of resultado?.pdfs ?? [])
          if (Number.isSafeInteger(pdf?.documento))
            documentaisPorId.set(pdf.documento, {
              situacao: "pronto",
              pdfFinal: pdf.pdf_final,
              pdfImpressao: pdf.pdf_impressao,
              nomeFinal: pdf.nomeFinal,
            });
        for (const pendencia of resultado?.pendencias ?? [])
          if (Number.isSafeInteger(pendencia?.documento))
            documentaisPorId.set(pendencia.documento, {
              situacao: "revisar",
              motivo: motivo(pendencia.motivo),
            });
      } catch (erro) {
        for (const documento of grupo)
          documentaisPorId.set(documento, {
            situacao: "revisar",
            motivo: `preparacao_documental_indisponivel:${motivo(erro?.message)}`,
          });
      }
    }
  }
  itens = itens.map((item) => ({
    ...item,
    documental: documentaisPorId.get(item.id) ?? null,
  }));
  const quantidade = (predicado) => itens.filter(predicado).length;
  const documentosDocumentaisProntos = quantidade(
    (item) => item.documental?.situacao === "pronto",
  );
  const identificadosDocumentalmente = quantidade((item) =>
    ["segura", "identificada", "simulada"].includes(item.simulacao?.situacao),
  );
  const financeiramenteAptos = quantidade(
    (item) => item.modo === "financeiro" && item.situacao === "preparado",
  );
  const resultado = {
    captura,
    fonteCentral: assinaturaFonte,
    itens,
    resumo: {
      totalCapturado: captura.capturados,
      documentosNoLote: itens.length,
      identificadosDocumentalmente,
      documentosDocumentaisProntos,
      revisaoDocumental: itens.length - documentosDocumentaisProntos,
      financeiramenteAptos,
      revisaoFinanceira: quantidade(
        (item) => item.modo !== "documental" && item.situacao === "revisar",
      ),
      elegiveis: quantidade((item) => item.situacao === "preparado"),
      preparados: quantidade((item) => item.situacao === "preparado"),
      revisar: quantidade((item) => item.situacao === "revisar"),
      processados: documentosDocumentaisProntos,
      falhas: quantidade((item) =>
        item.motivos.some((itemMotivo) =>
          itemMotivo.startsWith("simulacao_central_indisponivel:"),
        ),
      ),
      pdfsProntosParaImpressao: documentosDocumentaisProntos,
    },
  };
  if (salvarPreparacao)
    salvarPreparacao({
      capturaId,
      chaveIdempotencia,
      estado:
        resultado.resumo.pdfsProntosParaImpressao > 0 ? "concluida" : "revisar",
      resultado,
    });
  return resultado;
}
