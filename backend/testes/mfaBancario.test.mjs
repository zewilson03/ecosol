import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-mfa-"));
process.env.NODE_ENV = "test";
process.env.BANCARIO_MFA_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { protegerSenha, resumoCriptografico } =
  await import("../servidor/autenticacao.mjs");
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { codigoTotp, decifrarSegredoTotp } =
  await import("../servidor/bancario/totp.mjs");
const { rotasAdministrativas } =
  await import("../servidor/rotasAdministrativas.mjs");
const { prepararBancario } = await import("../servidor/bancario/esquema.mjs");

assert.equal(codigoTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1, 8), "94287082");

const banco = obterBanco();
const senha = "Senha forte do teste MFA";
const staffId = Number(
  banco
    .prepare(
      "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,3)",
    )
    .run("Gestor MFA", "gestor-mfa@teste.local", await protegerSenha(senha))
    .lastInsertRowid,
);
const outroId = Number(
  banco
    .prepare(
      "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,1)",
    )
    .run(
      "Outro",
      "outro@teste.local",
      await protegerSenha("Outra senha de teste"),
    ).lastInsertRowid,
);
banco
  .prepare(
    "INSERT INTO bancario_papeis_equipe(staff_id,papel,concedido_por) VALUES(?,?,?)",
  )
  .run(staffId, "administrador_integracao", outroId);
const token = randomBytes(32).toString("hex");
banco
  .prepare(
    "INSERT INTO sessions(staff_id,token_hash,role,expires_at) VALUES(?,?,?,?)",
  )
  .run(staffId, resumoCriptografico(token), "staff", Date.now() + 60_000);
const cookie = `ecosol_session=${token}`;

const app = express();
app.use(express.json(), rotasAdministrativas);
const servidor = app.listen(0, "127.0.0.1");
await new Promise((resolver) => servidor.once("listening", resolver));
const base = `http://127.0.0.1:${servidor.address().port}`;
process.env.APP_URL = base;

