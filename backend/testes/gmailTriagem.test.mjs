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

function criarItem(nome) {
  const conteudo = Buffer.from(`%PDF-1.4\n${nome}\n`);
  const hashItem = createHash("sha256").update(conteudo).digest("hex");
  const mensagem = `lote-${nome}`;
  db.prepare(
    "INSERT INTO gmail_mensagens(conta_id,message_id,estado) VALUES (?,?,'detalhada')",
  ).run(contaId, mensagem);
  const id = Number(
    db
      .prepare(
        `INSERT INTO faturamento_documentos
         (hash,nome,pdf,lote,texto,extracao,dados,classificacao)
         VALUES (?,?,?,?,?,?,?,'triagem')`,
      )
      .run(
        hashItem,
        nome,
        conteudo,
        "gmail-1",
        "texto privado",
        '{"dados":{}}',
        '{"uc":"123"}',
      ).lastInsertRowid,
  );
  const anexo = Number(
    db
      .prepare(
        `INSERT INTO gmail_anexos
         (conta_id,message_id,part_path,attachment_id,nome,mime_type,estado,hash_pdf,documento_id)
         VALUES (?,?,?,?,?,?,'capturado',?,?)`,
      )
      .run(
        contaId,
        mensagem,
        "0.1",
        "a1",
        nome,
        "application/pdf",
        hashItem,
        id,
      ).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO faturamento_recebimentos_pdf
     (hash,nome,lote,resultado,codigo,motivo,documento_id,responsavel,origem,gmail_anexo_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    hashItem,
    nome,
    "gmail-1",
    "Recebida",
    "ok",
    "teste",
    id,
    "Gmail",
    "gmail",
    anexo,
  );
  return { id, versao: 1, anexo };
}

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
  const loteA = criarItem("lote-a.pdf");
  const loteB = criarItem("lote-b.pdf");
  const classificarLote = `${triagem}/classificacao-em-lote`;
  const excluirLote = `${triagem}/excluir-em-lote`;
  assert.equal(
    (
      await chamar(classificarLote, basico, "POST", {
        itens: [loteA, loteB],
        destino: "fatura",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await chamar(classificarLote, admin, "POST", {
        itens: [loteA, loteA],
        destino: "fatura",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await chamar(classificarLote, admin, "POST", {
        itens: [loteA, { id: loteB.id, versao: 99 }],
        destino: "fatura",
      })
    ).status,
    409,
  );
  assert.equal(
    db
      .prepare("SELECT classificacao FROM faturamento_documentos WHERE id=?")
      .get(loteA.id).classificacao,
    "triagem",
  );
  const primeiraClassificacao = await chamar(classificarLote, admin, "POST", {
    itens: [loteA, loteB],
    destino: "nao_fatura",
  });
  assert.equal(primeiraClassificacao.status, 200);
  assert.equal((await primeiraClassificacao.json()).alterados, 2);
  const classificacaoMista = await chamar(classificarLote, admin, "POST", {
    itens: [
      { id: loteA.id, versao: 2 },
      { id: loteB.id, versao: 2 },
    ],
    destino: "nao_fatura",
  });
  assert.equal(classificacaoMista.status, 200);
  assert.equal((await classificacaoMista.json()).alterados, 0);
  const promoverLote = await chamar(classificarLote, admin, "POST", {
    itens: [
      { id: loteA.id, versao: 2 },
      { id: loteB.id, versao: 2 },
    ],
    destino: "fatura",
  });
  assert.equal(promoverLote.status, 200);
  assert.equal((await promoverLote.json()).alterados, 2);
  const excluirA = criarItem("excluir-a.pdf");
  const excluirB = criarItem("excluir-b.pdf");
  assert.equal(
    (
      await chamar(excluirLote, admin, "POST", {
        itens: [excluirA],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await chamar(excluirLote, admin, "POST", {
        itens: [excluirA, { id: loteA.id, versao: 3 }],
        confirmacao: "EXCLUIR",
      })
    ).status,
    404,
  );
  assert.ok(
    db
      .prepare(
        "SELECT length(pdf) tamanho FROM faturamento_documentos WHERE id=?",
      )
      .get(excluirA.id).tamanho > 0,
  );
  assert.equal(
    (
      await chamar(excluirLote, admin, "POST", {
        itens: [excluirA, { id: excluirB.id, versao: 99 }],
        confirmacao: "EXCLUIR",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await chamar(excluirLote, basico, "POST", {
        itens: [excluirA, excluirB],
        confirmacao: "EXCLUIR",
      })
    ).status,
    403,
  );
  db.exec(`CREATE TEMP TRIGGER impedir_auditoria_exclusao
    BEFORE INSERT ON faturamento_historico
    WHEN NEW.documento_id=${excluirB.id}
      AND NEW.acao='Exclusão definitiva de PDF Gmail'
    BEGIN SELECT RAISE(ABORT,'falha simulada'); END`);
  assert.equal(
    (
      await chamar(excluirLote, admin, "POST", {
        itens: [excluirA, excluirB],
        confirmacao: "EXCLUIR",
      })
    ).status,
    500,
  );
  db.exec("DROP TRIGGER impedir_auditoria_exclusao");
  for (const item of [excluirA, excluirB])
    assert.ok(
      db
        .prepare(
          "SELECT length(pdf) tamanho FROM faturamento_documentos WHERE id=?",
        )
        .get(item.id).tamanho > 0,
    );
  const exclusao = await chamar(excluirLote, admin, "POST", {
    itens: [excluirA, excluirB],
    confirmacao: "EXCLUIR",
  });
  assert.equal(exclusao.status, 200);
  assert.equal((await exclusao.json()).excluidos, 2);
  for (const item of [excluirA, excluirB]) {
    const salvo = db
      .prepare(
        "SELECT length(pdf) tamanho,texto,extracao,dados,excluido_em FROM faturamento_documentos WHERE id=?",
      )
      .get(item.id);
    assert.equal(salvo.tamanho, 0);
    assert.equal(salvo.texto, "");
    assert.equal(salvo.extracao, "{}");
    assert.equal(salvo.dados, "{}");
    assert.ok(salvo.excluido_em);
    assert.equal(
      (await chamar(`${triagem}/${item.id}/pdf`, admin)).status,
      404,
    );
    assert.equal(
      db
        .prepare("SELECT documento_id FROM gmail_anexos WHERE id=?")
        .get(item.anexo).documento_id,
      item.id,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM faturamento_historico WHERE documento_id=? AND acao='Exclusão definitiva de PDF Gmail'",
        )
        .get(item.id).n,
      1,
    );
  }
  assert.equal(
    (
      await chamar(classificarLote, admin, "POST", {
        itens: [excluirA],
        destino: "fatura",
      })
    ).status,
    404,
  );
  assert.ok(
    !(await (await chamar(triagem, admin)).json()).itens.some((item) =>
      [excluirA.id, excluirB.id].includes(item.id),
    ),
  );
  const compartilhado = criarItem("compartilhado.pdf");
  const normal = criarItem("normal.pdf");
  const outraConta = criarRepositorioGmail(db).cadastrarConta({
    email: "outra@gmail.com",
    dataInicio: "2026-10-01",
  }).id;
  db.prepare(
    "INSERT INTO gmail_mensagens(conta_id,message_id,estado) VALUES (?,?,'detalhada')",
  ).run(outraConta, "duplicado-entre-contas");
  const hashCompartilhado = db
    .prepare("SELECT hash FROM faturamento_documentos WHERE id=?")
    .get(compartilhado.id).hash;
  const anexoCompartilhado = Number(
    db
      .prepare(
        `INSERT INTO gmail_anexos
         (conta_id,message_id,part_path,attachment_id,nome,mime_type,estado,hash_pdf,documento_id)
         VALUES (?,?,?,?,?,?,'duplicado',?,?)`,
      )
      .run(
        outraConta,
        "duplicado-entre-contas",
        "0.1",
        "a1",
        "compartilhado.pdf",
        "application/pdf",
        hashCompartilhado,
        compartilhado.id,
      ).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO faturamento_recebimentos_pdf
     (hash,nome,lote,resultado,codigo,motivo,documento_id,responsavel,origem,gmail_anexo_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    hashCompartilhado,
    "compartilhado.pdf",
    "gmail-2",
    "Duplicada",
    "duplicada",
    "teste",
    compartilhado.id,
    "Gmail",
    "gmail",
    anexoCompartilhado,
  );
  const exclusaoCompartilhada = await chamar(excluirLote, admin, "POST", {
    itens: [normal, compartilhado],
    confirmacao: "EXCLUIR",
  });
  assert.equal(exclusaoCompartilhada.status, 409);
  assert.match((await exclusaoCompartilhada.json()).erro, /outra caixa/);
  for (const item of [normal, compartilhado])
    assert.ok(
      db
        .prepare(
          "SELECT length(pdf) tamanho FROM faturamento_documentos WHERE id=?",
        )
        .get(item.id).tamanho > 0,
    );
  const manual = criarItem("manual-duplicado.pdf");
  db.prepare(
    `INSERT INTO faturamento_recebimentos_pdf
     (hash,nome,lote,resultado,codigo,motivo,documento_id,responsavel,origem)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    db
      .prepare("SELECT hash FROM faturamento_documentos WHERE id=?")
      .get(manual.id).hash,
    "manual-duplicado.pdf",
    "manual",
    "Duplicada",
    "duplicada",
    "teste",
    manual.id,
    "Operador",
    "manual",
  );
  assert.equal(
    (
      await chamar(excluirLote, admin, "POST", {
        itens: [manual],
        confirmacao: "EXCLUIR",
      })
    ).status,
    409,
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
  db.prepare(
    "INSERT INTO gmail_mensagens(conta_id,message_id,estado) VALUES (?,?,'detalhada')",
  ).run(contaId, "mensagem-termo");
  const anexoRevisao = Number(
    db
      .prepare(
        `INSERT INTO gmail_anexos
    (conta_id,message_id,part_path,attachment_id,nome,mime_type,estado,erro_codigo)
    VALUES (?,?,?,?,?,?,'pendente_manual','revisao_email')`,
      )
      .run(
        contaId,
        "mensagem-termo",
        "0.0",
        "anexo-termo",
        "Termo de fatura por e-mail.pdf",
        "application/pdf",
      ).lastInsertRowid,
  );
  const listaRevisao = await chamar(`${pendencias}?incluirMensagem=0`, admin);
  assert.equal(listaRevisao.status, 200);
  const itemRevisao = (await listaRevisao.json()).anexos.find(
    (item) => item.id === anexoRevisao,
  );
  assert.equal(itemRevisao.nome, "Termo de fatura por e-mail.pdf");
  assert.equal(itemRevisao.erroCodigo, "revisao_email");
  const autorizar = `/api/admin/gmail/contas/${contaId}/anexos/${anexoRevisao}/autorizar-captura`;
  assert.equal(
    (
      await chamar(autorizar, basico, "POST", {
        confirmacao: "CONFERI_NO_GMAIL",
      })
    ).status,
    403,
  );
  assert.equal(
    (await chamar(autorizar, admin, "POST", { confirmacao: "sim" })).status,
    400,
  );
  assert.equal(
    (
      await chamar(
        `/api/admin/gmail/contas/${contaId}/anexos/${anexoRevisao}/tentar-novamente`,
        admin,
        "POST",
        {},
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await chamar(autorizar, admin, "POST", {
        confirmacao: "CONFERI_NO_GMAIL",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await chamar(autorizar, admin, "POST", {
        confirmacao: "CONFERI_NO_GMAIL",
      })
    ).status,
    409,
  );
  assert.equal(
    db.prepare("SELECT estado FROM gmail_anexos WHERE id=?").get(anexoRevisao)
      .estado,
    "pendente",
  );
  assert.equal(
    db
      .prepare(
        "SELECT administrador_id FROM gmail_revisoes_anexos WHERE anexo_id=?",
      )
      .get(anexoRevisao).administrador_id,
    1,
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
