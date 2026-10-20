import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import express from "express";

process.env.ECOSOL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "ecosol-importacao-dados-clientes-"),
);
process.env.NODE_ENV = "test";
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { rotasAdministrativas } =
  await import("../servidor/rotasAdministrativas.mjs");
const { prepararDadosClientes } =
  await import("../servidor/importacaoDadosClientes.mjs");
const { protegerSenha, resumoCriptografico } =
  await import("../servidor/autenticacao.mjs");
const banco = obterBanco();
const cpfExistente = "52998224725";
const cpfNovo = "11144477735";
const cpfOutro = "93541134780";
const clienteId = Number(
  banco
    .prepare("INSERT INTO customers(name,cpf,email,phone) VALUES(?,?,?,?)")
    .run("Cliente Atual", cpfExistente, "", "").lastInsertRowid,
);
banco
  .prepare(
    "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento,cliente_id) VALUES(?,?,?,?,?,?)",
  )
  .run("000001", "Cliente Atual", cpfExistente, "", 0, clienteId);
banco
  .prepare(
    "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento) VALUES(?,?,?,?,?)",
  )
  .run("000002", "Cliente Novo", "", "", 0);
banco
  .prepare(
    "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento,cliente_id) VALUES(?,?,?,?,?,?)",
  )
  .run("000003", "Cliente Atual", cpfExistente, "", 0, clienteId);
