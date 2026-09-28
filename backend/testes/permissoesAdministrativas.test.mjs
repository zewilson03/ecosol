import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import express from "express";

// Todos os registros deste teste ficam em um banco temporário.
process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-permissoes-"));
process.env.NODE_ENV = "development";
process.env.ADMIN_PASSWORD = "Senha inicial de teste";

const antigo = new DatabaseSync(join(process.env.ECOSOL_DATA_DIR, "ecosol.db"));
antigo.exec(
  "CREATE TABLE staff_users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, cpf TEXT UNIQUE, email TEXT UNIQUE, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
);
antigo
  .prepare(
    "INSERT INTO staff_users (name, email, password_hash) VALUES (?, ?, ?)",
  )
  .run("Conta antiga", "antiga@teste.local", "hash-antigo");
antigo.close();

const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { protegerSenha } = await import("../servidor/autenticacao.mjs");
const { rotas } = await import("../servidor/rotasDaAplicacao.mjs");
const { rotasAdministrativas } =
  await import("../servidor/rotasAdministrativas.mjs");
const banco = obterBanco();
assert.equal(
  banco
    .prepare("SELECT access_level FROM staff_users WHERE email = ?")
    .get("antiga@teste.local").access_level,
  1,
);

const senha = "Senha de teste 123";
const hash = await protegerSenha(senha);
const salAntigo = randomBytes(16).toString("hex");
const hashAntigo = `${salAntigo}:${scryptSync(senha, salAntigo, 64).toString("hex")}`;
banco
  .prepare("UPDATE staff_users SET password_hash = ? WHERE email = ?")
  .run(hashAntigo, "antiga@teste.local");
for (const nivel of [1, 2, 3]) {
  banco
    .prepare(
      "INSERT INTO staff_users (name, email, password_hash, access_level) VALUES (?, ?, ?, ?)",
    )
    .run(
      "Pessoa nível " + nivel,
      "nivel" + nivel + "@teste.local",
      hash,
      nivel,
    );
}

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

async function chamar(caminho, cookie, method = "GET", dados) {
  return fetch(base + caminho, {
    method,
    redirect: "manual",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(dados ? { body: JSON.stringify(dados) } : {}),
  });
}

function cpfDeTeste(base) {
  const digitos = String(base).padStart(9, "0").split("").map(Number);
  for (let posicao = 9; posicao <= 10; posicao += 1) {
    let soma = 0;
    for (let indice = 0; indice < posicao; indice += 1) {
      soma += digitos[indice] * (posicao + 1 - indice);
    }
    digitos.push(((soma * 10) % 11) % 10);
  }
  return digitos.join("");
}

