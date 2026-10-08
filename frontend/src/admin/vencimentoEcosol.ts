/** Próxima ocorrência do dia preferido, tomando o dia em São Paulo como base. */
export function sugerirVencimentoEcosol(
  diaPreferido: number,
  hoje: Date = new Date(),
): string {
  if (!Number.isInteger(diaPreferido) || diaPreferido < 1 || diaPreferido > 31)
    throw new RangeError("Dia preferido inválido.");
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(hoje);
  const valor = (tipo: string) =>
    Number(partes.find((parte) => parte.type === tipo)?.value);
  const ano = valor("year");
  const mes = valor("month") - 1;
  const criarData = (deslocamento: number) => {
    const inicio = new Date(ano, mes + deslocamento, 1);
    const ultimoDia = new Date(ano, mes + deslocamento + 1, 0).getDate();
    return new Date(
      inicio.getFullYear(),
      inicio.getMonth(),
      Math.min(diaPreferido, ultimoDia),
    );
  };
  const hojeSemHora = new Date(ano, mes, valor("day"));
  const data = criarData(0) < hojeSemHora ? criarData(1) : criarData(0);
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, "0"),
    String(data.getDate()).padStart(2, "0"),
  ].join("-");
}
