import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-bancario-"));
process.env.NODE_ENV = "test";
process.env.BANCARIO_EXECUTOR_MODO = "simulado";
process.env.SICOOB_AMBIENTE = "homologacao";
process.env.BANCARIO_MFA_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { resumoCriptografico, protegerSenha } =
  await import("../servidor/autenticacao.mjs");
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { exigirPapelBancario } =
  await import("../servidor/bancario/permissoes.mjs");
const { rotasAdministrativas } =
  await import("../servidor/rotasAdministrativas.mjs");
const { gerarSegredoTotp, cifrarSegredoTotp, codigoTotp } =
  await import("../servidor/bancario/totp.mjs");

const banco = obterBanco();
const senhaDeTeste = "Senha bancaria de teste 2026";
const hashDeTeste = await protegerSenha(senhaDeTeste);
const pessoas = {};
const segredos = {};
for (const [chave, nivel] of [
  ["auditor", 1],
  ["operador", 2],
  ["gestorA", 3],
  ["gestorB", 3],
  ["aprovador", 3],
]) {
  pessoas[chave] = Number(
    banco
      .prepare(
        "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,?)",
      )
      .run(chave, `${chave}@teste.local`, hashDeTeste, nivel).lastInsertRowid,
  );
  const segredo = gerarSegredoTotp();
  segredos[chave] = segredo;
  banco
    .prepare(
      "INSERT INTO bancario_mfa_equipe(staff_id,segredo_cifrado,ativado_em) VALUES(?,?,CURRENT_TIMESTAMP)",
    )
    .run(pessoas[chave], cifrarSegredoTotp(segredo, pessoas[chave]));
}

const cookies = {};
const segredosPorCookie = new Map();
for (const [chave, id] of Object.entries(pessoas)) {
  const token = randomBytes(32).toString("hex");
  banco
    .prepare(
      "INSERT INTO sessions(staff_id,token_hash,role,expires_at) VALUES(?,?,?,?)",
    )
    .run(id, resumoCriptografico(token), "staff", Date.now() + 60_000);
  cookies[chave] = `ecosol_session=${token}`;
  segredosPorCookie.set(cookies[chave], segredos[chave]);
}

const aplicacao = express();
aplicacao.use(express.json(), rotasAdministrativas);
const servidor = aplicacao.listen(0, "127.0.0.1");
await new Promise((resolver) => servidor.once("listening", resolver));
const base = `http://127.0.0.1:${servidor.address().port}`;
process.env.APP_URL = base;
const confirmacoes = new Map();

