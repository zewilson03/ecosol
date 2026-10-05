import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

process.env.ECOSOL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "ecosol-gmail-oauth-"),
);
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { criarRotasGmail } = await import("../servidor/gmail/rotas.mjs");
const { rotasAdministrativas } =
  await import("../servidor/rotasAdministrativas.mjs");
const { decifrarRefreshToken } =
  await import("../servidor/gmail/credenciais.mjs");
const banco = obterBanco();
const chave = Buffer.alloc(32, 7);
let agora = 100_000;
let emailGoogle = "faturas@gmail.com";
let escopoGoogle = "https://www.googleapis.com/auth/gmail.readonly";
let trocas = 0;
let trocaLentaComecou;
let liberarTrocaLenta;
const google = {
  urlDeAutorizacao({ state }) {
    return `https://accounts.google.com/test?state=${state}`;
  },
  async trocarCodigo({ code }) {
    trocas++;
    if (code === "falha") throw new Error("segredo-google-nunca-expor");
    if (code === "lento") {
      trocaLentaComecou();
      await new Promise((resolver) => {
        liberarTrocaLenta = resolver;
      });
    }
    return {
      accessToken: "acesso-secreto",
      refreshToken: `refresh-${code}`,
      escopo: escopoGoogle,
    };
  },
  async obterPerfil() {
    return emailGoogle;
  },
};
const cfg = {
  clientId: "cliente-teste",
  clientSecret: "segredo-teste",
  redirectUri: "http://localhost:3000/api/admin/gmail/oauth/retorno",
  encryptionKey: chave.toString("base64"),
};

for (const [nome, nivel] of [
  ["Avançado", 3],
  ["Básico", 1],
])
  banco
    .prepare(
      `INSERT INTO staff_users(name,email,password_hash,access_level)
    VALUES (?,?,?,?)`,
    )
    .run(nome, `${nivel}@teste.local`, "hash", nivel);
