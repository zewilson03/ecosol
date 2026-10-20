import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import express from "express";

process.env.ECOSOL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "ecosol-exportacao-usinas-"),
);
process.env.NODE_ENV = "test";
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { gerarPlanilhaUsinas } =
  await import("../servidor/exportacaoUsinas.mjs");
const { rotasAdministrativas } =
  await import("../servidor/rotasAdministrativas.mjs");
const { protegerSenha, resumoCriptografico } =
  await import("../servidor/autenticacao.mjs");
const banco = obterBanco();
const usinaId = Number(
  banco
    .prepare(
      "INSERT INTO usinas(nome,localizacao,potencia_kw,status) VALUES(?,?,?,?)",
    )
    .run("=Solar Teste", "Goiás", 100, "Ativa").lastInsertRowid,
);
banco
  .prepare(
    "INSERT INTO usinas_identificadores_geracao(usina_id,numero,tipo,origem) VALUES(?,?,?,?)",
  )
  .run(usinaId, "000123", "atual", "Teste");
banco
  .prepare(
    "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento,usina_id) VALUES(?,?,?,?,?,?)",
  )
  .run("000456", "Cliente Teste", "", "", 0, usinaId);
const planilha = new ExcelJS.Workbook();
await planilha.xlsx.load((await gerarPlanilhaUsinas(banco)).buffer);
assert.deepEqual(
  planilha.worksheets.map((item) => item.name),
  ["Usinas", "UCs por usina", "Modalidades e IDs"],
);
assert.equal(
  planilha.getWorksheet("Usinas").getCell("B2").value,
  "'=Solar Teste",
);
assert.equal(
  planilha.getWorksheet("UCs por usina").getCell("B2").value,
  "000456",
);
assert.equal(
  planilha.getWorksheet("Modalidades e IDs").getCell("C2").value,
  "000123",
);
const senha = await protegerSenha("Senha de teste forte");
const tokens = [];
for (const nivel of [1, 3]) {
  const token = randomBytes(32).toString("hex");
  const id = Number(
    banco
      .prepare(
        "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,?)",
      )
      .run(`Equipe ${nivel}`, `equipe${nivel}@teste.local`, senha, nivel)
      .lastInsertRowid,
  );
  banco
    .prepare(
      "INSERT INTO sessions(staff_id,token_hash,role,expires_at) VALUES(?,?,?,?)",
    )
    .run(id, resumoCriptografico(token), "staff", Date.now() + 60_000);
  tokens.push(token);
}
const app = express();
app.use(rotasAdministrativas);
const servidor = app.listen(0, "127.0.0.1");
await new Promise((resolver) => servidor.once("listening", resolver));
try {
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = (token) =>
    fetch(`${base}/api/admin/usinas/exportar`, {
      headers: { Cookie: `ecosol_session=${token}` },
    });
  assert.equal((await chamar(tokens[0])).status, 403);
  const resposta = await chamar(tokens[1]);
  assert.equal(resposta.status, 200);
  assert.match(resposta.headers.get("cache-control"), /no-store/);
  assert.equal(
    banco
      .prepare("SELECT COUNT(*) AS total FROM auditoria_exportacoes_usinas")
      .get().total,
    1,
  );
} finally {
  servidor.close();
  banco.close();
}
console.log(
  "OK: exportação de usinas, UCs e identificadores com autorização e auditoria.",
);
