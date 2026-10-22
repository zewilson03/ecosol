export type PrioridadeBancaria = "alta" | "media" | "informativa";

export type PendenciaOrdenavel = {
  operacao_id: string;
  prioridade: PrioridadeBancaria;
  idade_estado_segundos: number | null;
};

const acoesConciliaveis = new Set([
  "CONCILIAR_COBRANCA",
  "RECUPERAR_CONCILIACAO",
  "REVISAR_CONCILIACAO",
]);

export function podeConciliarPendencia({
  acao_necessaria,
  provedor_identificado,
}: {
  acao_necessaria: string | null;
  provedor_identificado: boolean;
}): boolean {
  return Boolean(
    provedor_identificado &&
    acao_necessaria &&
    acoesConciliaveis.has(acao_necessaria),
  );
}

const pesoDaPrioridade: Record<PrioridadeBancaria, number> = {
  alta: 0,
  media: 1,
  informativa: 2,
};

export function ordenarPendencias<T extends PendenciaOrdenavel>(
  pendencias: readonly T[],
): T[] {
  return [...pendencias].sort((a, b) => {
    const porPrioridade =
      pesoDaPrioridade[a.prioridade] - pesoDaPrioridade[b.prioridade];
    if (porPrioridade) return porPrioridade;
    const idadeA = a.idade_estado_segundos ?? -1;
    const idadeB = b.idade_estado_segundos ?? -1;
    if (idadeA !== idadeB) return idadeB - idadeA;
    return a.operacao_id.localeCompare(b.operacao_id);
  });
}

export function formatarValorBancario(
  valorCentavos: number,
  moeda: string,
): string {
  const codigo = String(moeda ?? "")
    .trim()
    .toUpperCase();
  if (codigo !== "BRL")
    return /^[A-Z]{3}$/.test(codigo)
      ? `Moeda não suportada (${codigo})`
      : "Moeda inválida";
  if (!Number.isSafeInteger(valorCentavos)) return "Valor inválido (BRL)";
  return `${new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valorCentavos / 100)} · BRL`;
}

export function duracaoNoEstado(segundos: number | null): string {
  if (segundos === null) return "Tempo indisponível";
  if (segundos < 60) return `${segundos}s neste estado`;
  if (segundos < 3_600) return `${Math.floor(segundos / 60)}min neste estado`;
  if (segundos < 86_400) return `${Math.floor(segundos / 3_600)}h neste estado`;
  return `${Math.floor(segundos / 86_400)}d neste estado`;
}
