import type { Documento } from "./tiposFaturamento";
import type { Unidade } from "./UnidadesDeCobranca";
import { unidadeDaFatura } from "./vinculoAutomaticoFatura";
import {
  modalidadeDaUcNaCompetencia,
  pendenciasParaEmissao,
  pendenciasParaCalculo,
} from "./prontidaoFatura";
import { sugerirVencimentoEcosolSeDefinido } from "./vencimentoEcosol";

export const statusAprovada = "Aprovada — aguardando emissão";
export const situacoesCalculo = {
  pendente: "Dados pendentes",
  pronta: "Pronta para prévia",
  calculada: "Aguardando aprovação",
  aprovada: "Aguardando emissão",
  aprovada_bloqueada: "Emissão bloqueada",
} as const;
export type SituacaoCalculo = keyof typeof situacoesCalculo;

/** Sugestões em memória; a gravação usa a prévia e a confirmação do servidor. */
export function prepararLinhaCalculo(
  documento: Documento,
  unidades: Unidade[],
  documentos: Documento[],
  hoje = new Date(),
) {
  const memoria = documento.memoria;
  const dados = { ...documento.dados };
  const primeiraVinculacao = !dados.unidade_id;
  const uc = String(dados.uc ?? "")
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "");
  const unidadeSalva = unidades.find(
    (item) =>
      item.id === Number(dados.unidade_id) &&
      item.uc === uc &&
      (item.cliente_id === Number(dados.cliente_id) ||
        ((item.cliente_provisorio_id != null ||
          item.cliente_operacional_id != null) &&
          !dados.cliente_id)),
  );
  const unidade =
    memoria?.unidade ??
    unidadeSalva ??
    unidadeDaFatura(
      dados,
      documento.extracao.dados?.uc,
      documento.nome,
      unidades,
    );
  if (!memoria && unidade) {
    const vinculoCompativel =
      (!dados.unidade_id || Number(dados.unidade_id) === unidade.id) &&
      (!dados.cliente_id || Number(dados.cliente_id) === unidade.cliente_id);
    if (vinculoCompativel) {
      dados.uc = unidade.uc;
      dados.unidade_id = String(unidade.id);
      dados.cliente_id = unidade.cliente_id ? String(unidade.cliente_id) : "";
      if (!dados.modalidade)
        dados.modalidade =
          modalidadeDaUcNaCompetencia(unidade, dados.competencia)?.modalidade ??
          "";
      if (primeiraVinculacao && !dados.vencimento_ecosol)
        dados.vencimento_ecosol = sugerirVencimentoEcosolSeDefinido(
          unidade.dia_vencimento,
          hoje,
        );
    }
    const modalidade =
      modalidadeDaUcNaCompetencia(unidade, dados.competencia)?.modalidade ??
      dados.modalidade;
    if (modalidade === "GDI") dados.ajuste_gdii = "0";
  }
  const competencia = memoria?.competencia ?? dados.competencia ?? "";
  const vinculos = unidade?.vinculos_usina;
  const vinculo = vinculos?.find((item) => item.inicio <= competencia);
  // Memórias salvas guardam a usina da época; nunca substituí-la pela atual.
  const usinaId = memoria
    ? (memoria.unidade.usina_id ?? null)
    : vinculos?.length
      ? (vinculo?.usina_id ?? null)
      : (unidade?.usina_id ?? null);
  const usinaNome = memoria
    ? memoria.unidade.usina_nome
    : vinculos?.length
      ? vinculo?.usina_nome
      : unidade?.usina_nome;
  const pendencias = memoria
    ? []
    : pendenciasParaCalculo(documento, unidades, documentos, dados);
  const pendenciasEmissao = memoria
    ? pendenciasParaEmissao(documento, unidades, dados, unidade ?? undefined)
    : [];
  const situacao: SituacaoCalculo =
    memoria && documento.status === statusAprovada
      ? pendenciasEmissao.length
        ? "aprovada_bloqueada"
        : "aprovada"
      : memoria && documento.status === "Calculada"
        ? "calculada"
        : pendencias.length
          ? "pendente"
          : "pronta";
  return {
    documento,
    dados,
    memoria,
    unidade,
    competencia,
    usinaId,
    usinaNome: usinaNome || "Alocação a definir",
    cliente: unidade?.cliente_nome || unidade?.nome || "Cliente a identificar",
    uc: unidade?.uc || dados.uc || "Não identificada",
    modalidade:
      memoria?.contrato.modalidade ||
      modalidadeDaUcNaCompetencia(unidade ?? undefined, competencia)
        ?.modalidade ||
      dados.modalidade ||
      "—",
    pendencias,
    pendenciasEmissao,
    situacao,
  };
}
export type LinhaCalculo = ReturnType<typeof prepararLinhaCalculo>;

export function resumirCalculos(linhas: LinhaCalculo[]) {
  const salvas = linhas.filter(
    (linha) =>
      linha.memoria &&
      ["calculada", "aprovada", "aprovada_bloqueada"].includes(
        linha.situacao,
      ),
  );
  return {
    quantidade: linhas.length,
    pendentes: linhas.filter((linha) => linha.situacao === "pendente").length,
    prontas: linhas.filter((linha) => linha.situacao === "pronta").length,
    calculadas: salvas.length,
    aguardandoAprovacao: linhas.filter(
      (linha) => linha.situacao === "calculada",
    ).length,
    aprovadas: linhas.filter((linha) =>
      ["aprovada", "aprovada_bloqueada"].includes(linha.situacao),
    ).length,
    // As parcelas já chegam do servidor em centavos inteiros.
    totalCentavos: salvas.reduce(
      (total, linha) => total + linha.memoria!.total_centavos,
      0,
    ),
  };
}
