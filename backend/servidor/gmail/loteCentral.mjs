import { modoTemporarioDeHomologacaoCentral } from "../centralFaturas.mjs";

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
              d.unidade_id,
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

// Não grava a prévia. O chamador pode repetir a operação com segurança e só
// recebe documentos que pertencem à captura persistida do período informado.
export async function prepararLoteCentralDaCaptura({
  banco,
  contaId,
  capturaId,
  localizar,
  simular,
}) {
  const { captura, documentos } = documentosDaCaptura(banco, contaId, capturaId);
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
    if (localizado?.situacao !== "segura") continue;
    const modo = modoTemporarioDeHomologacaoCentral(localizado.usina);
    if (modo) modosPorId.set(documento.id, modo);
  }
  const simulacoesPorId = new Map();
  const financeiros = elegiveisParaSimulacao.filter(
    (documento) => modosPorId.get(documento.id) === "financeiro",
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

  const itens = documentos.map((documento) => {
    if (documento.tem_anexo_capturado !== 1)
      return revisar(documento, ["anexo_nao_disponivel_no_lote"]);
    if (!["triagem", "fatura"].includes(documento.classificacao))
      return revisar(documento, ["documento_nao_classificado_como_fatura"]);
    if (documento.finalidade !== "cobranca")
      return revisar(documento, ["documento_nao_destinado_a_cobranca"]);
    const localizacao = localizadosPorId.get(documento.id);
    if (!localizacao)
      return revisar(documento, ["localizacao_central_sem_resultado"]);
    if (localizacao.situacao !== "segura")
      return revisar(documento, [localizacao.motivo ?? "localizacao_central_revisar"], localizacao);
    const modo = modosPorId.get(documento.id);
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
  const quantidade = (predicado) => itens.filter(predicado).length;
  return {
    captura,
    itens,
    resumo: {
      totalCapturado: captura.capturados,
      documentosNoLote: itens.length,
      elegiveis: quantidade((item) => item.situacao === "preparado"),
      preparados: quantidade((item) => item.situacao === "preparado"),
      revisar: quantidade((item) => item.situacao === "revisar"),
      processados: 0,
      falhas: quantidade((item) =>
        item.motivos.some((itemMotivo) =>
          itemMotivo.startsWith("simulacao_central_indisponivel:"),
        ),
      ),
      pdfsProntosParaImpressao: 0,
    },
  };
}