try {
  const cookies = {};
  const loginAntigo = await chamar("/api/equipe/login", null, "POST", {
    email: "antiga@teste.local",
    password: senha,
  });
  assert.equal(loginAntigo.status, 200);
  assert.match(
    banco
      .prepare("SELECT password_hash FROM staff_users WHERE email = ?")
      .get("antiga@teste.local").password_hash,
    /^scrypt\$v2\$/,
  );
  const cpfAntigo = cpfDeTeste(100000099);
  banco
    .prepare(
      "INSERT INTO customers (name, cpf, email, password_hash) VALUES (?, ?, ?, ?)",
    )
    .run("Cliente antigo", cpfAntigo, "antigo-cliente@teste.local", hashAntigo);
  assert.equal(
    (
      await chamar("/api/clientes/login", null, "POST", {
        cpf: cpfAntigo,
        password: senha,
      })
    ).status,
    200,
  );
  assert.match(
    banco
      .prepare("SELECT password_hash FROM customers WHERE cpf = ?")
      .get(cpfAntigo).password_hash,
    /^scrypt\$v2\$/,
  );
  assert.equal(
    (
      await chamar("/api/equipe/entrada-inicial", null, "POST", {
        password: process.env.ADMIN_PASSWORD,
      })
    ).status,
    400,
  );
  const semEmail = await chamar("/api/equipe/login", null, "POST", {
    identifier: "nivel1@teste.local",
    password: senha,
  });
  assert.equal(semEmail.status, 400);

  for (const nivel of [1, 2, 3]) {
    const login = await chamar("/api/equipe/login", null, "POST", {
      email: "nivel" + nivel + "@teste.local",
      password: senha,
    });
    assert.equal(login.status, 200);
    cookies[nivel] = login.headers.get("set-cookie").split(";")[0];
    const sessao = await (await chamar("/api/sessao", cookies[nivel])).json();
    assert.equal(sessao.administrador.nivel, nivel);
    for (const modulo of ["usinas", "faturas"]) {
      assert.equal(
        (await chamar("/api/admin/" + modulo, cookies[nivel])).status,
        200,
      );
    }
    assert.equal(
      (await chamar("/api/equipe/dados", cookies[nivel])).status,
      200,
    );
  }
  const dadosDeClientes = await (
    await chamar("/api/equipe/dados?secao=clientes", cookies[2])
  ).json();
  assert.ok(Array.isArray(dadosDeClientes.clientes));
  assert.equal("contatos" in dadosDeClientes, false);
  assert.equal("administradores" in dadosDeClientes, false);

  assert.equal((await chamar("/api/admin/financeiro")).status, 401);
  assert.equal((await chamar("/api/admin/financeiro", cookies[1])).status, 403);
  assert.equal((await chamar("/api/admin/financeiro", cookies[2])).status, 200);
  const somenteContas = await (
    await chamar("/api/admin/financeiro?visao=contas", cookies[2])
  ).json();
  assert.ok(Array.isArray(somenteContas.contas));
  assert.equal("historico" in somenteContas, false);

  const conta = {
    descricao: "Manutenção",
    favorecido: "Fornecedor teste",
    valor: "123.45",
    vencimento: "2026-10-10",
    status: "Pendente",
  };
  for (const nivel of [1, 2]) {
    assert.equal(
      (await chamar("/api/admin/financeiro", cookies[nivel], "POST", conta))
        .status,
      403,
    );
    assert.equal(
      (await chamar("/api/admin/financeiro/1", cookies[nivel], "PATCH", conta))
        .status,
      403,
    );
    assert.equal(
      (await chamar("/api/equipe/administradores", cookies[nivel], "POST", {}))
        .status,
      403,
    );
    assert.equal(
      (await chamar("/api/admin/administradores/1", cookies[nivel], "DELETE"))
        .status,
      403,
    );
    assert.equal(
      (
        await chamar(
          "/api/admin/administradores/2/nivel",
          cookies[nivel],
          "PATCH",
          { nivel: 3 },
        )
      ).status,
      403,
    );
  }
  assert.equal(
    (await chamar("/api/admin/financeiro", cookies[3], "POST", conta)).status,
    201,
  );
  assert.equal(
    (
      await chamar("/api/admin/financeiro/1", cookies[3], "PATCH", {
        ...conta,
        valor: "456.78",
        versao: 1,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await chamar("/api/admin/financeiro/1", cookies[3], "PATCH", {
        ...conta,
        valor: "999",
        versao: 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await chamar("/api/admin/financeiro/1", cookies[3], "PATCH", {
        ...conta,
        valor: "-10",
        versao: 2,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await chamar("/api/admin/financeiro", cookies[3], "POST", {
        ...conta,
        vencimento: "2026-02-30",
      })
    ).status,
    400,
  );
  const financeiro = await (
    await chamar("/api/admin/financeiro", cookies[2])
  ).json();
  assert.equal(financeiro.contas[0].valor_centavos, 45678);
  assert.equal(financeiro.historico.length, 2);
  assert.equal(financeiro.historico[0].valor_anterior, 12345);
  assert.equal(financeiro.historico[0].valor_novo, 45678);
  assert.equal(financeiro.historico[0].responsavel, "Pessoa nível 3");

  const criarAdmin = await chamar(
    "/api/equipe/administradores",
    cookies[3],
    "POST",
    {
      name: "Novo intermediário",
      cpf: "52998224725",
      email: "novo@teste.local",
      password: senha,
      nivel: 2,
    },
  );
  assert.equal(criarAdmin.status, 200);
  assert.equal(
    banco
      .prepare("SELECT access_level FROM staff_users WHERE email = ?")
      .get("novo@teste.local").access_level,
    2,
  );
  const novosCookies = {};
  for (const nivel of [1, 2, 3]) {
    const email = `criado${nivel}@teste.local`;
    const criado = await chamar(
      "/api/equipe/administradores",
      cookies[3],
      "POST",
      {
        name: `Acesso criado ${nivel}`,
        email,
        password: senha,
        nivel,
      },
    );
    assert.equal(criado.status, 200);
    const pessoa = banco
      .prepare("SELECT cpf, access_level FROM staff_users WHERE email = ?")
      .get(email);
    assert.equal(pessoa.cpf, null);
    assert.equal(pessoa.access_level, nivel);
    const login = await chamar("/api/equipe/login", null, "POST", {
      email,
      password: senha,
    });
    assert.equal(login.status, 200);
    novosCookies[nivel] = login.headers.get("set-cookie").split(";")[0];
  }
  assert.equal(
    (
      await chamar("/api/equipe/administradores", cookies[3], "POST", {
        name: "Email repetido",
        email: "CRIADO1@TESTE.LOCAL",
        password: senha,
        nivel: 1,
      })
    ).status,
    400,
  );
  const idAvancado = banco
    .prepare("SELECT id FROM staff_users WHERE email = ?")
    .get("nivel3@teste.local").id;
  assert.equal(
    (
      await chamar(
        "/api/admin/administradores/" + idAvancado,
        cookies[3],
        "DELETE",
      )
    ).status,
    400,
  );
  const idBasico = banco
    .prepare("SELECT id FROM staff_users WHERE email = ?")
    .get("criado1@teste.local").id;
  assert.equal(
    (
      await chamar(
        "/api/admin/administradores/" + idBasico,
        cookies[3],
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    banco.prepare("SELECT 1 FROM staff_users WHERE id = ?").get(idBasico),
    undefined,
  );
  assert.equal(
    (await (await chamar("/api/sessao", novosCookies[1])).json()).perfil,
    null,
  );
  const idNovoIntermediario = banco
    .prepare("SELECT id FROM staff_users WHERE email = ?")
    .get("criado2@teste.local").id;
  assert.equal(
    (
      await chamar(
        "/api/admin/administradores/" + idNovoIntermediario + "/nivel",
        cookies[3],
        "PATCH",
        { nivel: 3 },
      )
    ).status,
    200,
  );
  assert.equal(
    (await (await chamar("/api/sessao", novosCookies[2])).json()).administrador
      .nivel,
    3,
  );
  assert.equal(
    (
      await chamar(
        "/api/admin/administradores/" + idNovoIntermediario + "/nivel",
        cookies[3],
        "PATCH",
        { nivel: 1 },
      )
    ).status,
    200,
  );
  assert.equal(
    (await chamar("/api/admin/financeiro", novosCookies[2])).status,
    403,
  );
  const idNovoAvancado = banco
    .prepare("SELECT id FROM staff_users WHERE email = ?")
    .get("criado3@teste.local").id;
  assert.equal(
    (
      await chamar(
        "/api/admin/administradores/" + idNovoAvancado,
        cookies[3],
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await (await chamar("/api/sessao", novosCookies[3])).json()).perfil,
    null,
  );
  const criarCliente = await chamar(
    "/api/equipe/clientes",
    cookies[1],
    "POST",
    {
      name: "Cliente teste",
      cpf: "11144477735",
      email: "cliente@teste.local",
      test_password: senha,
    },
  );
  assert.equal(criarCliente.status, 200);

  for (const nivel of [1, 2, 3]) {
    const cpf = cpfDeTeste(100000000 + nivel);
    const nome = `Cliente do nível ${nivel}`;
    assert.equal(
      (
        await chamar("/api/equipe/clientes", cookies[nivel], "POST", {
          name: nome,
          cpf,
          email: `cliente${nivel}@teste.local`,
          test_password: senha,
        })
      ).status,
      200,
    );
    const id = banco
      .prepare("SELECT id FROM customers WHERE cpf = ?")
      .get(cpf).id;
    const loginCliente = await chamar("/api/clientes/login", null, "POST", {
      cpf,
      password: senha,
    });
    assert.equal(loginCliente.status, 200);
    const cookieCliente = loginCliente.headers.get("set-cookie").split(";")[0];
    banco
      .prepare(
        "INSERT INTO auth_tokens (customer_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, `token-${nivel}`, "reset", Date.now() + 60000);
    if (nivel === 1) {
      banco
        .prepare(
          "INSERT INTO faturas (cliente_id, referencia, vencimento, valor_centavos) VALUES (?, ?, ?, ?)",
        )
        .run(id, "2026-09", "2026-10-10", 15000);
    }
    const endereco = "/api/admin/clientes/" + id;
    assert.equal((await chamar(endereco, null, "DELETE")).status, 401);
    assert.equal((await chamar(endereco, cookieCliente, "DELETE")).status, 401);
    assert.equal(
      (await chamar(endereco, cookies[nivel], "DELETE")).status,
      200,
    );
    assert.equal(
      banco.prepare("SELECT 1 FROM customers WHERE id = ?").get(id),
      undefined,
    );
    assert.equal(
      banco.prepare("SELECT 1 FROM auth_tokens WHERE customer_id = ?").get(id),
      undefined,
    );
    assert.equal(
      (await (await chamar("/api/sessao", cookieCliente)).json()).perfil,
      null,
    );
    if (nivel === 1) {
      const faturas = await (
        await chamar("/api/admin/faturas", cookies[1])
      ).json();
      assert.equal(faturas[0].cliente, nome);
      assert.equal(faturas[0].valor_centavos, 15000);
    }
  }
  assert.equal(
    (await chamar("/api/admin/clientes/invalido", cookies[1], "DELETE")).status,
    400,
  );
  assert.equal(
    (await chamar("/api/admin/clientes/999999", cookies[1], "DELETE")).status,
    404,
  );

  const intermediario = banco
    .prepare("SELECT id FROM staff_users WHERE access_level = 2")
    .get();
  assert.equal(
    (
      await chamar(
        "/api/admin/administradores/" + intermediario.id + "/nivel",
        cookies[3],
        "PATCH",
        { nivel: 1 },
      )
    ).status,
    200,
  );
  assert.equal((await chamar("/api/admin/financeiro", cookies[2])).status, 403);
  console.log(
    "OK: três níveis, cadastro e exclusão de clientes, faturas preservadas, gestão de acessos e financeiro.",
  );
} finally {
  await new Promise((resolver) => servidor.close(resolver));
  banco.close();
}
