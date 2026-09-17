import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

process.env.ECOSOL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "ecosol-primeiro-admin-"),
);
process.env.NODE_ENV = "production";
process.env.ADMIN_PASSWORD = "Senha inicial de teste";

const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { rotas } = await import("../servidor/rotasDaAplicacao.mjs");
const { rotasAdministrativas } =
  await import("../servidor/rotasAdministrativas.mjs");
const banco = obterBanco();
const aplicacao = express();
aplicacao.use(
  express.json(),
  express.urlencoded({ extended: false }),
  rotas,
  rotasAdministrativas,
);
const servidor = aplicacao.listen(0, "127.0.0.1");
await new Promise((resolver) => servidor.once("listening", resolver));
const base = "http://127.0.0.1:" + servidor.address().port;

async function chamar(caminho, cookie, dados) {
  return fetch(base + caminho, {
    method: dados ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(dados ? { body: JSON.stringify(dados) } : {}),
  });
}

try {
  const entrada = await chamar("/api/equipe/entrada-inicial", null, {
    password: process.env.ADMIN_PASSWORD,
  });
  assert.equal(entrada.status, 200);
  const cookieInicial = entrada.headers.get("set-cookie").split(";")[0];
  const sessaoInicial = await (
    await chamar("/api/sessao", cookieInicial)
  ).json();
  assert.equal(sessaoInicial.administrador.id, null);

  const dados = {
    name: "Primeiro administrador",
    email: "primeiro@teste.local",
    password: "Senha individual 123",
  };
  assert.equal(
    (
      await chamar("/api/equipe/administradores", cookieInicial, {
        ...dados,
        nivel: 1,
      })
    ).status,
    400,
  );
  const criado = await chamar("/api/equipe/administradores", cookieInicial, {
    ...dados,
    nivel: 3,
  });
  assert.equal(criado.status, 200);
  const cookieIndividual = criado.headers.get("set-cookie").split(";")[0];
  const sessaoIndividual = await (
    await chamar("/api/sessao", cookieIndividual)
  ).json();
  assert.equal(sessaoIndividual.administrador.nivel, 3);
  assert.ok(sessaoIndividual.administrador.id > 0);
  assert.equal(
    (await (await chamar("/api/sessao", cookieInicial)).json()).perfil,
    null,
  );
  assert.equal(
    (
      await chamar("/api/equipe/entrada-inicial", null, {
        password: process.env.ADMIN_PASSWORD,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await chamar("/api/equipe/administradores", cookieIndividual, {
        name: "Equipe básica",
        email: "basico@teste.local",
        password: "Outra senha 123",
        nivel: 1,
      })
    ).status,
    200,
  );
  assert.equal(
    banco.prepare("SELECT COUNT(*) AS total FROM staff_users").get().total,
    2,
  );
  console.log(
    "OK: primeiro administrador em produção e encerramento do acesso inicial.",
  );
} finally {
  await new Promise((resolver) => servidor.close(resolver));
  banco.close();
}
