import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { request as requisicaoHttp } from "node:http";
import express from "express";
import { protecaoHttp, tratarErroHttp } from "../servidor/segurancaHttp.mjs";

// Configuração fictícia isolada; nunca lê/altera .env.local ou banco reais.
const pasta = mkdtempSync(join(tmpdir(), "ecosol-seguranca-"));
mkdirSync(join(pasta, "servidor"));
copyFileSync(
  new URL("../servidor/configuracao.mjs", import.meta.url),
  join(pasta, "servidor/configuracao.mjs"),
);
writeFileSync(join(pasta, ".env.local"), "NODE_ENV=production\n");
writeFileSync(
  join(pasta, "servidor/leitura.mjs"),
  "export const modo = process.env.NODE_ENV;",
);
writeFileSync(
  join(pasta, "servidor/iniciar.mjs"),
  'import "./configuracao.mjs"; import { modo } from "./leitura.mjs"; if (modo !== "production") process.exit(1);',
);
const ambiente = { ...process.env };
delete ambiente.NODE_ENV;
const filho = spawnSync(
  process.execPath,
  [join(pasta, "servidor/iniciar.mjs")],
  { env: ambiente, encoding: "utf8" },
);
assert.equal(filho.status, 0, filho.stderr);

process.env.ECOSOL_DATA_DIR = pasta;
process.env.NODE_ENV = "development";
const { rotas } = await import("../servidor/rotasDaAplicacao.mjs");
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { resumoCriptografico, senhaConfere } =
  await import("../servidor/autenticacao.mjs");
