import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listarLotes } from "../servidor/faturamento/lotes.mjs";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-lotes-"));
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { criarRepositorioGmail } =
  await import("../servidor/gmail/repositorio.mjs");
const banco = obterBanco();
try {
  banco
    .prepare(
      `INSERT INTO faturamento_documentos
    (id,hash,nome,pdf,lote,texto,extracao,dados) VALUES
    (1,'hash-teste','teste.pdf',X'','manual','','{}','{}')`,
    )
    .run();
  const inserir = banco.prepare(`INSERT INTO faturamento_recebimentos_pdf
    (nome,lote,resultado,codigo,motivo,documento_id,responsavel,origem)
    VALUES ('teste.pdf','manual',?,?,?,?, 'Teste','manual')`);
  inserir.run("Recebida", "ok", "Recebida", 1);
  inserir.run("Erro", "duplicada", "Mesmo PDF", 1);
  inserir.run("Erro", "invalida", "PDF inválido", null);
  const avaliar = () => ({
    apta: true,
    versao: 1,
    status: "Calculada",
    valor_centavos: 12345,
    motivo: "Aguarda aprovação",
  });
  let lote = listarLotes(banco, { avaliar })[0];
  assert.deepEqual(
    [
      lote.recebido,
      lote.aptas,
      lote.pendentes,
      lote.duplicadas,
      lote.valor_centavos,
    ],
    [3, 1, 1, 1, 12345],
  );
  lote = listarLotes(banco, {
    avaliar: () => {
      const e = new Error("Cadastro incompleto");
      e.status = 409;
      throw e;
    },
  })[0];
  assert.equal(lote.pendentes, 2);
  assert.equal(lote.valor_centavos, 0);
  assert.equal(lote.itens[0].motivo, "Cadastro incompleto");
  const conta = criarRepositorioGmail(banco).cadastrarConta({
    email: "lote@example.test",
    dataInicio: "2026-10-01",
  });
  banco
    .prepare(
      "INSERT INTO gmail_mensagens(conta_id,message_id) VALUES (?,'mensagem')",
    )
    .run(conta.id);
  banco
    .prepare(
      `INSERT INTO gmail_anexos(conta_id,message_id,part_path,nome,mime_type,estado,erro_codigo)
    VALUES (?,'mensagem','0','invalido.pdf','application/pdf','pendente_manual','pdf_invalido')`,
    )
    .run(conta.id);
  assert.equal(listarLotes(banco, { avaliar }).length, 1);
  let gmail = listarLotes(banco, { avancado: true, avaliar }).find(
    (l) => l.lote === `gmail-${conta.id}`,
  );
  assert.equal(gmail.recebido, 1);
  assert.equal(gmail.itens[0].motivo, "pdf_invalido");
  banco
    .prepare(
      `INSERT INTO faturamento_recebimentos_pdf
    (nome,lote,resultado,codigo,motivo,documento_id,responsavel,origem,gmail_anexo_id)
    VALUES ('invalido.pdf',?,'Duplicada','duplicada','Duplicado',1,'Teste','gmail',1)`,
    )
    .run(`gmail-${conta.id}`);
  gmail = listarLotes(banco, { avancado: true, avaliar }).find(
    (l) => l.lote === `gmail-${conta.id}`,
  );
  assert.equal(gmail.recebido, 1); // A fila e o recebimento não contam duas vezes.
  assert.equal(gmail.duplicadas, 1);
  assert.equal(gmail.valor_centavos, 0);
  const captura = {
    id: Number(
      banco
        .prepare(
          `INSERT INTO gmail_capturas_periodo
          (conta_id,inicio_local,fim_local,fuso,estado,iniciado_em,concluido_em)
          VALUES (?,? ,?,'America/Sao_Paulo','concluida',1,1)`,
        )
        .run(conta.id, "2026-10-26T08:00", "2026-10-27T08:00")
        .lastInsertRowid,
    ),
  };
  banco
    .prepare(
      `INSERT INTO gmail_capturas_periodo_mensagens
       (captura_id,message_id,anexos_esperados) VALUES (?, 'mensagem', 1)`,
    )
    .run(captura.id);
  gmail = listarLotes(banco, { avancado: true, avaliar }).find(
    (l) => l.id === `gmail-captura-${captura.id}`,
  );
  assert.equal(gmail.lote, `gmail-${conta.id}`);
  assert.equal(
    gmail.rotulo,
    "Gmail · 27/10/2026 · 26/10/2026 08:00–27/10/2026 08:00",
  );
  assert.equal(gmail.recebido, 1);
  console.log(
    "OK: lotes manuais/Gmail, erros, duplicatas, cadastro incompleto e contagem única.",
  );
} finally {
  banco.close();
}
