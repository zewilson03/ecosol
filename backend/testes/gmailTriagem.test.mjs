import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-triagem-"));
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { criarRepositorioGmail } =
  await import("../servidor/gmail/repositorio.mjs");
const { criarRotasGmail } = await import("../servidor/gmail/rotas.mjs");
const { rotasFaturamento } = await import("../servidor/faturamento/rotas.mjs");
const db = obterBanco();
for (const [nome, nivel] of [
  ["Admin", 3],
  ["Basico", 1],
])
  db.prepare(
    "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES (?,?,?,?)",
  ).run(nome, `${nivel}@teste.local`, "hash", nivel);
function sessao(id, token) {
  db.prepare(
    "INSERT INTO sessions(staff_id,token_hash,role,expires_at) VALUES (?,?,?,?)",
  ).run(
    id,
    createHash("sha256").update(token).digest("hex"),
    "staff",
    Date.now() + 60_000,
  );
  return `ecosol_session=${token}`;
}
const admin = sessao(1, "a".repeat(64));
const basico = sessao(2, "b".repeat(64));
const contaId = criarRepositorioGmail(db).cadastrarConta({
  email: "faturas@gmail.com",
  dataInicio: "2026-10-01",
}).id;
const pdf = Buffer.from("%PDF-1.4\ntriagem-teste\n");
const hash = createHash("sha256").update(pdf).digest("hex");
const documentoId = Number(
  db
    .prepare(
      `INSERT INTO faturamento_documentos
       (hash,nome,pdf,lote,texto,extracao,dados,classificacao)
       VALUES (?,?,?,?,?,?,?,'triagem')`,
    )
    .run(hash, "termo.pdf", pdf, "gmail-1", "", '{"dados":{}}', "{}")
    .lastInsertRowid,
);
db.prepare(
  "INSERT INTO gmail_mensagens(conta_id,message_id,estado) VALUES (?,?,'detalhada')",
).run(contaId, "m1");
const anexoId = Number(
  db
    .prepare(
      `INSERT INTO gmail_anexos
       (conta_id,message_id,part_path,attachment_id,nome,mime_type,estado,hash_pdf,documento_id)
       VALUES (?,?,?,?,?,?,'capturado',?,?)`,
    )
    .run(
      contaId,
      "m1",
      "0.1",
      "a1",
      "termo.pdf",
      "application/pdf",
      hash,
      documentoId,
    ).lastInsertRowid,
);
db.prepare(
  `INSERT INTO faturamento_recebimentos_pdf
   (hash,nome,lote,resultado,codigo,motivo,documento_id,responsavel,origem,gmail_anexo_id)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
).run(
  hash,
  "termo.pdf",
  "gmail-1",
  "Recebida",
  "ok",
  "teste",
  documentoId,
  "Gmail",
  "gmail",
  anexoId,
);

const app = express();
app.use(
  express.json(),
  rotasFaturamento,
  criarRotasGmail({
    banco: () => db,
    sincronizador: { emAndamento: () => false, sincronizar: async () => {} },
  }),
);
const servidor = app.listen(0, "127.0.0.1");
await new Promise((resolve) => servidor.once("listening", resolve));
const base = `http://127.0.0.1:${servidor.address().port}`;
function chamar(caminho, cookie, metodo = "GET", corpo) {
  return fetch(base + caminho, {
    method: metodo,
    headers: { Cookie: cookie ?? "", "Content-Type": "application/json" },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
}
try {
  assert.equal(
    (await (await chamar("/api/admin/faturamento/documentos", basico)).json())
      .length,
    0,
  );
  assert.equal(
    (await (await chamar("/api/admin/faturamento/recebimentos", basico)).json())
      .length,
    0,
  );
  for (const caminho of [
    `/api/admin/faturamento/documentos/${documentoId}`,
    `/api/admin/faturamento/documentos/${documentoId}/pdf`,
  ])
    assert.equal((await chamar(caminho, basico)).status, 404);
  assert.equal(
    (
      await chamar(
        `/api/admin/faturamento/documentos/${documentoId}`,
        admin,
        "PATCH",
        { versao: 1, dados: {} },
      )
    ).status,
    404,
  );
  const triagem = `/api/admin/gmail/contas/${contaId}/triagem`;
  assert.equal((await chamar(triagem, basico)).status, 403);
  const lista = await (await chamar(triagem, admin)).json();
  assert.equal(lista.itens.length, 1);
  assert.equal(lista.contagens[0].quantidade, 1);
  const respostaPdf = await chamar(`${triagem}/${documentoId}/pdf`, admin);
  assert.equal(respostaPdf.status, 200);
  assert.equal(respostaPdf.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await respostaPdf.arrayBuffer()), pdf);
  assert.equal(
    (await chamar(`${triagem}/${documentoId}/pdf`, basico)).status,
    403,
  );
  assert.equal(
    (
      await chamar(`${triagem}/${documentoId}/classificacao`, basico, "POST", {
        versao: 1,
        destino: "fatura",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await chamar(`${triagem}/${documentoId}/classificacao`, admin, "POST", {
        versao: 1,
        destino: "nao_fatura",
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await chamar("/api/admin/faturamento/documentos", basico)).json())
      .length,
    0,
  );
  assert.equal(
    (
      await chamar(`${triagem}/${documentoId}/classificacao`, admin, "POST", {
        versao: 1,
        destino: "fatura",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await chamar(`${triagem}/${documentoId}/classificacao`, admin, "POST", {
        versao: 2,
        destino: "fatura",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await chamar(`${triagem}/${documentoId}/classificacao`, admin, "POST", {
        versao: 1,
        destino: "fatura",
      })
    ).status,
    404,
  );
  assert.equal(
    (await chamar(`${triagem}/${documentoId}/pdf`, admin)).status,
    404,
  );
  assert.equal(
    (await (await chamar("/api/admin/faturamento/documentos", basico)).json())
      .length,
    1,
  );
  assert.equal(
    (
      await chamar(
        `/api/admin/faturamento/documentos/${documentoId}/pdf`,
        basico,
      )
    ).status,
    200,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM faturamento_historico WHERE documento_id=? AND acao=?",
      )
      .get(documentoId, "Classificação de PDF Gmail").n,
    2,
  );
  const inserirPendente = db.prepare(
    `INSERT INTO gmail_mensagens(conta_id,message_id,estado,erro_codigo)
     VALUES (?,?,'pendente_manual','teste')`,
  );
  for (let indice = 0; indice < 120; indice++)
    inserirPendente.run(contaId, `pendente-${indice}`);
  const pendencias = `/api/admin/gmail/contas/${contaId}/pendencias`;
  let cursor = null;
  const ids = [];
  do {
    const parametros = new URLSearchParams({ incluirAnexo: "0" });
    if (cursor !== null) parametros.set("aposMensagem", String(cursor));
    const resposta = await chamar(`${pendencias}?${parametros}`, admin);
    assert.equal(resposta.status, 200);
    const pagina = await resposta.json();
    assert.ok(pagina.mensagens.length <= 50);
    ids.push(...pagina.mensagens.map((item) => item.id));
    cursor = pagina.proximaMensagem;
  } while (cursor !== null);
  assert.equal(ids.length, 120);
  assert.equal(new Set(ids).size, 120);
  assert.equal(
    (await chamar(`${pendencias}?aposMensagem=abc`, admin)).status,
    400,
  );
  assert.equal(
    db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  console.log("Triagem Gmail: isolamento nível 3, PDF e promoção auditada OK.");
} finally {
  servidor.close();
  db.close();
}
