import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  camposImportacao,
  lerExcel,
  prepararImportacao,
  sugerirMapeamento,
  criarModelo,
  exportarCalculos,
} from "../servidor/faturamento/planilhas.mjs";
import { calcularCobranca } from "../servidor/faturamento/regras.mjs";
import { nomeUsinaDoArquivo } from "../servidor/faturamento/catalogoPlanilhas.mjs";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-excel-"));
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { rotasFaturamento } = await import("../servidor/faturamento/rotas.mjs");
const banco = obterBanco(),
  cookies = {};
for (const n of [1, 2, 3]) {
  const id = Number(
      banco
        .prepare(
          "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,?)",
        )
        .run("Teste Excel " + n, `excel${n}@example.test`, "teste", n)
        .lastInsertRowid,
    ),
    token = randomBytes(32).toString("hex");
  banco
    .prepare(
      "INSERT INTO sessions(staff_id,token_hash,role,expires_at) VALUES(?,?,?,?)",
    )
    .run(
      id,
      createHash("sha256").update(token).digest("hex"),
      "staff",
      Date.now() + 3600000,
    );
  cookies[n] = `ecosol_session=${token}`;
}
const app = express();
app.use(express.json({ limit: "20kb" }), rotasFaturamento);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/api/admin/faturamento`;
const mime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
async function call(path, method = "GET", data, nivel = 2) {
  return fetch(base + path, {
    method,
    headers: {
      ...(nivel ? { Cookie: cookies[nivel] } : {}),
      "Content-Type": Buffer.isBuffer(data) ? mime : "application/json",
    },
    ...(data !== undefined
      ? { body: Buffer.isBuffer(data) ? data : JSON.stringify(data) }
      : {}),
  });
}
async function ok(path, method, data, status = 200, nivel = 2) {
  const r = await call(path, method, data, nivel),
    v = await r.json();
  assert.equal(r.status, status, JSON.stringify(v));
  return v;
}
async function arquivo(rows) {
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet("Clientes");
  s.addRow(camposImportacao.map((c) => c.rotulo));
  for (const row of rows) s.addRow(row);
  s.getCell("G2").numFmt = "0%";
  return Buffer.from(await w.xlsx.writeBuffer());
}
const linha = [
  "Cliente de teste",
  "11.222.333/0001-81",
  "000423652401252",
  "cliente@example.test",
  10,
  "GDII",
  0.25,
  "2026-09",
];
try {
  const atuais = sugerirMapeamento(
    ["Clientes", "UC", "NOVA UC", "% desconto"].map((valor) => ({
      valor,
      tipo: "texto",
    })),
  );
  assert.equal(atuais.nome, 0);
  assert.equal(atuais.uc, 2);
  assert.equal(atuais.desconto, 3);
  const grande = new ExcelJS.Workbook();
  const historico = grande.addWorksheet("Histórico");
  for (let i = 0; i < 1000; i++)
    historico.addRow(Array(26).fill("Conferência"));
  historico.mergeCells("A1:Z1");
  const leituraGrande = await lerExcel(
    Buffer.from(await grande.xlsx.writeBuffer()),
  );
  assert.equal(leituraGrande[0].linhas.length, 1000);
  assert.equal(leituraGrande[0].linhas[999][25].valor, "Conferência");
  await ok(
    "/usinas",
    "POST",
    { nome: "Usina A", localizacao: "Goiás" },
    403,
    2,
  );
  const usina = await ok(
    "/usinas",
    "POST",
    { nome: "Usina A", localizacao: "Goiás" },
    201,
    3,
  );
  const outra = await ok(
    "/usinas",
    "POST",
    { nome: "Usina B", localizacao: "Goiás" },
    201,
    3,
  );
  const original = await arquivo([
    linha,
    ["Cliente inválido", "123", "999", "ruim", 0, "GDI", 25, "2026-09"],
  ]);
  const hash = createHash("sha256").update(original).digest("hex");
  process.env.ECOSOL_PLANILHAS_DIR = mkdtempSync(
    join(tmpdir(), "ecosol-fontes-"),
  );
  const nomeLocal =
    "03 - Venda de Energia - Usina São Francisco 2026.xlsx.xlsx";
  writeFileSync(join(process.env.ECOSOL_PLANILHAS_DIR, nomeLocal), original);
  writeFileSync(
    join(process.env.ECOSOL_PLANILHAS_DIR, "uc por usina.xlsx"),
    original,
  );
  mkdirSync(
    join(process.env.ECOSOL_PLANILHAS_DIR, "Usinas que saíram em definitivo"),
  );
  assert.equal(nomeUsinaDoArquivo(nomeLocal), "São Francisco");
  assert.equal(
    nomeUsinaDoArquivo("24 - Venda de Energia - Usina 2000 Solar.xlsx"),
    "2000 Solar",
  );
  await ok("/planilhas/pasta", "GET", undefined, 403, 1);
  assert.equal(
    (await call("/planilhas/pasta", "GET", undefined, null)).status,
    401,
  );
  const catalogo = await ok("/planilhas/pasta");
  assert.deepEqual(catalogo, [{ arquivo: nomeLocal, usina: "São Francisco" }]);
  await ok(
    "/planilhas/consultar-local",
    "POST",
    { arquivo: nomeLocal },
    403,
    1,
  );
  await ok(
    "/planilhas/consultar-local",
    "POST",
    { arquivo: "../fora.xlsx" },
    400,
  );
  const consultaLocal = await ok("/planilhas/consultar-local", "POST", {
    arquivo: nomeLocal,
  });
  assert.equal(consultaLocal.hash, hash);
  assert.equal(consultaLocal.abas[0].nome, "Clientes");
  assert.equal(
    banco.prepare("SELECT count(*) AS n FROM faturamento_unidades").get().n,
    0,
  );
  assert.equal(
    banco.prepare("SELECT count(*) AS n FROM faturamento_importacoes").get().n,
    0,
  );
  assert.deepEqual(
    readFileSync(join(process.env.ECOSOL_PLANILHAS_DIR, nomeLocal)),
    original,
  );
  const abas = await lerExcel(original),
    mapa = sugerirMapeamento(abas[0].linhas[0]);
  assert.equal(mapa.documento, 1);
  assert.equal(mapa.desconto, 6);
  const configuracao = {
    aba: "Clientes",
    cabecalho: 1,
    mapa,
    usina_id: usina.id,
  };
  const previa = prepararImportacao(abas, configuracao, banco);
  assert.equal(previa.validas, 1);
  assert.equal(previa.problemas, 1);
  assert.equal(previa.linhas[0].contrato.desconto, "25");
  assert.equal(previa.linhas[0].unidade.uc, "423652401252");
  assert.equal(previa.linhas[0].unidade.usina_id, usina.id);
  assert.equal(createHash("sha256").update(original).digest("hex"), hash);
  await ok(
    "/planilhas/analisar?nome=a.xlsx&usina_id=" + usina.id,
    "POST",
    original,
    401,
    null,
  );
  await ok(
    "/planilhas/analisar?nome=a.xlsx&usina_id=" + usina.id,
    "POST",
    original,
    403,
    1,
  );
  await ok("/planilhas/analisar?nome=a.xlsx", "POST", original, 400);
  await ok(
    "/planilhas/analisar?nome=a.xls&usina_id=" + usina.id,
    "POST",
    original,
    400,
  );
  await ok(
    "/planilhas/analisar?nome=a.xlsx&usina_id=" + usina.id,
    "POST",
    Buffer.from("PKcorrompido"),
    400,
  );
  const a = await ok(
    "/planilhas/analisar?nome=a.xlsx&usina_id=" + usina.id,
    "POST",
    original,
    201,
  );
  assert.equal(a.usina, "Usina A");
  await ok(`/planilhas/${a.id}/confirmar`, "POST", { confirmado: true }, 409);
  await ok(`/planilhas/${a.id}/previa`, "POST", configuracao, 404, 3);
  const p = await ok(`/planilhas/${a.id}/previa`, "POST", configuracao);
  const p2 = await ok(`/planilhas/${a.id}/previa`, "POST", configuracao);
  await ok(
    `/planilhas/${a.id}/confirmar`,
    "POST",
    { confirmado: true, previa_id: p.previa_id },
    409,
  );
  const resultado = await ok(`/planilhas/${a.id}/confirmar`, "POST", {
    confirmado: true,
    previa_id: p2.previa_id,
  });
  assert.equal(resultado.quantidade, 1);
  const repetir = await ok(`/planilhas/${a.id}/confirmar`, "POST", {
    confirmado: true,
    previa_id: p2.previa_id,
  });
  assert.equal(repetir.ja_concluida, true);
  assert.equal(
    banco.prepare("SELECT COUNT(*) AS n FROM faturamento_unidades").get().n,
    1,
  );
  assert.equal(prepararImportacao(abas, configuracao, banco).ignoradas, 1);
  assert.equal(
    prepararImportacao(abas, { ...configuracao, usina_id: outra.id }, banco)
      .linhas[0].status,
    "Conflito",
  );
  const duplicadas = await lerExcel(await arquivo([linha, linha]));
  assert.equal(prepararImportacao(duplicadas, configuracao, banco).validas, 0);
  const formulas = await lerExcel(
    await arquivo([
      [...linha.slice(0, 6), { formula: "25", result: 25 }, "2026-09"],
    ]),
  );
  assert.match(
    prepararImportacao(formulas, configuracao, banco).linhas[0].mensagem,
    /fórmula/,
  );
  const data = await lerExcel(
    await arquivo([[...linha.slice(0, 7), new Date("2026-09-01T00:00:00Z")]]),
  );
  assert.equal(
    prepararImportacao(data, configuracao, banco).linhas[0].contrato.inicio,
    "2026-09",
  );
  const antes = banco.prepare("SELECT * FROM faturamento_unidades").get();
  const valido2 = await arquivo([
    [
      "Segundo",
      "52998224725",
      "123456",
      "segundo@example.test",
      15,
      "GDI",
      0.15,
      "2026-09",
    ],
  ]);
  const a2 = await ok(
    "/planilhas/analisar?nome=b.xlsx&usina_id=" + usina.id,
    "POST",
    valido2,
    201,
  );
  const p3 = await ok(`/planilhas/${a2.id}/previa`, "POST", configuracao);
  banco
    .prepare(
      "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento) VALUES(?,?,?,?,?)",
    )
    .run("123456", "Concorrente", "52998224725", "outro@example.test", 10);
  await ok(
    `/planilhas/${a2.id}/confirmar`,
    "POST",
    { confirmado: true, previa_id: p3.previa_id },
    409,
  );
  assert.deepEqual(
    banco
      .prepare("SELECT * FROM faturamento_unidades WHERE id=?")
      .get(antes.id),
    antes,
  );
  const modelo = new ExcelJS.Workbook();
  await modelo.xlsx.load(await criarModelo());
  assert.equal(modelo.getWorksheet("Cadastros").rowCount, 1);
  assert.equal(modelo.getWorksheet("Cadastros").getColumn(2).numFmt, "@");
  const calculo = calcularCobranca({
    injecao: "1660",
    unitario: "1.1",
    bandeira: "0.069969",
    desconto: "25",
    total_equatorial: "302.40",
    ajuste_gdii: "290.71",
    modalidade: "GDII",
  });
  const memoria = {
    ...calculo,
    unidade: {
      ...antes,
      nome: "=HYPERLINK(nao executar)",
      usina_id: usina.id,
      usina_nome: "Usina A",
    },
    contrato: { modalidade: "GDII" },
    competencia: "2026-09",
    vencimento_equatorial: "2026-09-28",
    vencimento_ecosol: "2026-10-10",
    fonte: { documento_id: 1 },
  };
  banco
    .prepare(
      "INSERT INTO faturamento_documentos(hash,nome,pdf,lote,texto,extracao,dados,memoria) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      "teste",
      "teste.pdf",
      Buffer.from("teste"),
      "Setembro",
      "",
      "{}",
      "{}",
      JSON.stringify(memoria),
    );
  const resp = await call("/planilhas/calculos?usina_id=" + usina.id),
    buffer = Buffer.from(await resp.arrayBuffer());
  assert.equal(resp.status, 200);
  const exportado = new ExcelJS.Workbook();
  await exportado.xlsx.load(buffer);
  const sheet = exportado.worksheets[0];
  assert.equal(sheet.getCell("Q2").value, 1468.3);
  assert.equal(sheet.getCell("N2").value, 1456.61);
  assert.equal(sheet.getCell("B2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("V2").value, "Usina A");
  const empty = await call("/planilhas/calculos?usina_id=" + outra.id);
  const noRows = new ExcelJS.Workbook();
  await noRows.xlsx.load(Buffer.from(await empty.arrayBuffer()));
  assert.equal(noRows.worksheets[0].rowCount, 1);
  assert.equal(
    (await call("/planilhas/calculos", "GET", undefined, null)).status,
    401,
  );
  // Planilha mensal incompleta: complementos existem apenas na prévia do sistema.
  const mensal = new ExcelJS.Workbook(),
    mes = mensal.addWorksheet("Set - 26");
  mes.addRow(["Clientes", "UC", "NOVA UC", "% desconto"]);
  mes.addRow(["Cliente mensal", "1234567", "400000001234", 0.25]);
  mes.getCell("D2").numFmt = "0%";
  mes.addRow(["Outro cliente pendente", "7654321", "400000005678", 0.2]);
  mes.getCell("D3").numFmt = "0%";
  const mensalBuffer = Buffer.from(await mensal.xlsx.writeBuffer());
  const nomeMensal = "50 - Venda de Energia - Usina Teste Mensal 2026.xlsx";
  writeFileSync(
    join(process.env.ECOSOL_PLANILHAS_DIR, nomeMensal),
    mensalBuffer,
  );
  await ok(
    "/planilhas/analisar-local",
    "POST",
    { arquivo: nomeMensal, usina_id: usina.id },
    403,
    1,
  );
  await ok(
    "/planilhas/analisar-local",
    "POST",
    { arquivo: "../fora.xlsx", usina_id: usina.id },
    400,
  );
  await ok("/planilhas/analisar-local", "POST", { arquivo: nomeMensal }, 400);
  const sessaoMensal = await ok(
    "/planilhas/analisar-local",
    "POST",
    { arquivo: nomeMensal, usina_id: usina.id },
    201,
  );
  const configMensal = {
    aba: "Set - 26",
    cabecalho: 1,
    mapa: { nome: 0, uc: 2, desconto: 3 },
    padroes: { modalidade: "GDII", inicio: "2026-09" },
  };
  const pendente = await ok(
    `/planilhas/${sessaoMensal.id}/previa`,
    "POST",
    configMensal,
  );
  assert.equal(pendente.validas, 0);
  assert.equal(pendente.problemas, 2);
  assert.equal(pendente.linhas[0].dados.desconto, "25");
  assert.equal(pendente.linhas[0].dados.uc, "400000001234");
  const preenchido = {
    ...configMensal,
    usina_id: outra.id,
    correcoes: {
      2: {
        documento: "11222333000181",
        email: "mensal@example.test",
        dia_vencimento: "15",
      },
    },
  };
  const pronto = await ok(
    `/planilhas/${sessaoMensal.id}/previa`,
    "POST",
    preenchido,
  );
  assert.equal(pronto.validas, 1);
  assert.equal(pronto.problemas, 1);
  await ok(
    `/planilhas/${sessaoMensal.id}/confirmar`,
    "POST",
    { previa_id: pendente.previa_id, confirmado: true },
    409,
  );
  const malformado = await ok(`/planilhas/${sessaoMensal.id}/previa`, "POST", {
    ...preenchido,
    correcoes: { 2: { email: { value: "não aceitar" } } },
  });
  assert.equal(malformado.validas, 0);
  const finalMensal = await ok(
    `/planilhas/${sessaoMensal.id}/previa`,
    "POST",
    preenchido,
  );
  assert.equal(
    (
      await ok(`/planilhas/${sessaoMensal.id}/confirmar`, "POST", {
        previa_id: finalMensal.previa_id,
        confirmado: true,
      })
    ).quantidade,
    1,
  );
  const unidadeMensal = banco
    .prepare("SELECT * FROM faturamento_unidades WHERE uc=?")
    .get("400000001234");
  assert.equal(unidadeMensal.usina_id, usina.id);
  const auditoria = JSON.parse(
    banco
      .prepare("SELECT dados FROM faturamento_historico WHERE unidade_id=?")
      .get(unidadeMensal.id).dados,
  );
  assert.equal(auditoria.complementos_no_sistema.email, "mensal@example.test");
  assert.deepEqual(
    readFileSync(join(process.env.ECOSOL_PLANILHAS_DIR, nomeMensal)),
    mensalBuffer,
  );
  console.log(
    "OK: Excel por usina, percentuais, cabeçalhos, duplicidades, conflitos, concorrência, confirmação, exportação e preservação da origem.",
  );
} finally {
  await new Promise((r) => server.close(r));
  banco.close();
}
