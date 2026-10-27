import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-readiness-"));
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { criarRotasSaude } = await import("../servidor/saude.mjs");
const banco = obterBanco();
const aplicacao = express();
aplicacao.use(
  criarRotasSaude({
    protegerProntidao: (_req, _res, proximo) => proximo(),
  }),
);
const servidor = aplicacao.listen(0, "127.0.0.1");
await new Promise((resolver) => servidor.once("listening", resolver));
const url = `http://127.0.0.1:${servidor.address().port}/api/admin/saude/prontidao`;
try {
  let resposta = await fetch(url);
  assert.equal(resposta.status, 503);
  assert.equal((await resposta.json()).administradores_configurados, false);

  banco
    .prepare(
      "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,3)",
    )
    .run("Administrador", "admin@teste.local", "hash");
  resposta = await fetch(url);
  assert.equal(resposta.status, 200);
  const corpo = await resposta.json();
  assert.equal(corpo.status, "pronto");
  assert.equal(corpo.migracoes.integra, true);
  assert.deepEqual(corpo.filas, {
    bancario_envio_pendente: 0,
    bancario_resultado_desconhecido: 0,
    gmail_pendentes: 0,
  });
} finally {
  await new Promise((resolver) => servidor.close(resolver));
  banco.close();
}

console.log("OK: readiness exige migração íntegra e administrador nominal.");
