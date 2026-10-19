import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import express from "express";

process.env.ECOSOL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "ecosol-exportacao-clientes-"),
);
process.env.NODE_ENV = "test";

const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { gerarPlanilhaClientes } =
  await import("../servidor/exportacaoClientes.mjs");
const { rotasAdministrativas } =
  await import("../servidor/rotasAdministrativas.mjs");
const { protegerSenha, resumoCriptografico } =
  await import("../servidor/autenticacao.mjs");
const banco = obterBanco();
const senhaHash = await protegerSenha("Senha forte para teste");
banco
  .prepare(
    "INSERT INTO customers(name,cpf,email,phone,password_hash) VALUES(?,?,?,?,?)",
  )
  .run(
    "=Cliente teste",
    "12345678901",
    "cliente@teste.local",
    "62999999999",
    senhaHash,
  );
const provisoria = Number(
  banco
    .prepare(
      "INSERT INTO faturamento_clientes_provisorios(nome,chave_origem,origem) VALUES(?,?,?)",
    )
    .run("Provisório", "planilha:1", "planilha").lastInsertRowid,
);
banco
  .prepare(
    "INSERT INTO faturamento_clientes_operacionais(referencia_interna,nome,origem_provisorio_id) VALUES(?,?,?)",
  )
  .run("OP-1", "Operacional", provisoria);
banco
  .prepare(
    "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento) VALUES(?,?,?,?,?)",
  )
  .run("000123", "UC sem vínculo", "", "", 0);

const resultado = await gerarPlanilhaClientes(banco);
assert.equal(resultado.total, 4);
assert.equal(resultado.unidades, 1);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(resultado.buffer);
assert.deepEqual(
  workbook.worksheets.map((aba) => aba.name),
  ["Resumo", "Todos os clientes", "UCs vinculadas"],
);
assert.equal(workbook.getWorksheet("Todos os clientes").rowCount, 5);
assert.equal(workbook.getWorksheet("UCs vinculadas").rowCount, 2);
assert.equal(
  workbook.getWorksheet("Todos os clientes").getCell("C2").value,
  "'=Cliente teste",
);
assert.equal(
  workbook.getWorksheet("UCs vinculadas").getCell("B2").value,
  "000123",
);
assert.ok(!JSON.stringify(workbook.model).includes(senhaHash));

const tokenBasico = randomBytes(32).toString("hex");
const tokenAvancado = randomBytes(32).toString("hex");
for (const [nivel, token] of [
  [1, tokenBasico],
  [3, tokenAvancado],
]) {
  const id = Number(
    banco
      .prepare(
        "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,?)",
      )
      .run(`Equipe ${nivel}`, `equipe${nivel}@teste.local`, senhaHash, nivel)
      .lastInsertRowid,
  );
  banco
    .prepare(
      "INSERT INTO sessions(staff_id,token_hash,role,expires_at) VALUES(?,?,?,?)",
    )
    .run(id, resumoCriptografico(token), "staff", Date.now() + 60_000);
}
const app = express();
app.use(rotasAdministrativas);
const servidor = app.listen(0, "127.0.0.1");
await new Promise((resolver) => servidor.once("listening", resolver));
try {
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = (token) =>
    fetch(`${base}/api/admin/clientes/exportar`, {
      headers: { Cookie: `ecosol_session=${token}` },
    });
  assert.equal((await chamar(tokenBasico)).status, 403);
  const autorizado = await chamar(tokenAvancado);
  assert.equal(autorizado.status, 200);
  assert.match(
    autorizado.headers.get("content-disposition"),
    /attachment; filename="clientes-ecosol-/,
  );
  assert.match(autorizado.headers.get("cache-control"), /no-store/);
  const baixado = new ExcelJS.Workbook();
  await baixado.xlsx.load(Buffer.from(await autorizado.arrayBuffer()));
  assert.equal(baixado.getWorksheet("Todos os clientes").rowCount, 5);
  const auditoria = banco
    .prepare(
      "SELECT total_clientes,total_unidades FROM auditoria_exportacoes_clientes",
    )
    .all();
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].total_clientes, 4);
  assert.equal(auditoria[0].total_unidades, 1);
} finally {
  servidor.close();
  banco.close();
}
console.log(
  "OK: exportação completa de clientes, proteção de dados e autorização.",
);