async function chamar(caminho, metodo = "GET", corpo, cabecalhos = {}) {
  const resposta = await fetch(base + caminho, {
    method: metodo,
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(metodo !== "GET" ? { Origin: base } : {}),
      ...cabecalhos,
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const tipo = resposta.headers.get("content-type") ?? "";
  return {
    status: resposta.status,
    dados: tipo.includes("application/json") ? await resposta.json() : null,
  };
}

try {
  const estadoInicial = await chamar("/api/admin/bancario/mfa");
  assert.equal(estadoInicial.dados.ativo, false);
  assert.equal(
    (
      await chamar("/api/admin/bancario/confirmar-identidade", "POST", {
        senha,
      })
    ).status,
    428,
  );
  assert.equal(
    (
      await chamar("/api/admin/bancario/mfa/iniciar", "POST", {
        senha: "errada",
      })
    ).status,
    401,
  );
  const chaveOriginal = process.env.BANCARIO_MFA_ENCRYPTION_KEY;
  delete process.env.BANCARIO_MFA_ENCRYPTION_KEY;
  assert.equal(
    (await chamar("/api/admin/bancario/mfa/iniciar", "POST", { senha })).status,
    503,
  );
  process.env.BANCARIO_MFA_ENCRYPTION_KEY = chaveOriginal;
  const semOrigem = await chamar(
    "/api/admin/bancario/mfa/iniciar",
    "POST",
    { senha },
    { Origin: "https://outro.example" },
  );
  assert.equal(semOrigem.status, 403);

  const inicio = await chamar("/api/admin/bancario/mfa/iniciar", "POST", {
    senha,
  });
  assert.equal(inicio.status, 200);
  assert.match(inicio.dados.segredo, /^[A-Z2-7]{32}$/);
  const persistido = banco
    .prepare(
      "SELECT pendente_cifrado FROM bancario_mfa_equipe WHERE staff_id=?",
    )
    .get(staffId).pendente_cifrado;
  assert.equal(persistido.includes(inicio.dados.segredo), false);
  assert.equal(decifrarSegredoTotp(persistido, staffId), inicio.dados.segredo);
  assert.throws(() => decifrarSegredoTotp(persistido, outroId));

  assert.equal(
    (
      await chamar("/api/admin/bancario/mfa/ativar", "POST", {
        codigo: "000000",
      })
    ).status,
    400,
  );
  const contador = Math.floor(Date.now() / 30_000);
  const codigoAtual = codigoTotp(inicio.dados.segredo, contador);
  const segundoToken = randomBytes(32).toString("hex");
  banco
    .prepare(
      "INSERT INTO sessions(staff_id,token_hash,role,expires_at) VALUES(?,?,?,?)",
    )
    .run(
      staffId,
      resumoCriptografico(segundoToken),
      "staff",
      Date.now() + 60_000,
    );
  const outraSessao = await fetch(base + "/api/admin/bancario/mfa/ativar", {
    method: "POST",
    headers: {
      Cookie: `ecosol_session=${segundoToken}`,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ codigo: codigoAtual }),
  });
  assert.equal(outraSessao.status, 409);
  const ativacao = await chamar("/api/admin/bancario/mfa/ativar", "POST", {
    codigo: codigoAtual,
  });
  assert.equal(ativacao.status, 200);
  assert.equal(ativacao.dados.codigos_recuperacao.length, 10);
  prepararBancario(banco);
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) AS total FROM bancario_mfa_recuperacao WHERE staff_id=?",
      )
      .get(staffId).total,
    10,
  );
  assert.equal(
    banco
      .prepare("SELECT 1 FROM bancario_mfa_recuperacao WHERE codigo_hash=?")
      .get(ativacao.dados.codigos_recuperacao[0]),
    undefined,
  );
  assert.equal(
    (await chamar("/api/admin/bancario/mfa")).dados
      .codigos_recuperacao_restantes,
    10,
  );

  // O código utilizado na ativação não pode ser reutilizado.
  assert.equal(
    (
      await chamar("/api/admin/bancario/confirmar-identidade", "POST", {
        senha,
        codigo: codigoAtual,
      })
    ).status,
    401,
  );
  const recuperacao = ativacao.dados.codigos_recuperacao[0];
  const confirmado = await chamar(
    "/api/admin/bancario/confirmar-identidade",
    "POST",
    { senha, codigo: recuperacao },
  );
  assert.equal(confirmado.status, 200);
  assert.match(confirmado.dados.prova, /^[a-f0-9]{64}$/);
  assert.equal(
    (await chamar("/api/admin/bancario/mfa")).dados
      .codigos_recuperacao_restantes,
    9,
  );

  const caminhoPapel = `/api/admin/bancario/permissoes/${outroId}/consulta_auditoria`;
  assert.equal((await chamar(caminhoPapel, "PUT")).status, 403);
  assert.equal(
    (
      await chamar(caminhoPapel, "PUT", undefined, {
        "X-Ecosol-Confirmacao-Bancaria": confirmado.dados.prova,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await chamar("/api/admin/bancario/confirmar-identidade", "POST", {
        senha,
        codigo: recuperacao,
      })
    ).status,
    401,
  );

  const proximoCodigo = codigoTotp(inicio.dados.segredo, contador + 1);
  assert.equal(
    (
      await chamar("/api/admin/bancario/confirmar-identidade", "POST", {
        senha,
        codigo: proximoCodigo,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await chamar("/api/admin/bancario/confirmar-identidade", "POST", {
        senha,
        codigo: proximoCodigo,
      })
    ).status,
    401,
  );
  const troca = await chamar("/api/admin/bancario/mfa/substituir", "POST", {
    senha,
    codigo_recuperacao: ativacao.dados.codigos_recuperacao[1],
  });
  assert.equal(troca.status, 200);
  assert.notEqual(troca.dados.segredo, inicio.dados.segredo);
  assert.equal((await chamar("/api/admin/bancario/mfa")).dados.ativo, true);
  assert.equal(
    (
      await chamar("/api/admin/bancario/mfa/ativar", "POST", {
        codigo: "000000",
      })
    ).status,
    400,
  );
  const codigoNovo = codigoTotp(
    troca.dados.segredo,
    Math.floor(Date.now() / 30_000),
  );
  const substituicao = await chamar("/api/admin/bancario/mfa/ativar", "POST", {
    codigo: codigoNovo,
  });
  assert.equal(substituicao.status, 200);
  assert.equal(substituicao.dados.codigos_recuperacao.length, 10);
  assert.equal(
    (
      await chamar(caminhoPapel, "DELETE", undefined, {
        "X-Ecosol-Confirmacao-Bancaria": confirmado.dados.prova,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await chamar("/api/admin/bancario/confirmar-identidade", "POST", {
        senha,
        codigo: ativacao.dados.codigos_recuperacao[2],
      })
    ).status,
    401,
  );
  const confirmacaoNova = await chamar(
    "/api/admin/bancario/confirmar-identidade",
    "POST",
    { senha, codigo: substituicao.dados.codigos_recuperacao[0] },
  );
  assert.equal(confirmacaoNova.status, 200);
  for (let tentativa = 0; tentativa < 5; tentativa++)
    assert.equal(
      (
        await chamar("/api/admin/bancario/confirmar-identidade", "POST", {
          senha: "incorreta",
          codigo: "000000",
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await chamar("/api/admin/bancario/confirmar-identidade", "POST", {
        senha,
        codigo: substituicao.dados.codigos_recuperacao[1],
      })
    ).status,
    429,
  );
  banco
    .prepare("UPDATE staff_users SET password_hash=? WHERE id=?")
    .run(await protegerSenha("Senha nova do teste MFA"), staffId);
  assert.equal(
    (
      await chamar(caminhoPapel, "DELETE", undefined, {
        "X-Ecosol-Confirmacao-Bancaria": confirmacaoNova.dados.prova,
      })
    ).status,
    403,
  );
  banco
    .prepare("UPDATE sessions SET expires_at=0 WHERE staff_id=?")
    .run(staffId);
  assert.equal(
    (
      await chamar(caminhoPapel, "DELETE", undefined, {
        "X-Ecosol-Confirmacao-Bancaria": confirmado.dados.prova,
      })
    ).status,
    401,
  );
  console.log(
    "OK: MFA bancário, ativação, cifragem, recuperação e bloqueio de replay.",
  );
} finally {
  await new Promise((resolver) => servidor.close(resolver));
  banco.close();
}
