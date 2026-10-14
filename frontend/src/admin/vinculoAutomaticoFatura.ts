import type { Unidade } from "./UnidadesDeCobranca";

const ucNormalizada = (valor: unknown) =>
  String(valor ?? "")
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "");

const correspondeAIdentificador = (unidade: Unidade, uc: string) =>
  unidade.uc === uc ||
  ucNormalizada(unidade.uc_antiga) === uc ||
  Boolean(unidade.ucs_antigas?.some((item) => ucNormalizada(item) === uc));

/** Identifica a UC sem presumir que um cadastro provisório já tenha acesso ao portal. */
export function unidadeDaFatura(
  dados: Record<string, string>,
  ucExtraida: string | undefined,
  nomeArquivo: string,
  unidades: Unidade[],
): Unidade | null {
  const ucSalva = ucNormalizada(dados.uc);
  // Em dois PDFs legados o número do arquivo foi salvo por engano como UC.
  // Priorizamos a UC extraída mesmo se já existir um cadastro com o número
  // incorreto do PDF; a seleção visual não altera o registro da fatura.
  const numeroArquivo = nomeArquivo.match(/^(\d+)\.pdf$/i)?.[1];
  const extraida = ucNormalizada(ucExtraida);
  if (!ucSalva && extraida)
    return (
      unidades.find((unidade) =>
        correspondeAIdentificador(unidade, extraida),
      ) ?? null
    );
  if (numeroArquivo && ucSalva === numeroArquivo && extraida !== ucSalva)
    return (
      unidades.find((unidade) =>
        correspondeAIdentificador(unidade, extraida),
      ) ?? null
    );
  const pelaSalva = unidades.find((unidade) =>
    correspondeAIdentificador(unidade, ucSalva),
  );
  if (
    extraida &&
    ucSalva &&
    extraida !== ucSalva &&
    (!pelaSalva || !correspondeAIdentificador(pelaSalva, extraida))
  )
    return null;
  return pelaSalva ?? null;
}