const senha = await protegerSenha("Senha forte de teste");
const tokens = [];
for (const nivel of [1, 3]) {
  const token = randomBytes(32).toString("hex");
  const id = Number(
    banco
      .prepare(
        "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,?)",
      )
      .run(`Equipe ${nivel}`, `importacao${nivel}@teste.local`, senha, nivel)
      .lastInsertRowid,
  );
  banco
    .prepare(
      "INSERT INTO sessions(staff_id,token_hash,role,expires_at) VALUES(?,?,?,?)",
    )
    .run(id, resumoCriptografico(token), "staff", Date.now() + 60_000);
  tokens.push(token);
}
const workbook = new ExcelJS.Workbook();
const aba = workbook.addWorksheet("Clientes");
aba.addRow(["Nome", "CPF", "UC", "E-mail", "Telefone"]);
aba.addRow(["Cliente Atual", cpfExistente, "000001", "atual@teste.local", ""]);
aba.addRow(["Outro Titular", cpfOutro, "000003", "outro@teste.local", ""]);
aba.addRow(["Cliente Novo", cpfNovo, "000002", "novo@teste.local", ""]);
const arquivo = Buffer.from(await workbook.xlsx.writeBuffer());
const app = express();
app.use(express.json());
app.use(rotasAdministrativas);
app.use((erro, _req, res, _next) =>
  res
    .status(erro.status ?? erro.statusCode ?? 500)
    .json({ erro: erro.message }),
);
const servidor = app.listen(0, "127.0.0.1");
await new Promise((resolver) => servidor.once("listening", resolver));
try {
  const base = `http://127.0.0.1:${servidor.address().port}/api/admin/clientes/planilhas`;
  const chamar = (
    token,
    caminho,
    metodo,
    body,
    contentType = "application/json",
  ) =>
    fetch(`${base}${caminho}`, {
      method: metodo,
      headers: {
        Cookie: `ecosol_session=${token}`,
        "Content-Type": contentType,
      },
      body: contentType === "application/json" ? JSON.stringify(body) : body,
    });
  assert.equal(
    (
      await chamar(
        tokens[0],
        "/analisar?nome=clientes.xlsx",
        "POST",
        arquivo,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
    ).status,
    403,
  );
  const analiseResposta = await chamar(
    tokens[1],
    "/analisar?nome=clientes.xlsx",
    "POST",
    arquivo,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(analiseResposta.status, 201);
  const analise = await analiseResposta.json();
  assert.equal(analise.linhas, 3);
  const previaResposta = await chamar(
    tokens[1],
    `/${analise.id}/previa`,
    "POST",
    {},
  );
  assert.equal(previaResposta.status, 200);
  const previa = await previaResposta.json();
  assert.equal(previa.resumo.completar, 1);
  assert.equal(previa.resumo.criar, 1);
  assert.equal(previa.resumo.conferir, 1);
  assert.match(previa.linhas[1].motivo, /titularidade/);
  assert.equal(
    banco.prepare("SELECT email FROM customers WHERE id=?").get(clienteId)
      .email,
    "",
  );
  assert.notEqual(
    (
      await chamar(tokens[1], `/${analise.id}/confirmar`, "POST", {
        previa_id: "errado",
        confirmado: true,
      })
    ).status,
    200,
  );
  const confirmado = await chamar(
    tokens[1],
    `/${analise.id}/confirmar`,
    "POST",
    { previa_id: previa.previa_id, confirmado: true },
  );
  assert.equal(confirmado.status, 200);
  assert.equal((await confirmado.json()).quantidade, 2);
  assert.equal(
    banco.prepare("SELECT email FROM customers WHERE id=?").get(clienteId)
      .email,
    "atual@teste.local",
  );
  const unidadeAtual = banco
    .prepare("SELECT cliente_id FROM faturamento_unidades WHERE uc='000001'")
    .get();
  assert.equal(unidadeAtual.cliente_id, clienteId);
  const unidadeNova = banco
    .prepare("SELECT cliente_id FROM faturamento_unidades WHERE uc='000002'")
    .get();
  assert.ok(unidadeNova.cliente_id !== clienteId);
  assert.equal(
    banco
      .prepare("SELECT documento FROM faturamento_unidades WHERE uc='000002'")
      .get().documento,
    cpfNovo,
  );
  assert.equal(
    (
      await chamar(tokens[1], `/${analise.id}/confirmar`, "POST", {
        previa_id: previa.previa_id,
        confirmado: true,
      })
    ).status,
    200,
  );
  assert.equal(
    banco
      .prepare("SELECT COUNT(*) AS total FROM customers WHERE cpf=?")
      .get(cpfNovo).total,
    1,
  );
  const duplicadas = prepararDadosClientes(banco, [
    {
      linha: 2,
      nome: "Cliente Atual",
      cpf: cpfExistente,
      uc: "000001",
      email: "atual@teste.local",
      telefone: "",
    },
    {
      linha: 3,
      nome: "Outro Titular",
      cpf: cpfOutro,
      uc: "000001",
      email: "outro@teste.local",
      telefone: "",
    },
  ]);
  assert.ok(duplicadas.every((item) => item.acao === "conferir"));
  const arquivoNovo = new ExcelJS.Workbook();
  const abaNova = arquivoNovo.addWorksheet("Clientes");
  abaNova.addRow(["Nome", "CPF", "E-mail"]);
  abaNova.addRow(["Cliente Posterior", cpfOutro, "posterior@teste.local"]);
  const novaAnalise = await chamar(
    tokens[1],
    "/analisar?nome=novos.xlsx",
    "POST",
    Buffer.from(await arquivoNovo.xlsx.writeBuffer()),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(novaAnalise.status, 201);
  const novoId = (await novaAnalise.json()).id;
  const novaPrevia = await (
    await chamar(tokens[1], `/${novoId}/previa`, "POST", {})
  ).json();
  banco
    .prepare("INSERT INTO customers(name,cpf,email) VALUES(?,?,?)")
    .run("Cliente Posterior", cpfOutro, "posterior@teste.local");
  const alterada = await chamar(tokens[1], `/${novoId}/confirmar`, "POST", {
    previa_id: novaPrevia.previa_id,
    confirmado: true,
  });
  assert.equal(alterada.status, 409);
} finally {
  servidor.close();
  banco.close();
}
console.log(
  "OK: importação de dados de clientes, prévia, titularidade pendente, autorização e replay.",
);
