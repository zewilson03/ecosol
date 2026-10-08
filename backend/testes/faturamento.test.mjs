import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import {
  calcularCobranca,
  documentoValido,
  dataValida,
} from "../servidor/faturamento/regras.mjs";
import {
  extrairCampos,
  extrairUcDoQuadro,
  lerPdf,
} from "../servidor/faturamento/extracao.mjs";
import { prepararFaturamento } from "../servidor/faturamento/esquema.mjs";

const bancoAntigo = new DatabaseSync(":memory:");
try {
  bancoAntigo.exec(`CREATE TABLE faturamento_recebimentos_pdf (
    id INTEGER PRIMARY KEY, hash TEXT, nome TEXT NOT NULL, lote TEXT NOT NULL,
    resultado TEXT NOT NULL, codigo TEXT NOT NULL, motivo TEXT NOT NULL,
    documento_id INTEGER, responsavel TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE faturamento_unidades (
    id INTEGER PRIMARY KEY, uc TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
    documento TEXT NOT NULL, email TEXT NOT NULL, dia_vencimento INTEGER NOT NULL,
    versao INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento)
  VALUES ('123','Teste legado','11222333000181','teste@example.test',10);`);
  bancoAntigo
    .prepare(
      "INSERT INTO faturamento_recebimentos_pdf (nome,lote,resultado,codigo,motivo,responsavel) VALUES (?,?,?,?,?,?)",
    )
    .run("antigo.pdf", "antigo", "Recebida", "ok", "Anterior", "Equipe");
  prepararFaturamento(bancoAntigo);
  prepararFaturamento(bancoAntigo);
  assert.deepEqual(
    bancoAntigo
      .prepare("SELECT nome,origem FROM faturamento_recebimentos_pdf")
      .all()
      .map((r) => ({ ...r })),
    [{ nome: "antigo.pdf", origem: "legado" }],
  );
  assert.equal(
    bancoAntigo
      .prepare("SELECT uc FROM faturamento_unidades WHERE uc='123'")
      .get().uc,
    "123",
  );
  assert.equal(
    bancoAntigo
      .prepare("SELECT cliente_id FROM faturamento_unidades WHERE uc='123'")
      .get().cliente_id,
    null,
  );
  assert.equal(
    bancoAntigo.prepare("SELECT COUNT(*) n FROM faturamento_descontos_uc").get()
      .n,
    0,
  );
  assert.equal(
    bancoAntigo
      .prepare(
        "SELECT cliente_provisorio_id FROM faturamento_unidades WHERE uc='123'",
      )
      .get().cliente_provisorio_id,
    null,
  );
  assert.equal(
    bancoAntigo
      .prepare("SELECT COUNT(*) n FROM faturamento_clientes_provisorios")
      .get().n,
    0,
  );
} finally {
  bancoAntigo.close();
}

process.env.ECOSOL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "ecosol-faturamento-"),
);
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { rotasFaturamento } = await import("../servidor/faturamento/rotas.mjs");
const { receberPdf } = await import("../servidor/faturamento/receberPdf.mjs");
const banco = obterBanco();

// Valores sintéticos dos componentes somam a tarifa confirmada pelo usuário.
const entrada = {
  injecao: "1660",
  unitario: "1.1",
  bandeira: "0.069969",
  desconto: "25",
  total_equatorial: "302.40",
  ajuste_gdii: "290.71",
  modalidade: "GDII",
};
const havilah = calcularCobranca(entrada);
assert.equal(havilah.consumo_centavos, 145661);
assert.equal(havilah.total_centavos, 146830);
assert.equal(
  havilah.total_centavos,
  havilah.consumo_centavos +
    havilah.equatorial_centavos -
    havilah.ajuste_centavos,
);
assert.equal(
  calcularCobranca({ ...entrada, modalidade: "GDI", ajuste_gdii: "0" })
    .total_centavos,
  175901,
);
const semEnergiaInjetada = calcularCobranca({
  injecao: "0",
  unitario: "",
  bandeira: "",
  desconto: "",
  total_equatorial: "128.69",
  ajuste_gdii: "",
  modalidade: "GDI",
});
assert.equal(semEnergiaInjetada.regra, "ecosol-v1-sem-injecao");
assert.equal(semEnergiaInjetada.consumo_centavos, 0);
assert.equal(semEnergiaInjetada.equatorial_centavos, 12869);
assert.equal(semEnergiaInjetada.ajuste_centavos, 0);
assert.equal(semEnergiaInjetada.total_centavos, 12869);
assert.equal(semEnergiaInjetada.entradas.desconto, "0");
assert.equal(
  calcularCobranca({
    ...entrada,
    injecao: "0",
    ajuste_gdii: "0",
  }).total_centavos,
  30240,
);
assert.throws(() =>
  calcularCobranca({
    ...entrada,
    injecao: "0",
    ajuste_gdii: "1",
  }),
);
assert.throws(() =>
  calcularCobranca({
    ...entrada,
    injecao: "0",
    ajuste_gdii: "0",
    total_equatorial: "0",
  }),
);
assert.equal(
  calcularCobranca({
    ...entrada,
    injecao: "1",
    unitario: "1.005",
    bandeira: "0",
    desconto: "0",
    total_equatorial: "0",
    ajuste_gdii: "0",
  }).total_centavos,
  101,
);
for (const invalidos of [
  { bandeira: "" },
  { injecao: "-1" },
  { unitario: "NaN" },
  { desconto: "101" },
  { total_equatorial: "302.401" },
  { modalidade: "GDI" },
  { ajuste_gdii: "99999" },
  { injecao: "1.660,00" },
])
  assert.throws(() => calcularCobranca({ ...entrada, ...invalidos }));
assert.equal(documentoValido("11.222.333/0001-81"), "11222333000181");
assert.equal(documentoValido("529.982.247-25"), "52998224725");
assert.throws(() => documentoValido("11.222.333/0001-82"));
assert.throws(() => dataValida("2026-02-30"));

