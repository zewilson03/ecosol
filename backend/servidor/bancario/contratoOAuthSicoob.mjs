import { FalhaHttpSicoob } from "./clienteHttpSeguro.mjs";

function texto(valor, nome, limite = 2_048) {
  const normalizado = String(valor ?? "").trim();
  if (!normalizado || normalizado.length > limite || /[\r\n]/.test(normalizado))
    throw new Error(`${nome} inválido na configuração OAuth do Sicoob.`);
  return normalizado;
}

/** Contrato oficial Client Credentials publicado pelo Portal Developers. */
export const contratoOAuthSicoob = Object.freeze({
  criarRequisicaoToken(configuracao) {
    const corpo = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: texto(configuracao?.clientId, "Client ID", 512),
    });
    if (configuracao?.clientSecret)
      corpo.set(
        "client_secret",
        texto(configuracao.clientSecret, "Client secret", 2_048),
      );
    if (configuracao?.oauthScope)
      corpo.set("scope", texto(configuracao.oauthScope, "Escopo", 4_096));
    return {
      metodo: "POST",
      cabecalhos: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      corpo: corpo.toString(),
    };
  },

  interpretarToken(resposta) {
    const conteudo = resposta?.conteudo;
    if (!conteudo || typeof conteudo !== "object" || Array.isArray(conteudo))
      throw new FalhaHttpSicoob("SICOOB_TOKEN_INVALIDO");
    return {
      accessToken: conteudo.access_token,
      expiresInSeconds: conteudo.expires_in,
      tokenType: conteudo.token_type || "Bearer",
    };
  },
});
