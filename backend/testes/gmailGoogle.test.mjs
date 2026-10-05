import assert from "node:assert/strict";
import { criarClienteGoogle, ESCOPO_GMAIL } from "../servidor/gmail/google.mjs";

const chamadas = [];
let escopo = ESCOPO_GMAIL;
let perfil = "Faturas@Gmail.com";
const cliente = criarClienteGoogle(
  {
    clientId: "cliente-teste",
    clientSecret: "segredo-teste",
    redirectUri: "http://localhost:3000/api/admin/gmail/oauth/retorno",
  },
  async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    if (url.includes("oauth2.googleapis.com/token"))
      return {
        ok: true,
        async json() {
          return {
            access_token: "access",
            refresh_token: "refresh",
            token_type: "Bearer",
            scope: escopo,
          };
        },
      };
    if (url.includes("gmail.googleapis.com"))
      return {
        ok: true,
        async json() {
          return { emailAddress: perfil };
        },
      };
    throw new Error("Endpoint inesperado.");
  },
);

const url = new URL(
  cliente.urlDeAutorizacao({
    state: "s",
    desafio: "d",
    email: "faturas@gmail.com",
  }),
);
assert.equal(url.hostname, "accounts.google.com");
assert.equal(url.searchParams.get("access_type"), "offline");
assert.equal(url.searchParams.get("scope"), ESCOPO_GMAIL);
assert.equal(url.searchParams.get("code_challenge_method"), "S256");
assert.equal(url.searchParams.get("prompt"), "consent");
const token = await cliente.trocarCodigo({
  code: "codigo",
  verificador: "verificador",
});
assert.equal(token.refreshToken, "refresh");
assert.equal(chamadas[0].url, "https://oauth2.googleapis.com/token");
assert.equal(chamadas[0].opcoes.body.get("client_secret"), "segredo-teste");
assert.equal(chamadas[0].opcoes.body.get("code_verifier"), "verificador");
assert.equal(await cliente.obterPerfil(token.accessToken), "faturas@gmail.com");
assert.equal(chamadas[1].opcoes.headers.Authorization, "Bearer access");
escopo = "https://www.googleapis.com/auth/gmail.metadata";
await assert.rejects(
  cliente.trocarCodigo({ code: "codigo", verificador: "v" }),
  /incompleta/,
);
perfil = "";
await assert.rejects(cliente.obterPerfil("access"), /não verificada/);
assert.throws(
  () =>
    criarClienteGoogle({
      clientId: "x",
      clientSecret: "y",
      redirectUri: "http://example.com/api/admin/gmail/oauth/retorno",
    }),
  /insegura/,
);
console.log(
  "Cliente Google: parâmetros OAuth, escopo, perfil e URL HTTPS/localhost validados.",
);