async function chamar(caminho, cookie, metodo = "GET", corpo) {
  if (
    metodo !== "GET" &&
    caminho.startsWith("/api/admin/bancario/") &&
    cookie
  ) {
    if (!confirmacoes.has(cookie)) {
      const confirmacao = await fetch(
        base + "/api/admin/bancario/confirmar-identidade",
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: base,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            senha: senhaDeTeste,
            codigo: codigoTotp(
              segredosPorCookie.get(cookie),
              Math.floor(Date.now() / 30_000),
            ),
          }),
        },
      );
      assert.equal(confirmacao.status, 200);
      confirmacoes.set(cookie, (await confirmacao.json()).prova);
    }
  }
  return fetch(base + caminho, {
    method: metodo,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(metodo !== "GET" ? { Origin: base } : {}),
      ...(confirmacoes.has(cookie)
        ? { "X-Ecosol-Confirmacao-Bancaria": confirmacoes.get(cookie) }
        : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
}

function rotaPapel(id, papel) {
  return `/api/admin/bancario/permissoes/${id}/${papel}`;
}

try {
  const rotaProtegida = rotaPapel(pessoas.operador, "operador_financeiro");
  const semConfirmacao = await fetch(base + rotaProtegida, {
    method: "PUT",
    headers: { Cookie: cookies.gestorA, Origin: base },
  });
  assert.equal(semConfirmacao.status, 403);
  assert.equal(
    (
      await chamar(
        "/api/admin/bancario/confirmar-identidade",
        cookies.gestorA,
        "GET",
      )
    ).status,
    404,
  );
  const origemEstranha = await fetch(
    base + "/api/admin/bancario/confirmar-identidade",
    {
      method: "POST",
      headers: {
        Cookie: cookies.gestorA,
        Origin: "https://outro.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ senha: senhaDeTeste }),
    },
  );
  assert.equal(origemEstranha.status, 403);
  const senhaErrada = await fetch(
    base + "/api/admin/bancario/confirmar-identidade",
    {
      method: "POST",
      headers: {
        Cookie: cookies.gestorA,
        Origin: base,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ senha: "incorreta" }),
    },
  );
  assert.equal(senhaErrada.status, 401);
  const tokenFalso = await fetch(base + rotaProtegida, {
    method: "PUT",
    headers: {
      Cookie: cookies.gestorA,
      Origin: base,
      "X-Ecosol-Confirmacao-Bancaria": "0".repeat(64),
    },
  });
  assert.equal(tokenFalso.status, 403);
  assert.equal(
    banco.prepare("SELECT COUNT(*) AS n FROM bancario_papeis_equipe").get().n,
    0,
  );
  assert.equal(
    (await chamar("/api/admin/bancario/permissoes", cookies.operador)).status,
    403,
  );

  const inicial = await (
    await chamar("/api/admin/bancario/permissoes", cookies.gestorA)
  ).json();
  assert.equal(inicial.pode_gerenciar, true);
  assert.equal(inicial.papeis.length, 4);

  assert.equal(
    (
      await chamar(
        rotaPapel(pessoas.gestorA, "administrador_integracao"),
        cookies.gestorA,
        "PUT",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await chamar(
        rotaPapel(pessoas.auditor, "operador_financeiro"),
        cookies.gestorA,
        "PUT",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await chamar(
        rotaPapel(pessoas.operador, "operador_financeiro"),
        cookies.gestorA,
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await chamar(
        rotaPapel(pessoas.gestorB, "administrador_integracao"),
        cookies.gestorA,
        "PUT",
      )
    ).status,
    200,
  );

  assert.equal(
    (await chamar("/api/admin/bancario/executor", cookies.operador)).status,
    403,
  );
  const executorInicial = await (
    await chamar("/api/admin/bancario/executor", cookies.gestorB)
  ).json();
  assert.equal(executorInicial.pausado, true);
  const executorRetomado = await (
    await chamar("/api/admin/bancario/executor", cookies.gestorB, "PATCH", {
      pausado: false,
    })
  ).json();
  assert.equal(executorRetomado.pausado, false);
  const executorPausado = await (
    await chamar("/api/admin/bancario/executor", cookies.gestorB, "PATCH", {
      pausado: true,
    })
  ).json();
  assert.equal(executorPausado.pausado, true);
  process.env.BANCARIO_EXECUTOR_MODO = "desligado";
  assert.equal(
    (
      await chamar("/api/admin/bancario/executor", cookies.gestorB, "PATCH", {
        pausado: false,
      })
    ).status,
    409,
  );
  process.env.BANCARIO_EXECUTOR_MODO = "simulado";
  assert.equal(
    banco.prepare("SELECT COUNT(*) AS n FROM bancario_auditoria_executor").get()
      .n,
    2,
  );

  const aposBootstrap = await (
    await chamar("/api/admin/bancario/permissoes", cookies.gestorA)
  ).json();
  assert.equal(aposBootstrap.pode_gerenciar, false);
  assert.equal(
    (
      await chamar(
        rotaPapel(pessoas.auditor, "consulta_auditoria"),
        cookies.gestorA,
        "PUT",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await chamar(
        rotaPapel(pessoas.auditor, "consulta_auditoria"),
        cookies.gestorB,
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await chamar(
        rotaPapel(pessoas.aprovador, "aprovador_financeiro"),
        cookies.gestorB,
        "PUT",
      )
    ).status,
    200,
  );

  assert.equal(
    (
      await chamar(
        `/api/admin/administradores/${pessoas.operador}/nivel`,
        cookies.gestorA,
        "PATCH",
        { nivel: 1 },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await chamar(
        `/api/admin/administradores/${pessoas.gestorB}`,
        cookies.gestorA,
        "DELETE",
      )
    ).status,
    409,
  );

  let proximoFoiChamado = false;
  const respostaNegada = {
    statusCode: 200,
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    json() {
      return this;
    },
  };
  exigirPapelBancario("aprovador_financeiro")(
    { administrador: { id: pessoas.operador } },
    respostaNegada,
    () => {
      proximoFoiChamado = true;
    },
  );
  assert.equal(respostaNegada.statusCode, 403);
  assert.equal(proximoFoiChamado, false);
  exigirPapelBancario("aprovador_financeiro")(
    { administrador: { id: pessoas.aprovador } },
    respostaNegada,
    () => {
      proximoFoiChamado = true;
    },
  );
  assert.equal(proximoFoiChamado, true);

  assert.equal(
    banco
      .prepare("SELECT COUNT(*) AS n FROM bancario_auditoria_permissoes")
      .get().n,
    4,
  );
  banco
    .prepare("UPDATE sessions SET expires_at=0 WHERE staff_id=?")
    .run(pessoas.gestorA);
  const sessaoExpirada = await fetch(base + rotaProtegida, {
    method: "PUT",
    headers: {
      Cookie: cookies.gestorA,
      Origin: base,
      "X-Ecosol-Confirmacao-Bancaria": confirmacoes.get(cookies.gestorA),
    },
  });
  assert.equal(sessaoExpirada.status, 401);
  console.log(
    "OK: permissões bancárias negadas por padrão, delegação nominal, segregação e auditoria.",
  );
} finally {
  await new Promise((resolver) => servidor.close(resolver));
  banco.close();
}
