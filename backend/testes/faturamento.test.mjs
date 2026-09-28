import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import {
  calcularCobranca,
  documentoValido,
  dataValida,
} from "../servidor/faturamento/regras.mjs";
import { extrairCampos, lerPdf } from "../servidor/faturamento/extracao.mjs";

process.env.ECOSOL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "ecosol-faturamento-"),
);
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { rotasFaturamento } = await import("../servidor/faturamento/rotas.mjs");
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
  calcularCobranca({ ...entrada, modalidade: "GDI", ajuste_gdii: "0" })
    .total_centavos,
  175901,
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
assert.equal(
  extrairCampos(linhas.concat(linhas.at(-1)).join("\n")).dados.ajuste_gdii,
  undefined,
);
assert.match(extrairCampos("").avisos.join(" "), /sem texto/);

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
  unitario: "1.1",
  bandeira: "0.069969",
  origem_tarifa: "propria",
  vencimento_ecosol: "2026-10-10",
};
try {
  assert.equal((await chamar("/documentos", null)).status, 401);
  assert.equal((await chamar("/unidades", 1, "POST", unidade)).status, 403);
  const u = await ok("/unidades", "POST", unidade, 201);
  await ok("/unidades", "POST", unidade, 409);
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
  await ok("/documentos?lote=teste&nome=a.pdf", "POST", arquivo, 409);
  assert.equal((await chamar(`/documentos/${d.id}/pdf`, null)).status, 401);
  const download = await chamar(`/documentos/${d.id}/pdf`, 1);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), arquivo);
  d = await ok(`/documentos/${d.id}`, "PATCH", {
    versao: d.versao,
    dados: campos,
  });
  await ok(`/documentos/${d.id}`, "PATCH", { versao: 1, dados: campos }, 409);
  await ok(`/documentos/${d.id}/calcular`, "POST", { versao: d.versao }, 400);
  d = await ok(`/documentos/${d.id}/calcular`, "POST", {
    versao: d.versao,
    conferido: true,
  });
  assert.equal(d.memoria.total_centavos, 146830);
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
  const dadosGdi = { ...campos, uc: "12345", ajuste_gdii: "0" };
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
  assert.equal(banco.prepare("SELECT COUNT(*) AS n FROM faturas").get().n, 0);
  assert.equal(
    banco.prepare("SELECT COUNT(*) AS n FROM contas_a_pagar").get().n,
    0,
  );
  assert.equal(banco.prepare("SELECT COUNT(*) AS n FROM dev_mail").get().n, 0);
  console.log(
    "OK: Havilah, arredondamento, extração de PDF, cadastros, vigências, permissões, duplicidade, referências de lote e aprovação sem emissão/envio.",
  );
} finally {
  await new Promise((r) => server.close(r));
  banco.close();
}