function pdf(linhas) {
  const conteudo =
    "BT /F1 10 Tf 40 790 Td 14 TL\n" +
    linhas.map((l) => `(${l.replace(/[\\()]/g, "\\$&")}) Tj T*`).join("\n") +
    "\nET";
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(conteudo, "latin1")} >>\nstream\n${conteudo}\nendstream`,
  ];
  let s = "%PDF-1.4\n",
    offsets = [0];
  objetos.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(s, "latin1"));
    s += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(s, "latin1");
  s += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(s, "latin1");
}
const linhas = [
  "NUMERO DA UC",
  "4.236.524.012-52",
  "REF: MES/ANO SET/2026",
  "TOTAL A PAGAR R$ 302,40",
  "VENCIMENTO 28/09/2026",
  "INJECAO SCEE - UC 000418450401297 - GD II 2 kWh 1660,00 0,787589 -1.307,40",
  "PARC INJET S/DESC - 28,57% - UC 000418450401297 - GD II 2 kWh 1660,00 0,175126 290,71",
];
const arquivo = pdf(linhas);
const extraido = await lerPdf(arquivo);
assert.equal(extraido.dados.uc, "423652401252");
assert.equal(extraido.dados.injecao, "1660.00");
assert.equal(extraido.dados.total_equatorial, "302.40");
assert.equal(extraido.dados.ajuste_gdii, "290.71");
assert.equal(extraido.dados.bandeira, undefined);
const tarifaEquatorial = extrairCampos(
  [
    "ADC BANDEIRA AMARELA kWh 100,00 0,024217 2,42",
    "CONSUMO NAO COMPENSADO",
    "kWh 100,00 1,145752 114,58",
    "INJECAO SCEE - UC 000375915701270 - GD I kWh 769,00 0,787589 -605,66",
  ].join("\n"),
);
assert.equal(tarifaEquatorial.dados.unitario, "1.145752");
assert.equal(tarifaEquatorial.dados.bandeira, "0.024217");
const semInjecao = extrairCampos(
  [
    "FORNECIMENTO",
    "ADC BANDEIRA AMARELA kWh 100,00 0,024217 2,42",
    "CONSUMO NAO COMPENSADO kWh 100,00 1,145752 114,58",
    "ITENS FINANCEIROS",
  ].join("\n"),
);
assert.equal(semInjecao.dados.injecao, "0");
assert.deepEqual(semInjecao.qualidade.campos_inferidos, ["Injeção SCEE"]);
assert.ok(!semInjecao.qualidade.pendencias.includes("Injeção SCEE"));
assert.match(semInjecao.evidencias.injecao, /Inferência/);
assert.equal(
  extrairCampos("FORNECIMENTO\nCONSUMO kWh 100,00 1,00 100,00").dados.injecao,
  undefined,
);
assert.equal(
  extrairCampos(
    "FORNECIMENTO\nINJECAO SCEE - UC 123 - GD I\nCONSUMO kWh 100,00 1,00 100,00\nITENS FINANCEIROS",
  ).dados.injecao,
  undefined,
);
assert.equal(
  extrairCampos(
    "FORNECIMENTO\nINJECAO SCEE - UC 123 - GD I kWh 20,00 1,00 -20,00\n" +
      "INJECAO SCEE - UC 456 - GD I kWh 30,00 1,00 -30,00\nITENS FINANCEIROS",
  ).dados.injecao,
  undefined,
);
assert.equal(
  calcularCobranca({
    injecao: "769",
    unitario: tarifaEquatorial.dados.unitario,
    bandeira: tarifaEquatorial.dados.bandeira,
    desconto: "0",
    total_equatorial: "0",
    ajuste_gdii: "0",
    modalidade: "GDI",
  }).tarifa_completa,
  "1.169969",
);
assert.equal(
  extrairCampos("INJECAO SCEE - UC 123 - GD I kWh 769,00 0,787589 -605,66")
    .dados.unitario,
  undefined,
);
assert.equal(
  extrairCampos(
    "CONSUMO NAO COMPENSADO kWh 100,00 1,145752 114,58\n" +
      "CONSUMO NAO COMPENSADO kWh 10,00 1,300000 13,00",
  ).dados.unitario,
  undefined,
);
assert.equal(
  extrairCampos(linhas.concat(linhas.at(-1)).join("\n")).dados.ajuste_gdii,
  undefined,
);
assert.match(extrairCampos("").avisos.join(" "), /sem texto/);
const cabecalhoEquatorial = [
  "PERDAS DE TRANSFORMACAO / RAMAL: 0% 2.903.188.012-00",
  " SET/2026  R$*********137,03   14/10/2026",
  "INFORMACOES DO SCEE: GERACAO KWH: UC 000375915701270",
  "EQUATORIAL GOIAS DISTRIBUIDORA DE ENERGIA S/A 2.903.188.012-00 SET/2026",
].join("\n");
const capturadoEquatorial = extrairCampos(cabecalhoEquatorial);
assert.equal(capturadoEquatorial.dados.uc, "290318801200");
assert.match(capturadoEquatorial.avisos.join(" "), /quadro verde/);
assert.equal(capturadoEquatorial.dados.total_equatorial, "137.03");
assert.equal(capturadoEquatorial.dados.vencimento_equatorial, "2026-10-14");
assert.equal(capturadoEquatorial.dados.competencia, "2026-09");
const itemPdf = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
const itensQuadroVerde = [
  itemPdf("PERDAS DE TRANSFORMAÇÃO / RAMAL: 0%", 18, 1017),
  itemPdf("3.046.242.012-43", 333, 1017),
  itemPdf("INJEÇÃO SCEE - UC 000408047401296 - GD I", 19, 724),
];
const ucQuadroVerde = extrairUcDoQuadro(itensQuadroVerde, 909, 1211);
assert.equal(ucQuadroVerde, "3.046.242.012-43");
const apenasCabecalho =
  "PERDAS DE TRANSFORMACAO / RAMAL: 0% 3.046.242.012-43\n" +
  "INJECAO SCEE - UC 000408047401296 - GD I";
assert.equal(extrairCampos(apenasCabecalho).dados.uc, undefined);
assert.equal(
  extrairCampos(apenasCabecalho, { ucQuadro: ucQuadroVerde }).dados.uc,
  "304624201243",
);
assert.match(
  extrairCampos(apenasCabecalho, { ucQuadro: ucQuadroVerde }).evidencias.uc,
  /Quadro verde/,
);
assert.equal(extrairUcDoQuadro(itensQuadroVerde.slice(1), 909, 1211), null);
assert.equal(
  extrairUcDoQuadro(
    [...itensQuadroVerde, itemPdf("3.046.242.012-44", 335, 1017)],
    909,
    1211,
  ),
  null,
);
const ucsConflitantes = extrairCampos(
  `${apenasCabecalho}\nEQUATORIAL GOIAS DISTRIBUIDORA DE ENERGIA S/A 9.999.999.012-00 SET/2026`,
  { ucQuadro: ucQuadroVerde },
);
assert.equal(ucsConflitantes.dados.uc, undefined);
assert.match(ucsConflitantes.avisos.join(" "), /divergentes/);
assert.equal(
  extrairCampos(
    cabecalhoEquatorial.replace(
      "2.903.188.012-00 SET/2026",
      "9.999.999.012-00 SET/2026",
    ),
  ).dados.uc,
  undefined,
);
assert.equal(
  extrairCampos(
    `${cabecalhoEquatorial}\n OUT/2026  R$*********999,99   15/11/2026`,
  ).dados.total_equatorial,
  undefined,
);

const cookies = {};
for (const nivel of [1, 2, 3]) {
  const staff = Number(
    banco
      .prepare(
        "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,?)",
      )
      .run(
        `Teste ${nivel}`,
        `teste${nivel}@example.test`,
        "nao-utilizado",
        nivel,
      ).lastInsertRowid,
  );
  const token = randomBytes(32).toString("hex");
  banco
    .prepare(
      "INSERT INTO sessions(staff_id,token_hash,role,expires_at) VALUES(?,?,?,?)",
    )
    .run(
      staff,
      createHash("sha256").update(token).digest("hex"),
      "staff",
      Date.now() + 3600000,
    );
  cookies[nivel] = `ecosol_session=${token}`;
}
banco
  .prepare("UPDATE staff_users SET cpf=? WHERE email=?")
  .run("39053344705", "teste1@example.test");
const app = express();
app.use(express.json({ limit: "20kb" }), rotasFaturamento);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/api/admin/faturamento`;
async function chamar(path, nivel = 3, method = "GET", body) {
  return fetch(url + path, {
    method,
    headers: {
      ...(nivel ? { Cookie: cookies[nivel] } : {}),
      "Content-Type": Buffer.isBuffer(body)
        ? "application/pdf"
        : "application/json",
    },
    ...(body !== undefined
      ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }
      : {}),
  });
}
async function ok(path, method, body, status = 200, nivel = 3) {
  const r = await chamar(path, nivel, method, body);
  const b = await r.json();
  assert.equal(r.status, status, JSON.stringify(b));
  return b;
}
const unidade = {
  uc: "423652401252",
  nome: "Havilah de teste",
  documento: "11222333000181",
  email: "cliente@example.test",
  dia_vencimento: 10,
  modalidade: "GDII",
  desconto: "25",
  inicio: "2026-01",
};
const campos = {
  ...extraido.dados,
  modalidade: "GDII",
  unitario: "1.1",
  bandeira: "0.069969",
  origem_tarifa: "propria",
  vencimento_ecosol: "2026-10-10",
};
try {
  assert.equal((await chamar("/documentos", null)).status, 401);
  assert.equal((await chamar("/unidades", 1, "POST", unidade)).status, 403);
  const u = await ok("/unidades", "POST", unidade, 201);
  const clientePortalId = Number(
    banco
      .prepare("INSERT INTO customers(name,cpf,email) VALUES(?,?,?)")
      .run("Cliente do portal", "12345678909", "portal@example.test")
      .lastInsertRowid,
  );
  assert.equal((await chamar("/clientes", null)).status, 401);
  assert.equal(
    (await ok("/clientes", "GET")).find((c) => c.id === clientePortalId).name,
    "Cliente do portal",
  );
  const vinculada = await ok(
    "/unidades",
    "POST",
    {
      ...unidade,
      uc: "123456789012",
      cliente_id: clientePortalId,
    },
    201,
  );
  assert.equal(
    (await ok("/unidades", "GET")).find((item) => item.id === vinculada.id)
      .cliente_nome,
    "Cliente do portal",
  );
  await ok(`/unidades/${vinculada.id}`, "PATCH", {
    ...unidade,
    uc: "123456789012",
    versao: 1,
    cliente_id: "",
  });
  assert.equal(
    banco
      .prepare("SELECT cliente_id FROM faturamento_unidades WHERE id=?")
      .get(vinculada.id).cliente_id,
    null,
  );
  await ok(
    "/unidades",
    "POST",
    {
      ...unidade,
      uc: "123456789013",
      cliente_id: 999999,
    },
    400,
  );
  await ok("/unidades", "POST", unidade, 409);
  const cadastroIntegrado = {
    nome: "Cliente integrado",
    cpf: "52998224725",
    email: "integrado@example.test",
    uc: "987654321000",
    unidade_nome: "Cliente integrado",
    unidade_documento: "52998224725",
    unidade_email: "integrado@example.test",
    dia_vencimento: 5,
    desconto: "25",
    desconto_inicio: "2026-10",
  };
  assert.equal(
    (await chamar("/cadastro-integrado", null, "POST", cadastroIntegrado))
      .status,
    401,
  );
  assert.equal(
    (await chamar("/cadastro-integrado", 1, "POST", cadastroIntegrado)).status,
    403,
  );
  const integrado = await ok(
    "/cadastro-integrado",
    "POST",
    cadastroIntegrado,
    201,
  );
  assert.equal(integrado.estado, "criada");
  assert.equal(
    banco
      .prepare("SELECT cliente_id FROM faturamento_unidades WHERE id=?")
      .get(integrado.unidade_id).cliente_id,
    integrado.cliente_id,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT desconto FROM faturamento_descontos_uc WHERE unidade_id=?",
      )
      .get(integrado.unidade_id).desconto,
    "25",
  );
  banco.exec(`CREATE TEMP TRIGGER impedir_auditoria_cadastro_integrado
    BEFORE INSERT ON faturamento_historico
    WHEN NEW.acao='Cadastro integrado de cliente e UC'
    BEGIN SELECT RAISE(ABORT,'falha simulada'); END`);
  await ok(
    "/cadastro-integrado",
    "POST",
    {
      ...cadastroIntegrado,
      cliente_id: integrado.cliente_id,
      uc: "987654321006",
    },
    500,
  );
  banco.exec("DROP TRIGGER impedir_auditoria_cadastro_integrado");
  assert.equal(
    banco
      .prepare("SELECT id FROM faturamento_unidades WHERE uc='987654321006'")
      .get(),
    undefined,
  );
  const repetido = await ok("/cadastro-integrado", "POST", {
    cliente_id: integrado.cliente_id,
    cpf: cadastroIntegrado.cpf,
    uc: cadastroIntegrado.uc,
  });
  assert.equal(repetido.estado, "ja_vinculada");
  await ok("/cadastro-integrado", "POST", cadastroIntegrado, 409);
  await ok(
    "/cadastro-integrado",
    "POST",
    {
      ...cadastroIntegrado,
      cpf: "39053344705",
      uc: "987654321004",
    },
    409,
  );
  await ok(
    "/cadastro-integrado",
    "POST",
    {
      cliente_id: clientePortalId,
      cpf: "12345678909",
      uc: cadastroIntegrado.uc,
      confirmar_vinculo: true,
    },
    409,
  );
  const semVinculo = await ok(
    "/unidades",
    "POST",
    {
      ...unidade,
      uc: "987654321001",
    },
    201,
  );
  await ok(
    "/cadastro-integrado",
    "POST",
    {
      cliente_id: clientePortalId,
      cpf: "12345678909",
      uc: "987654321001",
    },
    400,
  );
  const vinculoIntegrado = await ok(
    "/cadastro-integrado",
    "POST",
    {
      cliente_id: clientePortalId,
      cpf: "12345678909",
      uc: "987654321001",
      confirmar_vinculo: true,
    },
    201,
  );
  assert.equal(vinculoIntegrado.estado, "vinculada");
  assert.equal(
    banco
      .prepare("SELECT cliente_id FROM faturamento_unidades WHERE id=?")
      .get(semVinculo.id).cliente_id,
    clientePortalId,
  );
  const antigaSemDesconto = Number(
    banco
      .prepare(
        "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento) VALUES(?,?,?,?,?)",
      )
      .run(
        "987654321007",
        "UC legada",
        "11222333000181",
        "legada@example.test",
        7,
      ).lastInsertRowid,
  );
  const completada = await ok(
    "/cadastro-integrado",
    "POST",
    {
      cliente_id: clientePortalId,
      cpf: "12345678909",
      uc: "987654321007",
      confirmar_vinculo: true,
      desconto: "20",
      desconto_inicio: "2026-09",
    },
    201,
  );
  assert.equal(completada.estado, "vinculada");
  assert.equal(
    banco
      .prepare(
        "SELECT desconto FROM faturamento_descontos_uc WHERE unidade_id=?",
      )
      .get(antigaSemDesconto).desconto,
    "20",
  );
  const jaVinculadaSemDesconto = Number(
    banco
      .prepare(
        "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento,cliente_id) VALUES(?,?,?,?,?,?)",
      )
      .run(
        "987654321008",
        "UC legada 2",
        "11222333000181",
        "legada2@example.test",
        8,
        clientePortalId,
      ).lastInsertRowid,
  );
  const descontoAdicionado = await ok(
    "/cadastro-integrado",
    "POST",
    {
      cliente_id: clientePortalId,
      cpf: "12345678909",
      uc: "987654321008",
      desconto: "15",
      desconto_inicio: "2026-09",
    },
    201,
  );
  assert.equal(descontoAdicionado.estado, "desconto_iniciado");
  assert.equal(
    banco
      .prepare("SELECT versao FROM faturamento_unidades WHERE id=?")
      .get(jaVinculadaSemDesconto).versao,
    2,
  );
  await ok(
    "/cadastro-integrado",
    "POST",
    {
      ...cadastroIntegrado,
      cpf: "11144477735",
      uc: "987654321002",
      desconto: "101",
    },
    400,
  );
  assert.equal(
    banco.prepare("SELECT id FROM customers WHERE cpf='11144477735'").get(),
    undefined,
  );
  const ucEncontrada = await ok(
    "/unidades",
    "POST",
    {
      ...unidade,
      uc: "987654321005",
    },
    201,
  );
  const novoClienteComUcExistente = await ok(
    "/cadastro-integrado",
    "POST",
    {
      nome: "Outro cliente integrado",
      cpf: "11144477735",
      email: "outro@example.test",
      uc: "987654321005",
      confirmar_vinculo: true,
    },
    201,
  );
  assert.equal(novoClienteComUcExistente.estado, "vinculada");
  assert.equal(novoClienteComUcExistente.unidade_id, ucEncontrada.id);
  assert.equal(
    banco
      .prepare("SELECT cliente_id FROM faturamento_unidades WHERE id=?")
      .get(ucEncontrada.id).cliente_id,
    novoClienteComUcExistente.cliente_id,
  );
  const concorrente = await ok(
    "/unidades",
    "POST",
    {
      ...unidade,
      uc: "987654321003",
    },
    201,
  );
  const disputas = await Promise.all([
    chamar("/cadastro-integrado", 2, "POST", {
      cliente_id: clientePortalId,
      cpf: "12345678909",
      uc: "987654321003",
      confirmar_vinculo: true,
    }),
    chamar("/cadastro-integrado", 2, "POST", {
      cliente_id: integrado.cliente_id,
      cpf: cadastroIntegrado.cpf,
      uc: "987654321003",
      confirmar_vinculo: true,
    }),
  ]);
  assert.deepEqual(
    disputas.map((resposta) => resposta.status).sort(),
    [201, 409],
  );
  assert.ok(
    [clientePortalId, integrado.cliente_id].includes(
      banco
        .prepare("SELECT cliente_id FROM faturamento_unidades WHERE id=?")
        .get(concorrente.id).cliente_id,
    ),
  );
  assert.equal(
    (await chamar("/documentos?lote=teste&nome=a.pdf", 1, "POST", arquivo))
      .status,
    403,
  );
  await ok(
    "/documentos?lote=teste&nome=a.pdf",
    "POST",
    Buffer.from("nao e pdf"),
    400,
  );
  let d = await ok("/documentos?lote=teste&nome=a.pdf", "POST", arquivo, 201);
  await ok(`/unidades/${vinculada.id}`, "PATCH", {
    ...unidade,
    uc: "123456789012",
    cliente_id: clientePortalId,
    versao: 2,
  });
  assert.ok(
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM faturamento_unidades WHERE cliente_id=?",
      )
      .get(clientePortalId).n >= 2,
  );
  const dadosVinculados = {
    ...campos,
    uc: "123456789012",
    unidade_id: String(vinculada.id),
    cliente_id: String(clientePortalId),
  };
  await ok(
    `/documentos/${d.id}/previa`,
    "POST",
    {
      versao: d.versao,
      dados: dadosVinculados,
    },
    400,
  );
  await ok(`/documentos/${d.id}/previa`, "POST", {
    versao: d.versao,
    dados: { ...dadosVinculados, uc_divergente_confirmada: "sim" },
  });
  await ok(
    `/documentos/${d.id}/previa`,
    "POST",
    {
      versao: d.versao,
      dados: {
        ...dadosVinculados,
        cliente_id: "999999",
        uc_divergente_confirmada: "sim",
      },
    },
    400,
  );
  await ok("/documentos?lote=teste&nome=a.pdf", "POST", arquivo, 409);
  const recebimentos = await ok("/recebimentos");
  assert.deepEqual(
    recebimentos.slice(0, 3).map((r) => r.codigo),
    ["duplicada", "ok", "invalida"],
  );
  assert.match(recebimentos[0].motivo, /já foi recebida/);
  assert.equal(recebimentos[0].resultado, "Erro");
  assert.equal(recebimentos[1].documento_id, d.id);
  assert.ok(recebimentos.slice(0, 3).every((r) => r.origem === "manual"));

  const renomearPdf = pdf([...linhas, "ARQUIVO PARA RENOMEAR"]);
  const documentoRenomeavel = await ok(
    "/documentos?lote=teste&nome=original.pdf",
    "POST",
    renomearPdf,
    201,
  );
  const rotaRenomear = `/documentos/${documentoRenomeavel.id}/renomear`;
  const novoNome = {
    versao: documentoRenomeavel.versao,
    nome: "Conta setembro - João.pdf",
  };
  assert.equal(
    (await chamar(rotaRenomear, null, "POST", novoNome)).status,
    401,
  );
  assert.equal((await chamar(rotaRenomear, 1, "POST", novoNome)).status, 403);
  for (const invalido of [
    "",
    "../fatura.pdf",
    "CON.pdf",
    "fatura.txt",
    "a?.pdf",
  ])
    await ok(rotaRenomear, "POST", { ...novoNome, nome: invalido }, 400);
  await ok(rotaRenomear, "POST", { ...novoNome, versao: 99 }, 409);
  banco.exec(`CREATE TEMP TRIGGER impedir_auditoria_nome
    BEFORE INSERT ON faturamento_historico
    WHEN NEW.documento_id=${documentoRenomeavel.id} AND NEW.acao='PDF renomeado'
    BEGIN SELECT RAISE(ABORT,'falha simulada'); END`);
  await ok(rotaRenomear, "POST", novoNome, 500);
  banco.exec("DROP TRIGGER impedir_auditoria_nome");
  assert.equal(
    banco
      .prepare("SELECT nome FROM faturamento_documentos WHERE id=?")
      .get(documentoRenomeavel.id).nome,
    "original.pdf",
  );
  const documentoRenomeado = await ok(rotaRenomear, "POST", novoNome);
  assert.equal(documentoRenomeado.nome, "Conta setembro - João.pdf");
  assert.equal(documentoRenomeado.versao, documentoRenomeavel.versao + 1);
  assert.deepEqual(
    Buffer.from(
      banco
        .prepare("SELECT pdf FROM faturamento_documentos WHERE id=?")
        .get(documentoRenomeavel.id).pdf,
    ),
    renomearPdf,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT nome FROM faturamento_recebimentos_pdf WHERE documento_id=?",
      )
      .get(documentoRenomeavel.id).nome,
    "original.pdf",
  );
  assert.equal(
    (await ok("/recebimentos")).find(
      (r) => r.documento_id === documentoRenomeavel.id,
    ).nome,
    "Conta setembro - João.pdf",
  );
  const pdfRenomeado = await chamar(
    `/documentos/${documentoRenomeavel.id}/pdf`,
  );
  assert.match(
    pdfRenomeado.headers.get("content-disposition") ?? "",
    /filename="Conta setembro - Joao\.pdf"; filename\*=UTF-8''Conta%20setembro%20-%20Jo%C3%A3o\.pdf/,
  );
  assert.deepEqual(Buffer.from(await pdfRenomeado.arrayBuffer()), renomearPdf);
  await ok(rotaRenomear, "POST", novoNome, 409);
  const semAlteracao = await ok(rotaRenomear, "POST", {
    versao: documentoRenomeado.versao,
    nome: documentoRenomeado.nome,
  });
  assert.equal(semAlteracao.versao, documentoRenomeado.versao);
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) n FROM faturamento_historico WHERE documento_id=? AND acao='PDF renomeado'",
      )
      .get(documentoRenomeavel.id).n,
    1,
  );

  const atorGmail = { id: null, nome: "Integração Gmail" };
  const entradaGmail = (arquivo, nome) => ({
    arquivo,
    nome,
    lote: "gmail-teste",
    ator: atorGmail,
    origem: "gmail",
  });
  const duplicataGmail = await receberPdf(
    entradaGmail(arquivo, "repetida.pdf"),
  );
  assert.deepEqual(duplicataGmail, {
    tipo: "duplicado",
    documentoId: d.id,
  });
  const duplicataRegistrada = banco
    .prepare(
      "SELECT origem,resultado,codigo,documento_id FROM faturamento_recebimentos_pdf ORDER BY id DESC LIMIT 1",
    )
    .get();
  assert.deepEqual(
    { ...duplicataRegistrada },
    {
      origem: "gmail",
      resultado: "Duplicada",
      codigo: "duplicada",
      documento_id: d.id,
    },
  );

  const pdfGmail = pdf([...linhas, "ARQUIVO DA INTEGRACAO"]);
  const novoGmail = await receberPdf(entradaGmail(pdfGmail, "gmail.pdf"));
  assert.equal(novoGmail.tipo, "novo");
  assert.equal(
    banco
      .prepare("SELECT status FROM faturamento_documentos WHERE id=?")
      .get(novoGmail.documentoId).status,
    "Pendente de revisão",
  );
  assert.equal(
    banco
      .prepare(
        "SELECT origem,responsavel FROM faturamento_recebimentos_pdf WHERE documento_id=?",
      )
      .get(novoGmail.documentoId).origem,
    "gmail",
  );

  const termoPdf = pdf(["TERMO DE RECEBIMENTO DE FATURA POR E-MAIL"]);
  const termo = await receberPdf(entradaGmail(termoPdf, "termo.pdf"));
  assert.equal(termo.tipo, "novo");
  const excluirTermo = `/documentos/${termo.documentoId}/excluir`;
  const confirmacaoExclusao = { versao: 1, confirmacao: "EXCLUIR" };
  assert.equal(
    (await chamar(excluirTermo, 2, "POST", confirmacaoExclusao)).status,
    403,
  );
  await ok(excluirTermo, "POST", { versao: 1 }, 400);
  await ok(excluirTermo, "POST", { ...confirmacaoExclusao, versao: 2 }, 409);
  banco.exec(`CREATE TEMP TRIGGER impedir_auditoria_exclusao
    BEFORE INSERT ON faturamento_historico
    WHEN NEW.documento_id=${termo.documentoId}
      AND NEW.acao='Exclusão definitiva de PDF em Faturas'
    BEGIN SELECT RAISE(ABORT,'falha simulada'); END`);
  await ok(excluirTermo, "POST", confirmacaoExclusao, 500);
  banco.exec("DROP TRIGGER impedir_auditoria_exclusao");
  assert.equal(
    banco
      .prepare(
        "SELECT length(pdf) tamanho FROM faturamento_documentos WHERE id=?",
      )
      .get(termo.documentoId).tamanho,
    termoPdf.length,
  );
  assert.deepEqual(await ok(excluirTermo, "POST", confirmacaoExclusao), {
    excluido: true,
  });
  const termoExcluido = banco
    .prepare(
      "SELECT length(pdf) tamanho,texto,extracao,dados,classificacao,excluido_em,versao FROM faturamento_documentos WHERE id=?",
    )
    .get(termo.documentoId);
  assert.equal(termoExcluido.tamanho, 0);
  assert.equal(termoExcluido.texto, "");
  assert.equal(termoExcluido.extracao, "{}");
  assert.equal(termoExcluido.dados, "{}");
  assert.equal(termoExcluido.classificacao, "nao_fatura");
  assert.ok(termoExcluido.excluido_em);
  assert.equal(termoExcluido.versao, 2);
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) n FROM faturamento_historico WHERE documento_id=? AND acao='Exclusão definitiva de PDF em Faturas'",
      )
      .get(termo.documentoId).n,
    1,
  );
  assert.ok(
    !(await ok("/documentos")).some((item) => item.id === termo.documentoId),
  );
  assert.ok(
    !(await ok("/recebimentos")).some(
      (item) => item.documento_id === termo.documentoId,
    ),
  );
  for (const caminho of [
    `/documentos/${termo.documentoId}`,
    `/documentos/${termo.documentoId}/pdf`,
  ])
    assert.equal((await chamar(caminho)).status, 404);
  await ok(excluirTermo, "POST", confirmacaoExclusao, 404);
  assert.equal(
    (await receberPdf(entradaGmail(termoPdf, "termo-repetido.pdf"))).tipo,
    "duplicado",
  );

  await ok(
    "/unidades",
    "POST",
    { ...unidade, uc: "303025501263", nome: "UC sem injeção" },
    201,
  );
  const semInjecaoPdf = pdf([
    "NUMERO DA UC",
    "3.030.255.012-63",
    "REF: MES/ANO SET/2026",
    "TOTAL A PAGAR R$ 128,69",
    "VENCIMENTO 13/10/2026",
    "FORNECIMENTO",
    "ADC BANDEIRA AMARELA kWh 100,00 0,024217 2,42",
    "VL MIN FAT CUSTO DISP kWh 100,00 1,145752 114,58",
    "ITENS FINANCEIROS",
    "CONTRIB. ILUM. PUBLICA - MUNICIPAL 11,69",
  ]);
  let faturaSemInjecao = await ok(
    "/documentos?lote=sem-injecao&nome=sem-injecao.pdf",
    "POST",
    semInjecaoPdf,
    201,
  );
  assert.equal(faturaSemInjecao.dados.injecao, "0");
  assert.equal(faturaSemInjecao.dados.unitario, undefined);
  const dadosSemInjecao = {
    ...faturaSemInjecao.dados,
    modalidade: "GDI",
    ajuste_gdii: "",
    vencimento_ecosol: "",
  };
  await ok(
    `/documentos/${faturaSemInjecao.id}/previa`,
    "POST",
    {
      versao: faturaSemInjecao.versao,
      dados: { ...dadosSemInjecao, ajuste_gdii: "1" },
    },
    400,
  );
  faturaSemInjecao = await ok(`/documentos/${faturaSemInjecao.id}`, "PATCH", {
    versao: faturaSemInjecao.versao,
    dados: dadosSemInjecao,
  });
  assert.equal(faturaSemInjecao.dados.vencimento_ecosol, "");
  const previaSemInjecao = await ok(
    `/documentos/${faturaSemInjecao.id}/previa`,
    "POST",
    { versao: faturaSemInjecao.versao, dados: dadosSemInjecao },
  );
  assert.equal(previaSemInjecao.memoria.total_centavos, 12869);
  assert.equal(previaSemInjecao.memoria.consumo_centavos, 0);
  assert.equal(previaSemInjecao.memoria.entradas.desconto, "0");
  assert.equal(
    previaSemInjecao.memoria.contrato.origem,
    "sem_injecao_sem_desconto",
  );
  assert.equal(previaSemInjecao.memoria.fonte.tipo, "nao_aplicavel");
  assert.equal(
    previaSemInjecao.memoria.vencimento_ecosol,
    faturaSemInjecao.dados.vencimento_equatorial,
  );
  assert.match(previaSemInjecao.hash, /^[a-f0-9]{64}$/);
  faturaSemInjecao = await ok(
    `/documentos/${faturaSemInjecao.id}/calcular`,
    "POST",
    {
      versao: faturaSemInjecao.versao,
      conferido: true,
    },
  );
  assert.equal(faturaSemInjecao.memoria.total_centavos, 12869);
  assert.equal(
    faturaSemInjecao.dados.vencimento_ecosol,
    faturaSemInjecao.dados.vencimento_equatorial,
  );
  faturaSemInjecao = await ok(
    `/documentos/${faturaSemInjecao.id}/aprovar`,
    "POST",
    { versao: faturaSemInjecao.versao },
  );
  assert.match(faturaSemInjecao.status, /aguardando emissão/);

  const clienteProvisorioId = Number(
    banco
      .prepare(
        "INSERT INTO faturamento_clientes_provisorios(nome,chave_origem,origem) VALUES (?,?,?)",
      )
      .run("Cliente para conferência", "teste-provisorio-1", "Teste")
      .lastInsertRowid,
  );
  banco
    .prepare(
      "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento,cliente_provisorio_id) VALUES (?,?,?,?,?,?)",
    )
    .run("999888777666", "UC para conferência", "", "", 0, clienteProvisorioId);
  assert.equal(
    (await ok("/clientes-provisorios", "GET")).find(
      (item) => item.id === clienteProvisorioId,
    ).unidades,
    1,
  );
  assert.equal(
    (await ok("/unidades", "GET")).find((item) => item.uc === "999888777666")
      .cliente_nome,
    "Cliente para conferência",
  );
  const pdfProvisorio = pdf([
    "NUMERO DA UC",
    "999.888.777-666",
    "REF: MES/ANO SET/2026",
    "TOTAL A PAGAR R$ 128,69",
    "VENCIMENTO 13/10/2026",
  ]);
  const faturaProvisoria = await ok(
    "/documentos?lote=provisorio&nome=provisorio.pdf",
    "POST",
    pdfProvisorio,
    201,
  );
  await ok(
    `/documentos/${faturaProvisoria.id}/previa`,
    "POST",
    {
      versao: faturaProvisoria.versao,
      dados: { ...faturaProvisoria.dados, modalidade: "GDI", injecao: "0" },
    },
    409,
  );

  const acessoInicial = await receberPdf({
    arquivo: pdf([...linhas, "ACESSO INICIAL"]),
    nome: "inicial.pdf",
    lote: "teste",
    ator: { id: null, nome: "Acesso inicial" },
    origem: "manual",
  });
  assert.equal(acessoInicial.tipo, "novo");
  assert.equal(
    banco
      .prepare(
        "SELECT administrador_id,responsavel FROM faturamento_historico WHERE documento_id=?",
      )
      .get(acessoInicial.documentoId).administrador_id,
    null,
  );

  const pdfConcorrente = pdf([...linhas, "DUAS ENTRADAS CONCORRENTES"]);
  const concorrentes = await Promise.all([
    receberPdf(entradaGmail(pdfConcorrente, "concorrente-gmail.pdf")),
    receberPdf({
      arquivo: pdfConcorrente,
      nome: "concorrente-manual.pdf",
      lote: "teste",
      ator: { id: 1, nome: "Teste 1" },
      origem: "manual",
    }),
  ]);
  assert.deepEqual(concorrentes.map((r) => r.tipo).sort(), [
    "duplicado",
    "novo",
  ]);
  assert.equal(concorrentes[0].documentoId, concorrentes[1].documentoId);
  const hashConcorrente = createHash("sha256")
    .update(pdfConcorrente)
    .digest("hex");
  assert.equal(
    banco
      .prepare("SELECT COUNT(*) AS n FROM faturamento_documentos WHERE hash=?")
      .get(hashConcorrente).n,
    1,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM faturamento_recebimentos_pdf WHERE hash=?",
      )
      .get(hashConcorrente).n,
    2,
  );

  const grande = Buffer.alloc(10 * 1024 * 1024 + 1);
  grande.write("%PDF-");
  await assert.rejects(
    receberPdf(entradaGmail(grande, "grande.pdf")),
    (erro) => erro.status === 400,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT codigo FROM faturamento_recebimentos_pdf ORDER BY id DESC LIMIT 1",
      )
      .get().codigo,
    "invalida",
  );

  const pdfFalha = pdf([...linhas, "FALHA DE AUDITORIA"]);
  const hashFalha = createHash("sha256").update(pdfFalha).digest("hex");
  banco.exec(`CREATE TRIGGER rejeitar_historico_pdf
    BEFORE INSERT ON faturamento_historico
    WHEN NEW.acao='Importação de PDF'
    BEGIN SELECT RAISE(ABORT, 'falha de auditoria'); END`);
  try {
    await assert.rejects(receberPdf(entradaGmail(pdfFalha, "falha.pdf")));
  } finally {
    banco.exec("DROP TRIGGER rejeitar_historico_pdf");
  }
  assert.equal(
    banco
      .prepare("SELECT COUNT(*) AS n FROM faturamento_documentos WHERE hash=?")
      .get(hashFalha).n,
    0,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM faturamento_recebimentos_pdf WHERE hash=?",
      )
      .get(hashFalha).n,
    0,
  );

  assert.equal((await chamar(`/documentos/${d.id}/pdf`, null)).status, 401);
  for (const nivel of [1, 2, 3]) {
    const visualizacao = await chamar(`/documentos/${d.id}/pdf`, nivel);
    assert.equal(visualizacao.status, 200);
    assert.equal(visualizacao.headers.get("content-type"), "application/pdf");
    assert.match(
      visualizacao.headers.get("content-disposition") ?? "",
      /^inline; filename="a\.pdf"; filename\*=UTF-8''a\.pdf$/,
    );
    assert.equal(visualizacao.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.equal(visualizacao.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await visualizacao.arrayBuffer()), arquivo);
  }
  const antesDaPrevia = banco
    .prepare(
      "SELECT versao,dados,memoria,status FROM faturamento_documentos WHERE id=?",
    )
    .get(d.id);
  const historicoAntesDaPrevia = banco
    .prepare(
      "SELECT COUNT(*) n FROM faturamento_historico WHERE documento_id=?",
    )
    .get(d.id).n;
  assert.equal(
    (
      await chamar(`/documentos/${d.id}/previa`, null, "POST", {
        versao: d.versao,
        dados: campos,
      })
    ).status,
    401,
  );
  const previa = await ok(
    `/documentos/${d.id}/previa`,
    "POST",
    { versao: d.versao, dados: campos },
    200,
    1,
  );
  assert.equal(previa.memoria.total_centavos, 146830);
  assert.equal(previa.memoria.vencimento_ecosol, campos.vencimento_ecosol);
  assert.equal(previa.memoria.tarifa_completa, "1.169969");
  assert.match(previa.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    banco
      .prepare(
        "SELECT versao,dados,memoria,status FROM faturamento_documentos WHERE id=?",
      )
      .get(d.id),
    antesDaPrevia,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) n FROM faturamento_historico WHERE documento_id=?",
      )
      .get(d.id).n,
    historicoAntesDaPrevia,
  );
  await ok(
    `/documentos/${d.id}/previa`,
    "POST",
    { versao: d.versao + 1, dados: campos },
    409,
  );
  await ok(
    `/documentos/${d.id}/previa`,
    "POST",
    { versao: d.versao, dados: { ...campos, unitario: "" } },
    400,
  );
  await ok(
    `/documentos/${d.id}/previa`,
    "POST",
    { versao: d.versao, dados: { ...campos, vencimento_ecosol: "2026-02-30" } },
    400,
  );
  await ok(
    `/documentos/${d.id}/previa`,
    "POST",
    {
      versao: d.versao,
      dados: { ...campos, vencimento_equatorial: "", vencimento_ecosol: "" },
    },
    400,
  );
  await ok(`/documentos/${d.id}/calcular`, "POST", { versao: d.versao }, 400);
  await ok(
    `/documentos/${d.id}/calcular`,
    "POST",
    {
      versao: d.versao,
      conferido: true,
      dados: campos,
      previa_hash: previa.hash,
    },
    403,
    1,
  );
  await ok(
    `/documentos/${d.id}/calcular`,
    "POST",
    { versao: d.versao, conferido: true, dados: campos },
    409,
  );
  await ok(
    `/documentos/${d.id}/calcular`,
    "POST",
    {
      versao: d.versao,
      conferido: true,
      dados: campos,
      previa_hash: "0".repeat(64),
    },
    409,
  );
  assert.deepEqual(
    banco
      .prepare(
        "SELECT versao,dados,memoria,status FROM faturamento_documentos WHERE id=?",
      )
      .get(d.id),
    antesDaPrevia,
  );
  d = await ok(`/documentos/${d.id}/calcular`, "POST", {
    versao: d.versao,
    conferido: true,
    dados: campos,
    previa_hash: previa.hash,
  });
  await ok(
    `/documentos/${d.id}/excluir`,
    "POST",
    { versao: d.versao, confirmacao: "EXCLUIR" },
    409,
  );
  assert.equal(d.memoria.total_centavos, 146830);
  assert.deepEqual(d.memoria, previa.memoria);
  assert.equal(d.versao, antesDaPrevia.versao + 1);
  await ok(`/documentos/${d.id}`, "PATCH", { versao: 1, dados: campos }, 409);
  await ok(`/documentos/${d.id}/aprovar`, "POST", { versao: d.versao }, 403, 2);
  await ok(`/unidades/${u.id}`, "PATCH", {
    ...unidade,
    nome: "Havilah atualizado",
    versao: 1,
  });
  await ok(`/documentos/${d.id}/aprovar`, "POST", { versao: d.versao }, 409);
  d = await ok(`/documentos/${d.id}/calcular`, "POST", {
    versao: d.versao,
    conferido: true,
  });
  d = await ok(`/documentos/${d.id}/aprovar`, "POST", { versao: d.versao });
  assert.match(d.status, /aguardando emissão/);
  await ok(
    `/documentos/${d.id}/renomear`,
    "POST",
    { versao: d.versao, nome: "Aprovada.pdf" },
    409,
  );
  await ok(
    `/documentos/${d.id}/excluir`,
    "POST",
    { versao: d.versao, confirmacao: "EXCLUIR" },
    409,
  );
  await ok(
    `/documentos/${d.id}`,
    "PATCH",
    { versao: d.versao, dados: campos },
    409,
  );
  await ok(
    `/unidades/${u.id}/contratos`,
    "POST",
    { inicio: "2026-08", modalidade: "GDII", desconto: "30" },
    409,
  );
  await ok(
    `/unidades/${u.id}/contratos`,
    "POST",
    { inicio: "2026-10", modalidade: "GDII", desconto: "30" },
    201,
  );
  await ok(
    `/unidades/${u.id}/descontos`,
    "POST",
    { inicio: "2026-10", desconto: "30", versao: 2 },
    201,
  );
  let repetida = await ok(
    "/documentos?lote=teste&nome=outra.pdf",
    "POST",
    pdf([...linhas, "Segunda via"]),
    201,
  );
  repetida = await ok(`/documentos/${repetida.id}`, "PATCH", {
    versao: repetida.versao,
    dados: campos,
  });
  await ok(
    `/documentos/${repetida.id}/calcular`,
    "POST",
    { versao: repetida.versao, conferido: true },
    409,
  );
  await ok(
    "/unidades",
    "POST",
    { ...unidade, uc: "12345", modalidade: "GDI", desconto: "15" },
    201,
  );
  let gdi = await ok(
    "/documentos?lote=teste&nome=gdi.pdf",
    "POST",
    pdf(["GDI de referencia"]),
    201,
  );
  const dadosGdi = {
    ...campos,
    uc: "12345",
    ajuste_gdii: "0",
    modalidade: "GDI",
  };
  gdi = await ok(`/documentos/${gdi.id}`, "PATCH", {
    versao: gdi.versao,
    dados: dadosGdi,
  });
  gdi = await ok(`/documentos/${gdi.id}/calcular`, "POST", {
    versao: gdi.versao,
    conferido: true,
  });
  let futuro = await ok(
    "/documentos?lote=teste&nome=outubro.pdf",
    "POST",
    pdf(["GDII outubro"]),
    201,
  );
  const futuroDados = {
    ...campos,
    competencia: "2026-10",
    origem_tarifa: "referencia",
    referencia_id: String(gdi.id),
  };
  futuro = await ok(`/documentos/${futuro.id}`, "PATCH", {
    versao: futuro.versao,
    dados: futuroDados,
  });
  await ok(
    `/documentos/${futuro.id}/calcular`,
    "POST",
    { versao: futuro.versao, conferido: true },
    400,
  );
  gdi = await ok(`/documentos/${gdi.id}/aprovar`, "POST", {
    versao: gdi.versao,
  });
  futuro = await ok(`/documentos/${futuro.id}/calcular`, "POST", {
    versao: futuro.versao,
    conferido: true,
  });
  assert.equal(futuro.memoria.contrato.desconto, "30");
  assert.equal(futuro.memoria.fonte.documento_id, gdi.id);
  assert.equal(futuro.memoria.tarifa_completa, "1.169969");
  let outroLote = await ok(
    "/documentos?lote=outro&nome=outro.pdf",
    "POST",
    pdf(["Outro lote"]),
    201,
  );
  outroLote = await ok(`/documentos/${outroLote.id}`, "PATCH", {
    versao: outroLote.versao,
    dados: futuroDados,
  });
  await ok(
    `/documentos/${outroLote.id}/calcular`,
    "POST",
    { versao: outroLote.versao, conferido: true },
    400,
  );
  const { modalidade: _modalidade, inicio: _inicio, ...dadosUc } = unidade;
  await ok(
    "/unidades",
    "POST",
    {
      ...dadosUc,
      uc: "987654321",
      desconto_inicio: "2026-01",
      modalidade: "GDI",
    },
    400,
  );
  const ucSemContrato = await ok(
    "/unidades",
    "POST",
    { ...dadosUc, uc: "987654321", desconto_inicio: "2026-01" },
    201,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) n FROM faturamento_contratos WHERE unidade_id=?",
      )
      .get(ucSemContrato.id).n,
    0,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT desconto FROM faturamento_descontos_uc WHERE unidade_id=?",
      )
      .get(ucSemContrato.id).desconto,
    "25",
  );
  await ok(
    `/unidades/${ucSemContrato.id}/descontos`,
    "POST",
    {
      desconto: "101",
      inicio: "2026-09",
      versao: 1,
    },
    400,
  );
  await ok(
    `/unidades/${ucSemContrato.id}/descontos`,
    "POST",
    { desconto: "30", inicio: "2026-09", versao: 1 },
    403,
    2,
  );
  await ok(
    `/unidades/${ucSemContrato.id}/descontos`,
    "POST",
    { desconto: "20", inicio: "2026-01", versao: 1 },
    409,
  );
  let manual = await ok(
    "/documentos?lote=manual&nome=manual.pdf",
    "POST",
    pdf(["Fatura com modalidade manual e desconto da UC"]),
    201,
  );
  const camposManuais = { ...campos, uc: "987654321", modalidade: "" };
  manual = await ok(`/documentos/${manual.id}`, "PATCH", {
    versao: manual.versao,
    dados: camposManuais,
  });
  await ok(
    `/documentos/${manual.id}/calcular`,
    "POST",
    {
      versao: manual.versao,
      conferido: true,
    },
    400,
  );
  manual = await ok(`/documentos/${manual.id}`, "PATCH", {
    versao: manual.versao,
    dados: { ...camposManuais, modalidade: "DESCONHECIDA" },
  });
  await ok(
    `/documentos/${manual.id}/calcular`,
    "POST",
    { versao: manual.versao, conferido: true },
    400,
  );
  manual = await ok(`/documentos/${manual.id}`, "PATCH", {
    versao: manual.versao,
    dados: { ...camposManuais, modalidade: "GDII" },
  });
  manual = await ok(`/documentos/${manual.id}/calcular`, "POST", {
    versao: manual.versao,
    conferido: true,
  });
  assert.equal(manual.memoria.total_centavos, 146830);
  assert.equal(
    manual.memoria.contrato.origem,
    "modalidade_na_fatura_desconto_na_uc",
  );
  assert.equal(manual.memoria.contrato.modalidade, "GDII");
  assert.equal(manual.memoria.contrato.desconto, "25");
  const previaAntesDoDesconto = await ok(
    `/documentos/${manual.id}/previa`,
    "POST",
    { versao: manual.versao, dados: manual.dados },
  );
  await ok(
    `/unidades/${ucSemContrato.id}/descontos`,
    "POST",
    {
      desconto: "30",
      inicio: "2026-09",
      versao: 1,
    },
    201,
  );
  await ok(
    `/unidades/${ucSemContrato.id}/descontos`,
    "POST",
    { desconto: "35", inicio: "2026-10", versao: 1 },
    409,
  );
  await ok(
    `/documentos/${manual.id}/aprovar`,
    "POST",
    {
      versao: manual.versao,
    },
    409,
  );
  const antesDaMudanca = banco
    .prepare(
      "SELECT versao,dados,memoria,status FROM faturamento_documentos WHERE id=?",
    )
    .get(manual.id);
  await ok(
    `/documentos/${manual.id}/calcular`,
    "POST",
    {
      versao: manual.versao,
      conferido: true,
      dados: manual.dados,
      previa_hash: previaAntesDoDesconto.hash,
    },
    409,
  );
  assert.deepEqual(
    banco
      .prepare(
        "SELECT versao,dados,memoria,status FROM faturamento_documentos WHERE id=?",
      )
      .get(manual.id),
    antesDaMudanca,
  );
  const previaDepoisDoDesconto = await ok(
    `/documentos/${manual.id}/previa`,
    "POST",
    { versao: manual.versao, dados: manual.dados },
  );
  assert.equal(previaDepoisDoDesconto.memoria.contrato.desconto, "30");
  banco.exec(`CREATE TEMP TRIGGER impedir_auditoria_calculo
    BEFORE INSERT ON faturamento_historico
    WHEN NEW.documento_id=${manual.id} AND NEW.acao='Cálculo conferido'
    BEGIN SELECT RAISE(ABORT,'falha simulada'); END`);
  await ok(
    `/documentos/${manual.id}/calcular`,
    "POST",
    {
      versao: manual.versao,
      conferido: true,
      dados: manual.dados,
      previa_hash: previaDepoisDoDesconto.hash,
    },
    500,
  );
  banco.exec("DROP TRIGGER impedir_auditoria_calculo");
  assert.deepEqual(
    banco
      .prepare(
        "SELECT versao,dados,memoria,status FROM faturamento_documentos WHERE id=?",
      )
      .get(manual.id),
    antesDaMudanca,
  );
  manual = await ok(`/documentos/${manual.id}/calcular`, "POST", {
    versao: manual.versao,
    conferido: true,
    dados: manual.dados,
    previa_hash: previaDepoisDoDesconto.hash,
  });
  assert.equal(manual.memoria.contrato.desconto, "30");
  manual = await ok(`/documentos/${manual.id}/aprovar`, "POST", {
    versao: manual.versao,
  });
  assert.match(manual.status, /aguardando emissão/);
  await ok(
    `/unidades/${ucSemContrato.id}/descontos`,
    "POST",
    {
      desconto: "35",
      inicio: "2026-08",
      versao: 2,
    },
    409,
  );
  await ok(
    `/unidades/${ucSemContrato.id}/descontos`,
    "POST",
    {
      desconto: "35",
      inicio: "2026-10",
      versao: 2,
    },
    201,
  );
  assert.equal(
    (await ok(`/documentos/${manual.id}`)).memoria.contrato.desconto,
    "30",
  );
  let proximaCompetencia = await ok(
    "/documentos?lote=manual&nome=outubro-uc.pdf",
    "POST",
    pdf(["Fatura da UC com nova vigência em outubro"]),
    201,
  );
  proximaCompetencia = await ok(
    `/documentos/${proximaCompetencia.id}`,
    "PATCH",
    {
      versao: proximaCompetencia.versao,
      dados: {
        ...camposManuais,
        competencia: "2026-10",
        vencimento_ecosol: "2026-10-20",
        modalidade: "GDII",
      },
    },
  );
  proximaCompetencia = await ok(
    `/documentos/${proximaCompetencia.id}/calcular`,
    "POST",
    { versao: proximaCompetencia.versao, conferido: true },
  );
  assert.equal(proximaCompetencia.memoria.contrato.desconto, "35");
  assert.equal(proximaCompetencia.memoria.contrato.desconto_inicio, "2026-10");
  let substituicao = await ok(
    "/documentos?lote=manual&nome=substituicao.pdf",
    "POST",
    pdf(["Condições manuais em UC com vigência antiga"]),
    201,
  );
  substituicao = await ok(`/documentos/${substituicao.id}`, "PATCH", {
    versao: substituicao.versao,
    dados: {
      ...campos,
      competencia: "2026-11",
      vencimento_ecosol: "2026-11-10",
      modalidade: "",
    },
  });
  await ok(
    `/documentos/${substituicao.id}/calcular`,
    "POST",
    { versao: substituicao.versao, conferido: true },
    400,
  );
  substituicao = await ok(`/documentos/${substituicao.id}`, "PATCH", {
    versao: substituicao.versao,
    dados: {
      ...campos,
      competencia: "2026-11",
      vencimento_ecosol: "2026-11-10",
      modalidade: "GDII",
    },
  });
  substituicao = await ok(`/documentos/${substituicao.id}/calcular`, "POST", {
    versao: substituicao.versao,
    conferido: true,
  });
  assert.equal(substituicao.memoria.contrato.desconto, "30");
  assert.equal(
    substituicao.memoria.contrato.origem,
    "modalidade_na_fatura_desconto_na_uc",
  );
  const pdfReanalise = pdf([
    "PERDAS DE TRANSFORMACAO / RAMAL: 0% 2.903.188.012-00",
    "SET/2026 R$*********137,03 14/10/2026",
    "INJECAO SCEE - UC 000375915701270 - GD I KWH 769,00 0,787589 -605,66",
    "EQUATORIAL GOIAS DISTRIBUIDORA DE ENERGIA S/A 2.903.188.012-00 SET/2026",
  ]);
  let reanalisada = await ok(
    "/documentos?lote=reanalise&nome=antiga.pdf",
    "POST",
    pdfReanalise,
    201,
  );
  const {
    uc: _ucReanalise,
    total_equatorial: _totalReanalise,
    vencimento_equatorial: _vencimentoReanalise,
    ...dadosAntigos
  } = reanalisada.dados;
  banco
    .prepare("UPDATE faturamento_documentos SET dados=?,extracao=? WHERE id=?")
    .run(
      JSON.stringify(dadosAntigos),
      JSON.stringify({
        ...reanalisada.extracao,
        dados: { competencia: "2026-09" },
      }),
      reanalisada.id,
    );
  assert.equal(
    (
      await chamar(`/documentos/${reanalisada.id}/reanalisar`, 2, "POST", {
        versao: reanalisada.versao,
      })
    ).status,
    403,
  );
  await ok(
    `/documentos/${reanalisada.id}/reanalisar`,
    "POST",
    { versao: 99 },
    409,
  );
  banco.exec(`CREATE TEMP TRIGGER impedir_auditoria_reanalise
    BEFORE INSERT ON faturamento_historico
    WHEN NEW.documento_id=${reanalisada.id} AND NEW.acao='Reanálise de PDF'
    BEGIN SELECT RAISE(ABORT,'falha simulada'); END`);
  await ok(
    `/documentos/${reanalisada.id}/reanalisar`,
    "POST",
    { versao: reanalisada.versao },
    500,
  );
  banco.exec("DROP TRIGGER impedir_auditoria_reanalise");
  assert.equal(
    JSON.parse(
      banco
        .prepare("SELECT dados FROM faturamento_documentos WHERE id=?")
        .get(reanalisada.id).dados,
    ).uc,
    undefined,
  );
  const resultadoReanalise = await ok(
    `/documentos/${reanalisada.id}/reanalisar`,
    "POST",
    { versao: reanalisada.versao },
  );
  assert.deepEqual(
    resultadoReanalise.preenchidos.sort(),
    ["uc", "total_equatorial", "vencimento_equatorial"].sort(),
  );
  reanalisada = await ok(`/documentos/${reanalisada.id}`);
  assert.equal(reanalisada.dados.uc, "290318801200");
  assert.equal(reanalisada.dados.total_equatorial, "137.03");
  assert.equal(reanalisada.dados.vencimento_equatorial, "2026-10-14");
  assert.equal(reanalisada.status, "Pendente de revisão");
  assert.equal(reanalisada.memoria, null);
  const segundaReanalise = await ok(
    `/documentos/${reanalisada.id}/reanalisar`,
    "POST",
    { versao: reanalisada.versao },
  );
  assert.equal(segundaReanalise.atualizado, false);
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) n FROM faturamento_historico WHERE documento_id=? AND acao='Reanálise de PDF'",
      )
      .get(reanalisada.id).n,
    1,
  );
  let tarifaAntiga = await ok(
    "/documentos?lote=reanalise&nome=tarifa-antiga.pdf",
    "POST",
    pdf([
      ...cabecalhoEquatorial.split("\n"),
      "ADC BANDEIRA AMARELA kWh 100,00 0,024217 2,42",
      "CONSUMO NAO COMPENSADO kWh 100,00 1,145752 114,58",
      "INJECAO SCEE - UC 000375915701270 - GD I kWh 769,00 0,787589 -605,66",
    ]),
    201,
  );
  banco
    .prepare("UPDATE faturamento_documentos SET dados=?,extracao=? WHERE id=?")
    .run(
      JSON.stringify({ ...tarifaAntiga.dados, unitario: "0.787589" }),
      JSON.stringify({
        ...tarifaAntiga.extracao,
        dados: { ...tarifaAntiga.extracao.dados, unitario: "0.787589" },
      }),
      tarifaAntiga.id,
    );
  const tarifaCorrigida = await ok(
    `/documentos/${tarifaAntiga.id}/reanalisar`,
    "POST",
    { versao: tarifaAntiga.versao },
  );
  assert.deepEqual(tarifaCorrigida.corrigidos, ["unitario"]);
  tarifaAntiga = await ok(`/documentos/${tarifaAntiga.id}`);
  assert.equal(tarifaAntiga.dados.unitario, "1.145752");
  assert.equal(tarifaAntiga.dados.bandeira, "0.024217");
  assert.equal(
    calcularCobranca({
      injecao: tarifaAntiga.dados.injecao,
      unitario: tarifaAntiga.dados.unitario,
      bandeira: tarifaAntiga.dados.bandeira,
      desconto: "0",
      total_equatorial: "0",
      ajuste_gdii: "0",
      modalidade: "GDI",
    }).tarifa_completa,
    "1.169969",
  );
  let editada = await ok(
    "/documentos?lote=reanalise&nome=editada.pdf",
    "POST",
    pdf([...cabecalhoEquatorial.split("\n"), "PDF editado"]),
    201,
  );
  editada = await ok(`/documentos/${editada.id}`, "PATCH", {
    versao: editada.versao,
    dados: {
      ...editada.dados,
      total_equatorial: "999.00",
      vencimento_equatorial: "",
    },
  });
  const dadosAntes = structuredClone(editada.dados);
  banco
    .prepare("UPDATE faturamento_documentos SET extracao=? WHERE id=?")
    .run(JSON.stringify({ ...editada.extracao, dados: {} }), editada.id);
  const resultadoEditada = await ok(
    `/documentos/${editada.id}/reanalisar`,
    "POST",
    { versao: editada.versao },
  );
  assert.equal(resultadoEditada.dadosManuaisPreservados, true);
  assert.deepEqual(resultadoEditada.preenchidos, []);
  editada = await ok(`/documentos/${editada.id}`);
  assert.deepEqual(editada.dados, dadosAntes);
  assert.equal(editada.extracao.dados.vencimento_equatorial, "2026-10-14");
  await ok(`/documentos/${d.id}/reanalisar`, "POST", { versao: d.versao }, 409);
  const descartada = await ok(
    "/documentos?lote=reanalise&nome=descartada.pdf",
    "POST",
    pdf([...cabecalhoEquatorial.split("\n"), "PDF descartado"]),
    201,
  );
  banco
    .prepare(
      "UPDATE faturamento_documentos SET classificacao='triagem',excluido_em=CURRENT_TIMESTAMP,pdf=X'' WHERE id=?",
    )
    .run(descartada.id);
  await ok(
    `/documentos/${descartada.id}/reanalisar`,
    "POST",
    { versao: descartada.versao },
    404,
  );
  assert.equal(banco.prepare("SELECT COUNT(*) AS n FROM faturas").get().n, 0);
  assert.equal(
    banco.prepare("SELECT COUNT(*) AS n FROM contas_a_pagar").get().n,
    0,
  );
  assert.equal(banco.prepare("SELECT COUNT(*) AS n FROM dev_mail").get().n, 0);
  console.log(
    "OK: Havilah, arredondamento, extração de PDF, UC sem contrato, condições manuais, permissões, duplicidade, referências de lote e aprovação sem emissão/envio.",
  );
} finally {
  await new Promise((r) => server.close(r));
  banco.close();
}
