import type { Unidade } from "./UnidadesDeCobranca";

type FaturaDaFila = {
  id: number;
  lote: string;
  status: string;
  dados: Record<string, string>;
};

const preenchido = (valor: unknown) => String(valor ?? "").trim() !== "";
const ucNormalizada = (valor: unknown) =>
  String(valor ?? "")
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "");

export function pendenciasParaCalculo(
  fatura: FaturaDaFila,
  unidades: Unidade[],
  faturas: FaturaDaFila[],
  dados = fatura.dados,
): string[] {
  const unidade = unidades.find(
    (item) =>
      item.id === Number(dados.unidade_id) &&
      item.uc === ucNormalizada(dados.uc) &&
      (item.cliente_id === Number(dados.cliente_id) ||
        (item.cliente_provisorio_id != null && !dados.cliente_id)),
  );
  const semInjecao =
    preenchido(dados.injecao) && Number(dados.injecao.replace(",", ".")) === 0;
  const pendencias: string[] = [];
  if (!unidade) pendencias.push("cliente e UC");
  else if (unidade.cliente_provisorio_id != null)
    pendencias.push("cadastro definitivo do cliente");
  if (!preenchido(dados.competencia)) pendencias.push("competência");
  if (!preenchido(dados.injecao)) pendencias.push("energia injetada");
  if (!preenchido(dados.modalidade)) pendencias.push("modalidade");
  if (!semInjecao && !preenchido(dados.origem_tarifa))
    pendencias.push("origem da tarifa");
  if (!preenchido(dados.total_equatorial)) pendencias.push("total Equatorial");
  if (!semInjecao && !preenchido(dados.ajuste_gdii))
    pendencias.push("ajuste GDII (informe zero para GDI)");
  if (!preenchido(dados.vencimento_equatorial))
    pendencias.push("vencimento Equatorial");
  if (!preenchido(dados.vencimento_ecosol || dados.vencimento_equatorial))
    pendencias.push("vencimento Ecosol ou Equatorial");
  if (!semInjecao) {
    if (dados.origem_tarifa === "referencia") {
      const referencia = faturas.find(
        (item) => item.id === Number(dados.referencia_id),
      );
      if (
        !referencia ||
        referencia.id === fatura.id ||
        referencia.lote !== fatura.lote ||
        referencia.status !== "Aprovada — aguardando emissão" ||
        referencia.dados.modalidade !== "GDI"
      )
        pendencias.push("GDI de referência aprovada do mesmo lote");
    } else if (dados.origem_tarifa === "propria") {
      if (!preenchido(dados.unitario)) pendencias.push("unitário com tributos");
      if (!preenchido(dados.bandeira))
        pendencias.push("bandeira (informe zero se não houver)");
    }
    if (
      unidade &&
      preenchido(dados.competencia) &&
      !unidade.descontos?.some((item) => item.inicio <= dados.competencia)
    )
      pendencias.push("desconto vigente da UC");
  }
  return pendencias;
}

export function situacaoParaEmissao(
  fatura: FaturaDaFila,
  unidades: Unidade[],
  faturas: FaturaDaFila[],
) {
  if (fatura.status === "Aprovada — aguardando emissão")
    return { cor: "aguardando", texto: "Aguardando emissão", pendencias: [] };
  if (fatura.status === "Calculada")
    return { cor: "aguardando", texto: "Aguardando aprovação", pendencias: [] };
  const pendencias = pendenciasParaCalculo(fatura, unidades, faturas);
  return pendencias.length
    ? { cor: "incompleta", texto: "Dados pendentes", pendencias }
    : { cor: "aguardando", texto: "Pronta para avaliação", pendencias };
}