function criarSessao(staffId, token) {
  banco
    .prepare(
      `INSERT INTO sessions(staff_id,token_hash,role,expires_at)
    VALUES (?,?,?,?)`,
    )
    .run(
      staffId,
      createHash("sha256").update(token).digest("hex"),
      "staff",
      Date.now() + 60_000,
    );
  return `ecosol_session=${token}`;
}
const admin = criarSessao(1, "a".repeat(64));
const adminOutraSessao = criarSessao(1, "c".repeat(64));
const basico = criarSessao(2, "b".repeat(64));
const app = express();
app.use(
  express.json(),
  rotasAdministrativas,
  criarRotasGmail({
    banco: () => banco,
    configuracao: () => cfg,
    clienteGoogle: () => google,
    agora: () => agora,
  }),
);
const servidor = app.listen(0, "127.0.0.1");
await new Promise((resolve) => servidor.once("listening", resolve));
const base = `http://127.0.0.1:${servidor.address().port}`;
async function chamar(caminho, cookie, method = "GET", body) {
  return fetch(base + caminho, {
    method,
    redirect: "manual",
    headers: { Cookie: cookie ?? "", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function iniciar(contaId = 1, cookie = admin) {
  const resposta = await chamar(
    `/api/admin/gmail/contas/${contaId}/conectar`,
    cookie,
    "POST",
    {},
  );
  assert.equal(resposta.status, 200);
  return new URL((await resposta.json()).url).searchParams.get("state");
}
async function retornar(state, code = "ok", cookie = admin) {
  const resposta = await chamar(
    `/api/admin/gmail/oauth/retorno?state=${state}&code=${code}`,
    cookie,
  );
  return {
    status: resposta.status,
    local: resposta.headers.get("location"),
    cache: resposta.headers.get("cache-control"),
  };
}

try {
  assert.equal((await chamar("/api/admin/gmail/contas", null)).status, 401);
  assert.equal((await chamar("/api/admin/gmail/contas", basico)).status, 403);
  const cadastro = await chamar("/api/admin/gmail/contas", admin, "POST", {
    email: "Faturas@Gmail.com",
    dataInicio: "2026-10-01",
  });
  assert.equal(cadastro.status, 201);
  const conta = await cadastro.json();
  assert.equal(conta.email, "faturas@gmail.com");
  assert.equal(conta.status_autorizacao, "nao_conectada");
  assert.equal(
    (
      await chamar("/api/admin/gmail/contas/1/pausa", admin, "POST", {
        pausada: false,
      })
    ).status,
    409,
  );

  let state = await iniciar();
  assert.equal(
    (await retornar(state, "primeiro", adminOutraSessao)).local,
    "/admin/gmail?oauth=falha",
  );
  assert.equal(trocas, 0);
  assert.equal(
    (await retornar(state, "primeiro")).local,
    "/admin/gmail?oauth=conectada",
  );
  assert.equal(
    (await retornar(state, "primeiro")).local,
    "/admin/gmail?oauth=falha",
  );
  assert.equal(trocas, 1);
  let cred = banco
    .prepare("SELECT * FROM gmail_credenciais WHERE conta_id=1")
    .get();
  assert.equal(cred.email_verificado, "faturas@gmail.com");
  assert.equal(
    decifrarRefreshToken(cred.refresh_token_cifrado, 1, chave),
    "refresh-primeiro",
  );
  assert.ok(!cred.refresh_token_cifrado.includes("refresh-primeiro"));
  assert.equal(
    banco
      .prepare("SELECT status_autorizacao,pausada FROM gmail_contas WHERE id=1")
      .get().pausada,
    1,
  );
  const publico = await (await chamar("/api/admin/gmail/contas", admin)).json();
  assert.equal(publico.contas[0].identidade_verificada, "faturas@gmail.com");
  assert.ok(!JSON.stringify(publico).includes("refresh-primeiro"));

  assert.equal(
    (
      await chamar("/api/admin/gmail/contas/1/pausa", admin, "POST", {
        pausada: false,
      })
    ).status,
    200,
  );
  banco
    .prepare(
      `INSERT INTO gmail_mensagens
    (conta_id,message_id,estado,lease_token,lease_ate)
    VALUES (1,'em-captura','em_processamento','00000000-0000-4000-8000-000000000001',200000)`,
    )
    .run();
  assert.equal(
    (
      await chamar("/api/admin/gmail/contas/1/pausa", admin, "POST", {
        pausada: true,
      })
    ).status,
    200,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT estado FROM gmail_mensagens WHERE message_id='em-captura'",
      )
      .get().estado,
    "pendente",
  );
  assert.equal(
    banco
      .prepare("SELECT COUNT(*) AS n FROM gmail_auditoria WHERE conta_id=1")
      .get().n,
    3,
  );

  state = await iniciar();
  const negado = await chamar(
    `/api/admin/gmail/oauth/retorno?state=${state}&error=access_denied`,
    admin,
  );
  assert.equal(negado.headers.get("location"), "/admin/gmail?oauth=recusada");
  assert.equal((await retornar(state)).local, "/admin/gmail?oauth=falha");
  assert.equal(
    banco
      .prepare(
        "SELECT refresh_token_cifrado FROM gmail_credenciais WHERE conta_id=1",
      )
      .get().refresh_token_cifrado,
    cred.refresh_token_cifrado,
  );

  state = await iniciar();
  emailGoogle = "outra@gmail.com";
  assert.equal(
    (await retornar(state, "errada")).local,
    "/admin/gmail?oauth=falha",
  );
  emailGoogle = "faturas@gmail.com";
  assert.equal(
    decifrarRefreshToken(
      banco
        .prepare(
          "SELECT refresh_token_cifrado FROM gmail_credenciais WHERE conta_id=1",
        )
        .get().refresh_token_cifrado,
      1,
      chave,
    ),
    "refresh-primeiro",
  );

  state = await iniciar();
  escopoGoogle = "https://www.googleapis.com/auth/gmail.metadata";
  assert.equal(
    (await retornar(state, "escopo")).local,
    "/admin/gmail?oauth=falha",
  );
  escopoGoogle = "https://www.googleapis.com/auth/gmail.readonly";

  state = await iniciar();
  assert.equal(
    (await retornar(state, "falha")).local,
    "/admin/gmail?oauth=falha",
  );
  assert.equal(
    (await retornar(state, "novo")).local,
    "/admin/gmail?oauth=falha",
  );

  const antigo = await iniciar();
  const recente = await iniciar();
  assert.equal(
    (await retornar(antigo, "antigo")).local,
    "/admin/gmail?oauth=falha",
  );
  assert.equal(
    (await retornar(recente, "novo")).local,
    "/admin/gmail?oauth=conectada",
  );
  cred = banco
    .prepare("SELECT * FROM gmail_credenciais WHERE conta_id=1")
    .get();
  assert.equal(
    decifrarRefreshToken(cred.refresh_token_cifrado, 1, chave),
    "refresh-novo",
  );

  const trocaIniciada = new Promise((resolver) => {
    trocaLentaComecou = resolver;
  });
  const tentativaLenta = await iniciar();
  const retornoLento = retornar(tentativaLenta, "lento");
  await trocaIniciada;
  const tentativaMaisNova = await iniciar();
  liberarTrocaLenta();
  assert.equal((await retornoLento).local, "/admin/gmail?oauth=falha");
  assert.equal(
    (await retornar(tentativaMaisNova, "mais-novo")).local,
    "/admin/gmail?oauth=conectada",
  );
  assert.equal(
    decifrarRefreshToken(
      banco
        .prepare(
          "SELECT refresh_token_cifrado FROM gmail_credenciais WHERE conta_id=1",
        )
        .get().refresh_token_cifrado,
      1,
      chave,
    ),
    "refresh-mais-novo",
  );

  state = await iniciar();
  banco.exec(`CREATE TRIGGER falha_oauth_teste BEFORE UPDATE ON gmail_contas
    WHEN NEW.status_autorizacao='conectada' BEGIN SELECT RAISE(ABORT,'falha simulada'); END`);
  assert.equal(
    (await retornar(state, "rollback")).local,
    "/admin/gmail?oauth=falha",
  );
  banco.exec("DROP TRIGGER falha_oauth_teste");
  assert.equal(
    decifrarRefreshToken(
      banco
        .prepare(
          "SELECT refresh_token_cifrado FROM gmail_credenciais WHERE conta_id=1",
        )
        .get().refresh_token_cifrado,
      1,
      chave,
    ),
    "refresh-mais-novo",
  );

  state = await iniciar();
  agora += 10 * 60_000;
  assert.equal(
    (await retornar(state, "expirado")).local,
    "/admin/gmail?oauth=falha",
  );
  assert.equal(
    decifrarRefreshToken(
      banco
        .prepare(
          "SELECT refresh_token_cifrado FROM gmail_credenciais WHERE conta_id=1",
        )
        .get().refresh_token_cifrado,
      1,
      chave,
    ),
    "refresh-mais-novo",
  );

  state = await iniciar();
  banco
    .prepare("UPDATE sessions SET expires_at=0 WHERE token_hash=?")
    .run(createHash("sha256").update("a".repeat(64)).digest("hex"));
  assert.equal(
    (await retornar(state, "sessao")).local,
    "/admin/gmail?oauth=expirada",
  );
  assert.equal(banco.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(
    banco.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  banco.prepare("DELETE FROM staff_users WHERE id=1").run();
  assert.equal(banco.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM gmail_auditoria WHERE administrador_id=1",
      )
      .get().n > 0,
    true,
  );
  assert.equal(
    banco
      .prepare("SELECT autorizado_por FROM gmail_credenciais WHERE conta_id=1")
      .get().autorizado_por,
    1,
  );
  console.log(
    "Gmail OAuth: identidade, sigilo, replay, concorrência, rollback, sessão e exclusão de admin validados.",
  );
} finally {
  servidor.close();
  banco.close();
}
