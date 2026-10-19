import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

process.env.ECOSOL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "ecosol-recuperacao-dupla-"),
);
process.env.NODE_ENV = "test";
process.env.BANCARIO_MFA_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { protegerSenha, resumoCriptografico } =
  await import("../servidor/autenticacao.mjs");
const { cifrarSegredoTotp, codigoTotp } =
  await import("../servidor/bancario/totp.mjs");
const { rotasAdministrativas } =
  await import("../servidor/rotasAdministrativas.mjs");
const banco = obterBanco();
const segredo = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const senha = "Senha forte para recuperação";
const hash = await protegerSenha(senha);

function criarPessoa(nome, nivel, papel) {
  const id = Number(
    banco
      .prepare(
        "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,?)",
      )
      .run(nome, `${nome.toLowerCase()}@teste.local`, hash, nivel)
      .lastInsertRowid,
  );
  if (papel)
    banco
      .prepare("INSERT INTO equipe_papeis_criticos(staff_id,papel) VALUES(?,?)")
      .run(id, papel);
  banco
    .prepare(
      "INSERT INTO bancario_mfa_equipe(staff_id,segredo_cifrado,ativado_em) VALUES(?,?,CURRENT_TIMESTAMP)",
    )
    .run(id, cifrarSegredoTotp(segredo, id));
  const token = randomBytes(32).toString("hex");
  banco
    .prepare(
      "INSERT INTO sessions(staff_id,token_hash,role,expires_at) VALUES(?,?,?,?)",
    )
    .run(id, resumoCriptografico(token), "staff", Date.now() + 600_000);
  return { id, token };
}

const donoA = criarPessoa("DonoA", 3, "proprietario");
const donoB = criarPessoa("DonoB", 3, "proprietario");
const guardiao = criarPessoa("Guardiao", 1, "guardiao_recuperacao");
const comum = criarPessoa("Comum", 2);
const app = express();
app.use(express.json(), rotasAdministrativas);
const servidor = app.listen(0, "127.0.0.1");
await new Promise((resolver) => servidor.once("listening", resolver));
const base = `http://127.0.0.1:${servidor.address().port}`;
process.env.APP_URL = base;

async function chamar(pessoa, rota, metodo = "GET", corpo, prova) {
  const resposta = await fetch(base + rota, {
    method: metodo,
    headers: {
      Cookie: `ecosol_session=${pessoa.token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(metodo !== "GET" ? { Origin: base } : {}),
      ...(prova ? { "X-Ecosol-Confirmacao-Bancaria": prova } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const contentType = resposta.headers.get("content-type") ?? "";
  return {
    status: resposta.status,
    dados: contentType.includes("json") ? await resposta.json() : null,
  };
}

async function confirmar(pessoa) {
  const codigo = codigoTotp(segredo, Math.floor(Date.now() / 30_000));
  const resposta = await chamar(
    pessoa,
    "/api/admin/bancario/confirmar-identidade",
    "POST",
    { senha, codigo },
  );
  assert.equal(resposta.status, 200);
  return resposta.dados.prova;
}

try {
  const pedido = await chamar(
    comum,
    "/api/admin/bancario/mfa/recuperacao/solicitar",
    "POST",
    { senha },
  );
  assert.equal(pedido.status, 201);
  const id = pedido.dados.id;
  assert.equal(
    (
      await chamar(
        comum,
        `/api/admin/bancario/mfa/recuperacoes/${id}/aprovar`,
        "POST",
        { identidade_conferida_presencialmente: true },
      )
    ).status,
    403,
  );
  const provaGuardiao = await confirmar(guardiao);
  assert.equal(
    (
      await chamar(
        guardiao,
        `/api/admin/bancario/mfa/recuperacoes/${id}/aprovar`,
        "POST",
        { identidade_conferida_presencialmente: true },
        provaGuardiao,
      )
    ).status,
    403,
  );
  const provaA = await confirmar(donoA);
  const provaB = await confirmar(donoB);
  assert.equal(
    (
      await chamar(
        donoA,
        `/api/admin/bancario/mfa/recuperacoes/${id}/aprovar`,
        "POST",
        { identidade_conferida_presencialmente: true },
        provaA,
      )
    ).dados.estado,
    "pendente",
  );
  assert.equal(
    (
      await chamar(
        comum,
        `/api/admin/bancario/mfa/recuperacao/${id}/iniciar`,
        "POST",
        { senha },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await chamar(
        donoB,
        `/api/admin/bancario/mfa/recuperacoes/${id}/aprovar`,
        "POST",
        { identidade_conferida_presencialmente: true },
        provaB,
      )
    ).dados.estado,
    "aprovado",
  );
  const inicio = await chamar(
    comum,
    `/api/admin/bancario/mfa/recuperacao/${id}/iniciar`,
    "POST",
    { senha },
  );
  assert.equal(inicio.status, 200);
  const novoCodigo = codigoTotp(
    inicio.dados.segredo,
    Math.floor(Date.now() / 30_000),
  );
  assert.equal(
    (
      await chamar(comum, "/api/admin/bancario/mfa/ativar", "POST", {
        codigo: novoCodigo,
      })
    ).status,
    200,
  );
  assert.equal(
    banco
      .prepare("SELECT estado FROM bancario_mfa_pedidos_recuperacao WHERE id=?")
      .get(id).estado,
    "consumido",
  );
  assert.equal(
    (
      await chamar(
        comum,
        `/api/admin/bancario/mfa/recuperacao/${id}/iniciar`,
        "POST",
        { senha },
      )
    ).status,
    409,
  );

  const pedidoDono = await chamar(
    donoA,
    "/api/admin/bancario/mfa/recuperacao/solicitar",
    "POST",
    { senha },
  );
  assert.equal(pedidoDono.status, 201);
  const idDono = pedidoDono.dados.id;
  assert.equal(
    (
      await chamar(
        donoA,
        `/api/admin/bancario/mfa/recuperacoes/${idDono}/aprovar`,
        "POST",
        { identidade_conferida_presencialmente: true },
        provaA,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await chamar(
        donoB,
        `/api/admin/bancario/mfa/recuperacoes/${idDono}/aprovar`,
        "POST",
        { identidade_conferida_presencialmente: true },
        provaB,
      )
    ).dados.estado,
    "pendente",
  );
  assert.equal(
    (
      await chamar(
        donoA,
        `/api/admin/bancario/mfa/recuperacao/${idDono}/iniciar`,
        "POST",
        { senha },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await chamar(
        guardiao,
        `/api/admin/bancario/mfa/recuperacoes/${idDono}/aprovar`,
        "POST",
        { identidade_conferida_presencialmente: true },
        provaGuardiao,
      )
    ).dados.estado,
    "aprovado",
  );
  assert.equal(
    (
      await chamar(
        donoA,
        `/api/admin/bancario/mfa/recuperacao/${idDono}/iniciar`,
        "POST",
        { senha },
      )
    ).status,
    200,
  );
} finally {
  servidor.close();
  banco.close();
}
console.log(
  "OK: recuperação excepcional exige dois aprovadores distintos, MFA e confirmação presencial.",
);
