import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-hashes-"));

const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { protegerSenha, senhaConfere, hashPrecisaAtualizar } =
  await import("../servidor/autenticacao.mjs");

const senha = "Senha longa de teste 123";
const primeiroHash = await protegerSenha(senha);
const segundoHash = await protegerSenha(senha);
assert.match(primeiroHash, /^scrypt\$v2\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
assert.notEqual(primeiroHash, segundoHash);
assert.equal(await senhaConfere(senha, primeiroHash), true);
assert.equal(await senhaConfere("senha incorreta", primeiroHash), false);
assert.equal(await senhaConfere(senha, "formato inválido"), false);
assert.equal(hashPrecisaAtualizar(primeiroHash), false);

const salAntigo = randomBytes(16).toString("hex");
const hashAntigo = `${salAntigo}:${scryptSync(senha, salAntigo, 64).toString("hex")}`;
assert.equal(await senhaConfere(senha, hashAntigo), true);
assert.equal(hashPrecisaAtualizar(hashAntigo), true);

const banco = obterBanco();
try {
  banco
    .prepare(
      "INSERT INTO customers (name, cpf, email, password_hash) VALUES (?, ?, ?, ?)",
    )
    .run("Cliente teste", "52998224725", "cliente@teste.local", primeiroHash);
  banco
    .prepare(
      "INSERT INTO staff_users (name, email, password_hash, access_level) VALUES (?, ?, ?, ?)",
    )
    .run("Administrador teste", "admin@teste.local", segundoHash, 3);

  await import("../scripts/exportar-dados.mjs");
  const pasta = join(process.env.ECOSOL_DATA_DIR, "consultas");
  const clientes = JSON.parse(
    readFileSync(join(pasta, "clientes.json"), "utf8"),
  );
  const administradores = JSON.parse(
    readFileSync(join(pasta, "administradores.json"), "utf8"),
  );
  assert.equal(clientes[0].senha_hash, primeiroHash);
  assert.equal(administradores[0].senha_hash, segundoHash);
  const exportados = JSON.stringify({ clientes, administradores });
  assert.equal(exportados.includes(senha), false);
  assert.equal(exportados.includes("token_hash"), false);
  assert.equal(exportados.includes("sessions"), false);
  console.log(
    "OK: hashes com sal, formato antigo compatível e JSON sem senhas em texto.",
  );
} finally {
  banco.close();
}
