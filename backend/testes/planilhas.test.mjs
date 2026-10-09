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
  analisarEstruturaMensal,
} from "../servidor/faturamento/planilhas.mjs";
import { calcularCobranca } from "../servidor/faturamento/regras.mjs";
import { nomeUsinaDoArquivo } from "../servidor/faturamento/catalogoPlanilhas.mjs";
import {
  chaveCanonicaUsina,
  extrairVinculosDaAba,
  modalidadeInicialDaUsina,
  modalidadeVigenteDaUsina,
} from "../servidor/faturamento/vinculosUsinas.mjs";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-excel-"));
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { rotasFaturamento } = await import("../servidor/faturamento/rotas.mjs");
const { rotasAdministrativas } =
  await import("../servidor/rotasAdministrativas.mjs");
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
app.use(
  express.json({ limit: "20kb" }),
  rotasFaturamento,
  rotasAdministrativas,
);
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
  for (const [apelido, nome] of [
    ["CLAU", "CLAUDIO"],
    ["CARLOS", "CARLOS UNIÃO"],
    ["BOLT", "BOLT ENERGIA"],
    ["JB C", "JB Carvalho"],
    ["PEDRO H", "PEDRO HENRIQUE"],
    ["SOLAR", "Solar Green"],
    ["TG SILVA", "TG Silva Danielle"],
  ])
    assert.equal(chaveCanonicaUsina(apelido), chaveCanonicaUsina(nome));
  assert.equal(modalidadeInicialDaUsina("SOLAR"), "GDII");
  const celula = (valor) => ({ valor, tipo: "texto" });
  const colisaoInterna = extrairVinculosDaAba(
    [
      {
        nome: "Consulta",
        linhas: [
          ["UC antiga", "UC Nova", "Cliente", "Usina"].map(celula),
          ["200", "100", "Cliente A", "Solar Green"].map(celula),
          ["300", "200", "Cliente B", "São Francisco"].map(celula),
        ],
      },
    ],
    "Consulta",
  );
  assert.equal(colisaoInterna.linhas.filter((l) => l.erro).length, 2);
  const semColunaUsina = (nome) => ({
    nome,
    linhas: [
      ["UC Nova", "Cliente"].map(celula),
      ["900001111", "Cliente conferido"].map(celula),
    ],
  });
  assert.equal(
    extrairVinculosDaAba(
      [semColunaUsina("São Francisco")],
      "São Francisco",
      "vinculos.xlsx",
    ).linhas[0].usina,
    "São Francisco",
  );
  assert.equal(
    extrairVinculosDaAba(
      [semColunaUsina("Consulta")],
      "Consulta",
      "Usina Solar Green.xlsx",
    ).linhas[0].usina,
    "Solar Green",
  );
  assert.throws(() =>
    extrairVinculosDaAba(
      [semColunaUsina("Consulta")],
      "Consulta",
      "vinculos.xlsx",
    ),
  );
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
    {
      nome: "Usina A",
      localizacao: "Goiás",
      modalidade: "GDII",
      inicio: "2026-09",
    },
    403,
    2,
  );
  await ok(
    "/usinas",
    "POST",
    { nome: "Usina A", localizacao: "Goiás", inicio: "2026-09" },
    400,
    3,
  );
  const usina = await ok(
    "/usinas",
    "POST",
    {
      nome: "Usina A",
      localizacao: "Goiás",
      modalidade: "GDII",
      inicio: "2026-09",
    },
    201,
    3,
  );
  const outra = await ok(
    "/usinas",
    "POST",
    {
      nome: "Usina B",
      localizacao: "Goiás",
      modalidade: "GDII",
      inicio: "2026-09",
    },
    201,
    3,
  );
  assert.deepEqual(
    banco
      .prepare(
        "SELECT inicio,modalidade FROM usinas_modalidades WHERE usina_id=?",
      )
      .all(usina.id)
      .map(({ inicio, modalidade }) => ({ inicio, modalidade })),
    [{ inicio: "2026-09", modalidade: "GDII" }],
  );
  const listaUsinas = await fetch(
    `http://127.0.0.1:${server.address().port}/api/admin/usinas`,
    { headers: { Cookie: cookies[3] } },
  );
  assert.equal(listaUsinas.status, 200);
  const cadastradas = await listaUsinas.json();
  assert.deepEqual(
    cadastradas.find((item) => item.id === usina.id).modalidades,
    [{ inicio: "2026-09", modalidade: "GDII" }],
  );
  assert.equal(
    cadastradas.find((item) => item.id === outra.id).modalidade_atual,
    "GDII",
  );
  const usinaFutura = await ok(
    "/usinas",
    "POST",
    {
      nome: "Usina futura",
      localizacao: "Goiás",
      modalidade: "GDI",
      inicio: "2099-01",
    },
    201,
    3,
  );
  const respostaFutura = await fetch(
    `http://127.0.0.1:${server.address().port}/api/admin/usinas`,
    { headers: { Cookie: cookies[3] } },
  );
  const cadastradasComFutura = await respostaFutura.json();
  assert.equal(
    cadastradasComFutura.find((item) => item.id === usinaFutura.id)
      .modalidade_atual,
    null,
  );
  assert.deepEqual(
    cadastradasComFutura.find((item) => item.id === usinaFutura.id).modalidades,
    [{ inicio: "2099-01", modalidade: "GDI" }],
  );
  await ok(
    `/usinas/${usina.id}/modalidades`,
    "POST",
    { versao: 1, modalidade: "GDI", inicio: "2026-10" },
    403,
    2,
  );
  await ok(
    `/usinas/${usina.id}/modalidades`,
    "POST",
    { versao: 1, modalidade: "GDI", inicio: "2026-10" },
    201,
    3,
  );
  await ok(
    `/usinas/${usina.id}/modalidades`,
    "POST",
    { versao: 1, modalidade: "GDI", inicio: "2026-11" },
    409,
    3,
  );
  await ok(
    `/usinas/${usina.id}/modalidades`,
    "POST",
    { versao: 2, modalidade: "GDI", inicio: "2026-10" },
    409,
    3,
  );
  assert.equal(
    banco.prepare("SELECT versao FROM usinas WHERE id=?").get(usina.id).versao,
    2,
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
  const historicas = await lerExcel(
    await arquivo([
      [
        "Cliente histórico",
        "11.222.333/0001-81",
        "000423652401253",
        "historico@example.test",
        10,
        "GDII",
        0.25,
        "2026-09",
      ],
    ]),
  );
  const previaHistorica = prepararImportacao(
    historicas,
    { ...configuracao, usina_id: usinaFutura.id },
    banco,
  );
  assert.equal(previaHistorica.validas, 1);
  const modalidadeIncorreta = await lerExcel(
    await arquivo([[...linha.slice(0, 5), "GDI", ...linha.slice(6)]]),
  );
  const previaIncorreta = prepararImportacao(
    modalidadeIncorreta,
    configuracao,
    banco,
  );
  assert.equal(previaIncorreta.validas, 0);
  assert.match(previaIncorreta.linhas[0].mensagem, /difere da usina/);
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
  const modeloReferencia = new ExcelJS.Workbook(),
    abaReferencia = modeloReferencia.addWorksheet("Set - 26");
  abaReferencia.addRow([
    "USINA",
    "CLIENTE",
    "UC",
    "NOVA UC",
    "ENERGIA INJETADA",
    "VALOR KWH",
    "DESCONTO",
    "TOTAL A PAGAR",
    "JUROS",
    "MULTA",
    "DESCONTO GDII",
    "VALOR DO BOLETO",
  ]);
  abaReferencia.addRow([
    "Usina A",
    "Cliente referência",
    "123456",
    "400000001111",
    1000,
    1.17,
    0.25,
    300,
    0,
    0,
    25,
    1152.5,
  ]);
  const estruturaReferencia = analisarEstruturaMensal(
    await lerExcel(Buffer.from(await modeloReferencia.xlsx.writeBuffer())),
  );
  assert.equal(estruturaReferencia.compativel, true);
  assert.equal(estruturaReferencia.aba, "Set - 26");
  assert.equal(estruturaReferencia.cabecalho, 1);
  assert.equal(estruturaReferencia.linhas_preenchidas, 1);
  assert.equal(estruturaReferencia.linhas_pendentes, 0);
  assert.deepEqual(estruturaReferencia.mapa, {
    nome: 1,
    uc: 3,
    desconto: 6,
  });
  writeFileSync(
    join(
      process.env.ECOSOL_PLANILHAS_DIR,
      "51 - Venda de Energia - Usina Referência 2026.xlsx",
    ),
    Buffer.from(await modeloReferencia.xlsx.writeBuffer()),
  );
  const diagnostico = await ok("/planilhas/pasta/diagnostico");
  assert.equal(diagnostico.total >= 2, true);
  assert.equal(
    diagnostico.itens.some(
      (item) => item.usina === "Referência" && item.compativel,
    ),
    true,
  );
  const antes = banco.prepare("SELECT * FROM faturamento_unidades").get();
  const valido2 = await arquivo([
    [
      "Segundo",
      "52998224725",
      "123456",
      "segundo@example.test",
      15,
      "GDII",
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
  const arquivoFuturo = await arquivo([
    [
      "Cliente futuro",
      "52998224725",
      "888888888888",
      "futuro@example.test",
      10,
      "GDI",
      0.15,
      "2026-11",
    ],
  ]);
  const sessaoFutura = await ok(
    `/planilhas/analisar?nome=futuro.xlsx&usina_id=${usina.id}`,
    "POST",
    arquivoFuturo,
    201,
  );
  const previaFutura = await ok(
    `/planilhas/${sessaoFutura.id}/previa`,
    "POST",
    configuracao,
  );
  assert.equal(previaFutura.validas, 1);
  await ok(
    `/usinas/${usina.id}/modalidades`,
    "POST",
    { versao: 2, modalidade: "GDII", inicio: "2026-11" },
    201,
    3,
  );
  await ok(
    `/planilhas/${sessaoFutura.id}/confirmar`,
    "POST",
    { previa_id: previaFutura.previa_id, confirmado: true },
    409,
  );
  const ucAprovada = Number(
    banco
      .prepare(
        "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento,usina_id) VALUES(?,?,?,?,?,?)",
      )
      .run(
        "999999999999",
        "UC de teste",
        "11222333000181",
        "uc@example.test",
        10,
        outra.id,
      ).lastInsertRowid,
  );
  banco
    .prepare(
      "INSERT INTO faturamento_documentos(hash,nome,pdf,lote,texto,extracao,dados,memoria,unidade_id,competencia,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "hash-usina-aprovada",
      "usina-aprovada.pdf",
      Buffer.from("%PDF-1.4"),
      "teste",
      "",
      "{}",
      "{}",
      JSON.stringify({ contrato: { modalidade: "GDII" } }),
      ucAprovada,
      "2026-10",
      "Aprovada — aguardando emissão",
    );
  await ok(
    `/usinas/${outra.id}/modalidades`,
    "POST",
    { versao: 1, modalidade: "GDI", inicio: "2026-10" },
    409,
    3,
  );
  await ok(
    `/usinas/${outra.id}/modalidades`,
    "POST",
    { versao: 1, modalidade: "GDI", inicio: "2026-11" },
    201,
    3,
  );
  const ucSemUsina = Number(
    banco
      .prepare(
        "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento) VALUES(?,?,?,?,?)",
      )
      .run(
        "900001111",
        "Cliente existente",
        "11222333000181",
        "existente@example.test",
        10,
      ).lastInsertRowid,
  );
  const ucSemAntiga = Number(
    banco
      .prepare(
        "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento,usina_id) VALUES(?,?,?,?,?,?)",
      )
      .run(
        "900005555",
        "Cliente vinculado",
        "11222333000181",
        "vinculado@example.test",
        10,
        usina.id,
      ).lastInsertRowid,
  );
  const ucHistorica = Number(
    banco
      .prepare(
        "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento) VALUES(?,?,?,?,?)",
      )
      .run(
        "900007777",
        "Cliente histórico",
        "11222333000181",
        "historico@example.test",
        10,
      ).lastInsertRowid,
  );
  banco
    .prepare(
      "INSERT INTO faturamento_documentos(hash,nome,pdf,lote,texto,extracao,dados,memoria,unidade_id,competencia,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "hash-aprovada-antes-vigencia",
      "historica.pdf",
      Buffer.from("%PDF-1.4"),
      "teste",
      "",
      "{}",
      "{}",
      JSON.stringify({ contrato: { modalidade: "GDI" } }),
      ucHistorica,
      "2026-09",
      "Aprovada — aguardando emissão",
    );
  const vinculos = new ExcelJS.Workbook();
  const consulta = vinculos.addWorksheet("Consulta");
  consulta.addRow([
    "UC antiga",
    "UC Nova",
    "Cliente",
    "Usina",
    "senha interna",
  ]);
  consulta.addRow([
    "12345",
    "900001111",
    "Cliente existente",
    "Usina A",
    "nao-importar",
  ]);
  consulta.addRow([
    "22222",
    "900002222",
    "Cliente novo",
    "São Francisco",
    "nao-importar",
  ]);
  consulta.addRow([
    "33333",
    "900003333",
    "Outro cliente",
    "2000 Solar DF",
    "nao-importar",
  ]);
  consulta.addRow([
    "44444",
    "900004444",
    "Cliente em outra",
    "Solar Green",
    "nao-importar",
  ]);
  consulta.addRow([
    "",
    "999999999999",
    "UC já vinculada",
    "São Francisco",
    "nao-importar",
  ]);
  consulta.addRow([
    "55555",
    "900005555",
    "Cliente vinculado",
    "Usina A",
    "nao-importar",
  ]);
  consulta.addRow(["66666", "", "Sem UC atual", "Solar Green", "nao-importar"]);
  consulta.addRow([
    "77777",
    "900007777",
    "Cliente histórico",
    "São Francisco",
    "nao-importar",
  ]);
  const bufferVinculos = Buffer.from(await vinculos.xlsx.writeBuffer());
  await ok(
    "/usinas/vinculos/analisar?nome=ucs.xlsx",
    "POST",
    bufferVinculos,
    403,
    2,
  );
  const analiseVinculos = await ok(
    "/usinas/vinculos/analisar?nome=ucs.xlsx",
    "POST",
    bufferVinculos,
    201,
    3,
  );
  assert.equal(analiseVinculos.aba, "Consulta");
  assert.equal(analiseVinculos.linhas, 8);
  assert.equal(JSON.stringify(analiseVinculos).includes("nao-importar"), false);
  assert.equal(
    banco
      .prepare("SELECT linhas FROM usinas_importacoes_vinculos WHERE id=?")
      .get(analiseVinculos.id)
      .linhas.includes("nao-importar"),
    false,
  );
  const nomesVinculos = Object.fromEntries(
    analiseVinculos.nomes.map((item) => [item.chave, item]),
  );
  assert.equal(nomesVinculos.saofrancisco.modalidade_sugerida, "GDII");
  assert.equal(nomesVinculos["2000solardf"].modalidade_sugerida, "GDI");
  const previaVinculos = await ok(
    `/usinas/vinculos/${analiseVinculos.id}/previa`,
    "POST",
    {
      escolhas: {
        usinaa: String(usina.id),
        saofrancisco: "criar",
        "2000solardf": "criar_distinta",
        solargreen: "criar",
      },
    },
    200,
    3,
  );
  assert.equal(previaVinculos.resumo.vincular, 2);
  assert.equal(previaVinculos.resumo.criar_uc, 3);
  assert.equal(previaVinculos.resumo.conferencia, 1);
  assert.equal(previaVinculos.resumo.pendentes, 1);
  assert.equal(previaVinculos.resumo.atualizar_uc_antiga, 1);
  const confirmadaVinculos = await ok(
    `/usinas/vinculos/${analiseVinculos.id}/confirmar`,
    "POST",
    { previa_id: previaVinculos.previa_id, confirmado: true },
    200,
    3,
  );
  assert.equal(confirmadaVinculos.quantidade, 6);
  assert.equal(confirmadaVinculos.usinas_criadas, 3);
  assert.equal(
    banco
      .prepare("SELECT usina_id,uc_antiga FROM faturamento_unidades WHERE id=?")
      .get(ucSemUsina).uc_antiga,
    "12345",
  );
  assert.equal(
    banco
      .prepare("SELECT uc_antiga FROM faturamento_unidades WHERE id=?")
      .get(ucSemAntiga).uc_antiga,
    "55555",
  );
  assert.equal(
    banco
      .prepare("SELECT usina_id FROM faturamento_unidades WHERE id=?")
      .get(ucHistorica).usina_id,
    banco.prepare("SELECT id FROM usinas WHERE nome='São Francisco'").get().id,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT nome,uc_antiga,cliente_provisorio_id FROM faturamento_unidades WHERE uc=?",
      )
      .get("900002222").uc_antiga,
    "22222",
  );
  assert.equal(
    banco
      .prepare("SELECT uc_antiga FROM faturamento_unidades WHERE uc=?")
      .get("999999999999").uc_antiga,
    null,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT modalidade FROM usinas_modalidades WHERE usina_id=(SELECT id FROM usinas WHERE nome='São Francisco')",
      )
      .get().modalidade,
    "GDII",
  );
  assert.equal(
    banco
      .prepare(
        "SELECT modalidade FROM usinas_modalidades WHERE usina_id=(SELECT id FROM usinas WHERE nome='2000 Solar DF')",
      )
      .get().modalidade,
    "GDI",
  );
  const saoFranciscoId = banco
    .prepare("SELECT id FROM usinas WHERE nome='São Francisco'")
    .get().id;
  await ok(
    `/usinas/${saoFranciscoId}`,
    "PATCH",
    { localizacao: "Goiás", versao: 1 },
    403,
    2,
  );
  await ok(
    `/usinas/${saoFranciscoId}`,
    "PATCH",
    { localizacao: "Goiás", versao: 1 },
    200,
    3,
  );
  await ok(
    `/usinas/${saoFranciscoId}`,
    "PATCH",
    { localizacao: "Outra", versao: 1 },
    409,
    3,
  );
  assert.equal(
    banco
      .prepare("SELECT localizacao FROM usinas WHERE id=?")
      .get(saoFranciscoId).localizacao,
    "Goiás",
  );
  assert.equal(
    banco
      .prepare(
        "SELECT usina_id FROM faturamento_unidades WHERE uc='999999999999'",
      )
      .get().usina_id,
    outra.id,
  );
  const repetidaVinculos = await ok(
    `/usinas/vinculos/${analiseVinculos.id}/confirmar`,
    "POST",
    { previa_id: previaVinculos.previa_id, confirmado: true },
    200,
    3,
  );
  assert.equal(repetidaVinculos.ja_concluida, true);
  const idEcosolProvisorio = Number(
    banco
      .prepare("INSERT INTO usinas(nome,localizacao) VALUES(?,?)")
      .run("ecosol", "A confirmar").lastInsertRowid,
  );
  banco
    .prepare(
      "INSERT INTO usinas_modalidades(usina_id,inicio,modalidade) VALUES(?,?,?)",
    )
    .run(idEcosolProvisorio, "2026-10", "GDI");
  assert.equal(
    modalidadeVigenteDaUsina(banco, idEcosolProvisorio, "2026-10"),
    null,
  );
  banco
    .prepare(
      "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento,usina_id) VALUES(?,?,?,?,?,?)",
    )
    .run("900009998", "UC pendente", "", "", 0, idEcosolProvisorio);
  const unidadesComPlaceholder = await ok(
    "/unidades",
    "GET",
    undefined,
    200,
    3,
  );
  assert.deepEqual(
    unidadesComPlaceholder.find((u) => u.uc === "900009998").modalidades_usina,
    [],
  );
  const arquivoEcosol = new ExcelJS.Workbook();
  const abaEcosol = arquivoEcosol.addWorksheet("Consulta");
  abaEcosol.addRow(["UC Nova", "Cliente", "Usina"]);
  abaEcosol.addRow(["900009999", "Cliente provisório", "ECOSOL"]);
  const analiseEcosol = await ok(
    "/usinas/vinculos/analisar?nome=ucs-ecosol.xlsx",
    "POST",
    Buffer.from(await arquivoEcosol.xlsx.writeBuffer()),
    201,
    3,
  );
  assert.equal(analiseEcosol.nomes[0].usina_id_sugerida, null);
  assert.equal(analiseEcosol.nomes[0].modalidade_sugerida, null);
  const previaEcosol = await ok(
    `/usinas/vinculos/${analiseEcosol.id}/previa`,
    "POST",
    { escolhas: {} },
    200,
    3,
  );
  assert.equal(previaEcosol.resumo.pendentes, 1);
  await ok(
    `/usinas/vinculos/${analiseEcosol.id}/previa`,
    "POST",
    { escolhas: { ecosol: String(idEcosolProvisorio) } },
    409,
    3,
  );
  await ok(
    `/usinas/vinculos/${analiseEcosol.id}/previa`,
    "POST",
    { escolhas: { ecosol: "criar" } },
    409,
    3,
  );
  const ucConcorrente = Number(
    banco
      .prepare(
        "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento) VALUES(?,?,?,?,?)",
      )
      .run(
        "900006666",
        "Cliente concorrente",
        "11222333000181",
        "concorrente@example.test",
        10,
      ).lastInsertRowid,
  );
  const arquivoConcorrente = new ExcelJS.Workbook();
  const abaConcorrente = arquivoConcorrente.addWorksheet("UCs");
  abaConcorrente.addRow(["UC", "Cliente", "Usina"]);
  abaConcorrente.addRow(["900006666", "Cliente concorrente", "Nova Solar"]);
  const analiseConcorrente = await ok(
    "/usinas/vinculos/analisar?nome=concorrencia.xlsx",
    "POST",
    Buffer.from(await arquivoConcorrente.xlsx.writeBuffer()),
    201,
    3,
  );
  const previaConcorrente = await ok(
    `/usinas/vinculos/${analiseConcorrente.id}/previa`,
    "POST",
    { escolhas: { novasolar: "criar" } },
    200,
    3,
  );
  banco
    .prepare("UPDATE faturamento_unidades SET versao=versao+1 WHERE id=?")
    .run(ucConcorrente);
  await ok(
    `/usinas/vinculos/${analiseConcorrente.id}/confirmar`,
    "POST",
    { previa_id: previaConcorrente.previa_id, confirmado: true },
    409,
    3,
  );
  assert.equal(
    banco
      .prepare("SELECT COUNT(*) AS total FROM usinas WHERE nome='Nova Solar'")
      .get().total,
    0,
  );
  console.log(
    "OK: Excel por usina, percentuais, cabeçalhos, duplicidades, conflitos, concorrência, confirmação, exportação e preservação da origem.",
  );
} finally {
  await new Promise((r) => server.close(r));
  banco.close();
}
