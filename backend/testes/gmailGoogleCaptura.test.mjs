import assert from "node:assert/strict";
import {
  criarClienteGoogle,
  ErroGoogleGmail,
  instanteInicial,
} from "../servidor/gmail/google.mjs";

const chamadas = [];
let responder = () => new Response("{}");
const cliente = criarClienteGoogle(
  {
    clientId: "cliente-teste",
    clientSecret: "segredo-teste",
    redirectUri: "http://localhost:3000/api/admin/gmail/oauth/retorno",
  },
  async (url, opcoes) => {
    chamadas.push({ url: String(url), opcoes });
    return responder();
  },
);

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

responder = () =>
  json({ access_token: "acesso", token_type: "Bearer", expires_in: 3600 });
assert.deepEqual(await cliente.renovarAcesso({ refreshToken: "refresh" }), {
  accessToken: "acesso",
  expiresIn: 3600,
});
assert.equal(chamadas.at(-1).url, "https://oauth2.googleapis.com/token");
assert.equal(chamadas.at(-1).opcoes.body.get("grant_type"), "refresh_token");
responder = () => json({ error: "invalid_grant" }, 400);
await assert.rejects(
  cliente.renovarAcesso({ refreshToken: "invalido" }),
  (erro) => erro instanceof ErroGoogleGmail && erro.categoria === "autorizacao",
);

responder = () => json({ emailAddress: "Faturas@Gmail.com", historyId: "100" });
assert.deepEqual(await cliente.obterPerfilCompleto("acesso"), {
  email: "faturas@gmail.com",
  historyId: "100",
});

responder = () => json({ messages: [{ id: "m1" }], nextPageToken: "p2" });
assert.deepEqual(
  await cliente.listarMensagens({
    accessToken: "acesso",
    dataInicial: "2026-10-01",
  }),
  { mensagens: [{ id: "m1" }], proximaPagina: "p2" },
);
const busca = new URL(chamadas.at(-1).url);
assert.equal(
  busca.searchParams.get("q"),
  `after:${instanteInicial("2026-10-01") - 1}`,
);
assert.equal(busca.searchParams.get("includeSpamTrash"), "false");
assert.equal(chamadas.at(-1).opcoes.headers.Authorization, "Bearer acesso");
assert.throws(() => instanteInicial("2026-02-30"), /inválida/);

responder = () =>
  json({
    historyId: "102",
    history: [
      { messagesAdded: [{ message: { id: "m2" } }, { message: { id: "m2" } }] },
    ],
  });
assert.deepEqual(
  await cliente.listarHistorico({
    accessToken: "acesso",
    historyId: "100",
  }),
  { mensagens: [{ id: "m2" }], historyId: "102", proximaPagina: null },
);
responder = () => json({ historyId: "102", history: [] }, 404);
await assert.rejects(
  cliente.listarHistorico({ accessToken: "acesso", historyId: "100" }),
  (erro) =>
    erro instanceof ErroGoogleGmail && erro.categoria === "historico_expirado",
);

responder = () =>
  json({ id: "m2", internalDate: "1790880000000", payload: {} });
assert.equal(
  (await cliente.obterMensagem({ accessToken: "acesso", id: "m2" })).id,
  "m2",
);
responder = () =>
  json({ size: 9, data: Buffer.from("%PDF-1.4\n").toString("base64url") });
assert.equal(
  (
    await cliente.obterAnexo({
      accessToken: "acesso",
      mensagemId: "m2",
      anexoId: "a1",
    })
  ).size,
  9,
);
responder = () => json({ size: 1, data: "!!" });
await assert.rejects(
  cliente.obterAnexo({
    accessToken: "acesso",
    mensagemId: "m2",
    anexoId: "a1",
  }),
  (erro) =>
    erro instanceof ErroGoogleGmail && erro.categoria === "resposta_invalida",
);
responder = () => json({ error: "quota" }, 429);
await assert.rejects(
  cliente.listarMensagens({ accessToken: "acesso", dataInicial: "2026-10-01" }),
  (erro) => erro instanceof ErroGoogleGmail && erro.categoria === "limite",
);
responder = () =>
  json({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, 403);
await assert.rejects(
  cliente.listarMensagens({ accessToken: "acesso", dataInicial: "2026-10-01" }),
  (erro) => erro instanceof ErroGoogleGmail && erro.categoria === "limite",
);
responder = () =>
  json({ error: { errors: [{ reason: "insufficientPermissions" }] } }, 403);
await assert.rejects(
  cliente.listarMensagens({ accessToken: "acesso", dataInicial: "2026-10-01" }),
  (erro) => erro instanceof ErroGoogleGmail && erro.categoria === "permissao",
);

console.log(
  "Cliente Gmail: refresh, fuso, páginas, histórico e anexos validados.",
);