const banco = obterBanco();
const app = express();
app.use(protecaoHttp("http://localhost:3000"));
app.use(express.json({ limit: "1kb" }));
app.post("/teste", (_req, res) => res.json({ ok: true }));
app.get("/api/falha", () => {
  throw new Error("segredo-nao-pode-aparecer");
});
app.use(rotas, tratarErroHttp);
const servidor = app.listen(0, "127.0.0.1");
await new Promise((resolve) => servidor.once("listening", resolve));
const base = `http://127.0.0.1:${servidor.address().port}`;
async function post(url, dados, headers = {}) {
  return fetch(base + url, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(dados),
  });
}
function postComHost(url, headers) {
  return new Promise((resolve, reject) => {
    const requisicao = requisicaoHttp(
      base + url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
      },
      (resposta) => {
        resposta.resume();
        resposta.on("end", () =>
          resolve({
            status: resposta.statusCode,
            destino: resposta.headers.location,
          }),
        );
      },
    );
    requisicao.on("error", reject);
    requisicao.end("{}");
  });
}
try {
  for (const origin of ["malformada", "https://outro.example"]) {
    assert.equal((await post("/teste", {}, { Origin: origin })).status, 403);
  }
  assert.equal((await post("/teste", {}, { Origin: "null" })).status, 403);
  assert.equal(
    (
      await post(
        "/teste",
        {},
        { Origin: "null", "Sec-Fetch-Site": "cross-site" },
      )
    ).status,
    403,
  );
  const cabecalhosNavegador = {
    Host: "localhost:3000",
    Origin: "null",
    "Sec-Fetch-Site": "same-origin",
  };
  assert.equal((await postComHost("/teste", cabecalhosNavegador)).status, 200);
  assert.deepEqual(
    await postComHost("/api/equipe/login", cabecalhosNavegador),
    { status: 303, destino: "/equipe?status=erro" },
  );
  assert.deepEqual(await postComHost("/api/sair", cabecalhosNavegador), {
    status: 303,
    destino: "/",
  });
  assert.equal(
    (
      await post(
        "/teste",
        {},
        { Origin: "null", "Sec-Fetch-Site": "same-origin" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await post("/teste", {}, { Origin: "http://localhost:3000" })).status,
    200,
  );
  assert.equal(
    (await post("/teste", {}, { "Sec-Fetch-Site": "cross-site" })).status,
    403,
  );
  assert.equal((await post("/teste", {})).status, 200); // Clientes não navegador continuam compatíveis.
  assert.equal((await post("/teste", { texto: "x".repeat(2000) })).status, 413);
  assert.equal(
    (
      await fetch(base + "/teste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      })
    ).status,
    400,
  );
  const anonimo = await fetch(base + "/api/dev/links");
  assert.equal(anonimo.status, 401);
  assert.equal(anonimo.headers.get("cache-control"), "no-store");
  assert.equal(anonimo.headers.get("referrer-policy"), "no-referrer");
  assert.equal(anonimo.headers.get("x-frame-options"), "SAMEORIGIN");
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  try {
    const falha = await fetch(base + "/api/falha");
    assert.equal(falha.status, 500);
    assert.ok(!(await falha.text()).includes("segredo-nao-pode-aparecer"));
    assert.ok(!logs.join().includes("segredo-nao-pode-aparecer"));
    assert.equal(logs.length, 1);
  } finally {
    console.error = original;
  }

  const cliente = Number(
    banco
      .prepare("INSERT INTO customers(name,cpf,email) VALUES (?,?,?)")
      .run("Teste", "00000000000", "teste@example.invalid").lastInsertRowid,
  );
  const token = "a".repeat(64);
  banco
    .prepare(
      "INSERT INTO auth_tokens(customer_id,token_hash,purpose,expires_at) VALUES (?,?,?,?)",
    )
    .run(cliente, resumoCriptografico(token), "reset", Date.now() + 60000);
  banco
    .prepare(
      "INSERT INTO sessions(customer_id,token_hash,role,expires_at) VALUES (?,?,?,?)",
    )
    .run(cliente, "sessao-teste", "customer", Date.now() + 60000);
  const senhas = ["Senha teste A 123", "Senha teste B 456"];
  const respostas = await Promise.all(
    senhas.map((password) =>
      post("/api/acesso/definir-senha", { token, password, confirm: password }),
    ),
  );
  const vitorias = respostas.map(
    (r) => r.headers.get("location") === "/entrar?status=senha-definida",
  );
  assert.equal(vitorias.filter(Boolean).length, 1);
  const salvo = banco
    .prepare("SELECT password_hash FROM customers WHERE id=?")
    .get(cliente).password_hash;
  assert.ok(await senhaConfere(senhas[vitorias.indexOf(true)], salvo));
  assert.equal(
    banco
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE customer_id=?")
      .get(cliente).n,
    0,
  );
  assert.equal(
    (
      await post("/api/acesso/definir-senha", {
        token,
        password: senhas[0],
        confirm: senhas[0],
      })
    ).headers.get("location"),
    "/acesso?status=expirado",
  );

  const tokenFalha = "b".repeat(64);
  banco
    .prepare(
      "INSERT INTO auth_tokens(customer_id,token_hash,purpose,expires_at) VALUES (?,?,?,?)",
    )
    .run(cliente, resumoCriptografico(tokenFalha), "reset", Date.now() + 60000);
  banco.exec(
    "CREATE TRIGGER falha_senha BEFORE UPDATE OF password_hash ON customers BEGIN SELECT RAISE(ABORT, 'falha simulada'); END",
  );
  const rollback = await post("/api/acesso/definir-senha", {
    token: tokenFalha,
    password: senhas[0],
    confirm: senhas[0],
  });
  assert.equal(rollback.status, 500);
  assert.equal(
    banco
      .prepare("SELECT used_at FROM auth_tokens WHERE token_hash=?")
      .get(resumoCriptografico(tokenFalha)).used_at,
    null,
  );
  assert.equal(
    banco.prepare("SELECT password_hash FROM customers WHERE id=?").get(cliente)
      .password_hash,
    salvo,
  );
  console.log(
    "OK: configuração antecipada, proteção HTTP, links restritos, reset concorrente e rollback.",
  );
} finally {
  servidor.closeAllConnections();
  await new Promise((resolve) => servidor.close(resolve));
  banco.close();
}
