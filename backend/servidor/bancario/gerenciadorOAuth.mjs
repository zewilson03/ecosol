import { FalhaHttpSicoob } from "./clienteHttpSeguro.mjs";

function validarToken(resultado) {
  const accessToken = resultado?.accessToken;
  const expiresInSeconds = Number(resultado?.expiresInSeconds);
  const tokenType = resultado?.tokenType || "Bearer";
  if (
    typeof accessToken !== "string" ||
    accessToken.length < 8 ||
    accessToken.length > 16_384 ||
    /[\r\n]/.test(accessToken) ||
    !Number.isFinite(expiresInSeconds) ||
    expiresInSeconds <= 0 ||
    expiresInSeconds > 86_400 ||
    !/^[A-Za-z][A-Za-z0-9._~-]*$/.test(tokenType)
  )
    throw new FalhaHttpSicoob("SICOOB_TOKEN_INVALIDO");
  return { accessToken, expiresInSeconds, tokenType };
}

/** Cache exclusivamente em memória, com renovação compartilhada entre chamadas. */
export function criarGerenciadorOAuth({
  obterNovoToken,
  relogio = () => Date.now(),
  margemExpiracaoMs = 60_000,
} = {}) {
  if (typeof obterNovoToken !== "function")
    throw new Error("Informe como obter um token OAuth do contrato oficial.");
  if (!Number.isInteger(margemExpiracaoMs) || margemExpiracaoMs < 0)
    throw new Error("A margem de expiração OAuth é inválida.");
  let cache = null;
  let renovacao = null;

  return Object.freeze({
    async obter() {
      const agora = relogio();
      if (cache && agora + margemExpiracaoMs < cache.expiraEm)
        return { accessToken: cache.accessToken, tokenType: cache.tokenType };
      if (!renovacao) {
        renovacao = Promise.resolve()
          .then(obterNovoToken)
          .catch((erro) => {
            if (erro instanceof FalhaHttpSicoob) throw erro;
            throw new FalhaHttpSicoob("SICOOB_OAUTH_FALHOU");
          })
          .then(validarToken)
          .then((token) => {
            cache = {
              accessToken: token.accessToken,
              tokenType: token.tokenType,
              expiraEm: relogio() + token.expiresInSeconds * 1_000,
            };
            return {
              accessToken: cache.accessToken,
              tokenType: cache.tokenType,
            };
          })
          .finally(() => {
            renovacao = null;
          });
      }
      return await renovacao;
    },
    invalidar(accessTokenUsado) {
      if (
        !cache ||
        (accessTokenUsado && cache.accessToken !== accessTokenUsado)
      )
        return false;
      cache = null;
      return true;
    },
    estado() {
      return {
        em_cache: Boolean(cache),
        renovacao_em_andamento: Boolean(renovacao),
        expira_em: cache?.expiraEm ?? null,
      };
    },
  });
}

/**
 * A forma do pedido e da resposta permanece a cargo do contrato oficial. Isso
 * evita presumir grant, campos, scope ou autenticação do Sicoob.
 */
export function criarCarregadorTokenOAuth({ clienteHttp, contratoOAuth } = {}) {
  if (!clienteHttp?.solicitar)
    throw new Error("Informe o cliente HTTP do endpoint OAuth.");
  if (
    typeof contratoOAuth?.criarRequisicaoToken !== "function" ||
    typeof contratoOAuth?.interpretarToken !== "function"
  )
    throw new Error("O contrato OAuth oficial ainda não foi configurado.");
  return async () => {
    const requisicao = contratoOAuth.criarRequisicaoToken();
    const resposta = await clienteHttp.solicitar(requisicao);
    if (resposta.status < 200 || resposta.status >= 300)
      throw new FalhaHttpSicoob("SICOOB_OAUTH_RECUSADO", {
        status: resposta.status,
        retryAfterMs: resposta.retryAfterMs,
      });
    return contratoOAuth.interpretarToken(resposta);
  };
}
