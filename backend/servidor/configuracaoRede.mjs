const hostsPermitidos = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "0.0.0.0",
  "::",
]);

function falhar(mensagem) {
  throw new Error(`Configuração de rede inválida: ${mensagem}`);
}

export function obterConfiguracaoRede(variaveis = process.env) {
  const porta = Number(variaveis.PORT ?? 3000);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65_535)
    falhar("PORT deve ser um inteiro entre 1 e 65535.");

  const host = String(variaveis.HOST ?? "127.0.0.1")
    .trim()
    .toLowerCase();
  if (!hostsPermitidos.has(host))
    falhar("HOST deve ser local ou um endereço curinga autorizado.");

  const acessoPelaRede = host === "0.0.0.0" || host === "::";
  if (acessoPelaRede && !variaveis.APP_URL)
    falhar("APP_URL é obrigatória quando HOST permite acesso pela rede.");

  const appUrlBruta = String(
    variaveis.APP_URL ?? `http://localhost:${porta}`,
  ).trim();
  let appUrl;
  try {
    appUrl = new URL(appUrlBruta);
  } catch {
    falhar("APP_URL deve ser uma URL HTTP ou HTTPS válida.");
  }
  if (
    !["http:", "https:"].includes(appUrl.protocol) ||
    appUrl.username ||
    appUrl.password ||
    appUrl.pathname !== "/" ||
    appUrl.search ||
    appUrl.hash
  )
    falhar("APP_URL deve conter somente a origem HTTP ou HTTPS.");
  if (
    acessoPelaRede &&
    ["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname.toLowerCase())
  )
    falhar("APP_URL deve usar o endereço acessível pelo celular.");

  return Object.freeze({ porta, host, appUrl: appUrl.origin });
}
