import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { prepararFaturamento } from "../servidor/faturamento/esquema.mjs";
import { prepararGmail } from "../servidor/gmail/esquema.mjs";
import { criarRepositorioGmail } from "../servidor/gmail/repositorio.mjs";

// O teste usa exclusivamente um arquivo temporário e conexões independentes.
const pasta = mkdtempSync(join(tmpdir(), "ecosol-gmail-persistencia-"));
const caminho = join(pasta, "teste.db");
let banco = new DatabaseSync(caminho);
let segundaConexao;

try {
  banco.exec(
    "CREATE TABLE dados_anteriores(id INTEGER PRIMARY KEY, valor TEXT NOT NULL)",
  );
  banco
    .prepare("INSERT INTO dados_anteriores(valor) VALUES(?)")
    .run("preservado");
  prepararFaturamento(banco);
  prepararGmail(banco);
  prepararGmail(banco);
  assert.equal(banco.prepare("PRAGMA busy_timeout").get().timeout, 5000);
  for (const [tabela, indice] of [
    ["gmail_mensagens", "gmail_mensagens_reservas"],
    ["gmail_anexos", "gmail_anexos_reservas"],
  ]) {
    const plano = banco
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM ${tabela} WHERE conta_id=? AND
          estado IN ('pendente','falha_temporaria','em_processamento') AND
          (estado='pendente' OR
           (estado='falha_temporaria' AND proxima_tentativa_em<=?) OR
           (estado='em_processamento' AND lease_ate<=?))
          ORDER BY tentativas, id LIMIT 1`,
      )
      .all(1, 0, 0)
      .map((linha) => linha.detail);
    assert.ok(plano.some((detalhe) => detalhe.includes(indice)));
    assert.ok(plano.every((detalhe) => !detalhe.includes("TEMP B-TREE")));
  }
  assert.equal(
    banco.prepare("SELECT valor FROM dados_anteriores").get().valor,
    "preservado",
  );

  let repo = criarRepositorioGmail(banco);
  assert.throws(
    () =>
      repo.cadastrarConta({
        email: "teste@gmail.com",
        dataInicio: "2026-02-30",
      }),
    /Data inicial/,
  );
  const conta = repo.cadastrarConta({
    email: "Teste@Gmail.com",
    dataInicio: "2026-10-05",
  });
  assert.equal(conta.email, "teste@gmail.com");
  assert.equal(conta.status_autorizacao, "nao_conectada");
  assert.equal(conta.pausada, 1);
  assert.deepEqual(repo.inicioDaBusca(conta.id), {
    data: "2026-10-05",
    fuso: "America/Sao_Paulo",
    inclusivo: true,
  });
  assert.equal(
    repo.cadastrarConta({ email: "TESTE@gmail.com", dataInicio: "2026-10-05" })
      .id,
    conta.id,
  );
  assert.throws(
    () => repo.definirPausa({ contaId: conta.id, pausada: false }),
    /não autorizada/,
  );
  repo.definirAutorizacao({ contaId: conta.id, estado: "conectada" });
  repo.definirPausa({ contaId: conta.id, pausada: false });

  const marco = "9007199254740993"; // Maior que Number.MAX_SAFE_INTEGER.
  let progresso = repo.iniciarVarreduraCompleta({
    contaId: conta.id,
    historyId: marco,
  });
  assert.equal(progresso.history_id, null);
  assert.equal(progresso.marco_history_id, marco);
  const primeiraPagina = {
    contaId: conta.id,
    versaoEsperada: progresso.versao,
    cursorEsperado: null,
    proximoCursor: "pagina-2",
    mensagens: ["msg-1", "msg-2"],
    agora: 1000,
  };
  let pagina = repo.registrarPagina(primeiraPagina);
  assert.equal(pagina.inseridos, 2);
  assert.equal(pagina.progresso.cursor_pagina, "pagina-2");
  assert.equal(pagina.progresso.history_id, null);
  assert.equal(repo.registrarPagina(primeiraPagina).repetida, true);
  assert.equal(repo.listarMensagens({ contaId: conta.id }).length, 2);

  // Falhar após a primeira inserção deve desfazer tanto a mensagem quanto o cursor.
  const antesDaFalha = repo.obterProgresso(conta.id);
  banco.exec(`CREATE TRIGGER rejeitar_mensagem
    BEFORE INSERT ON gmail_mensagens WHEN NEW.message_id='msg-falha'
    BEGIN SELECT RAISE(ABORT, 'falha simulada'); END`);
  try {
    assert.throws(
      () =>
        repo.registrarPagina({
          contaId: conta.id,
          versaoEsperada: antesDaFalha.versao,
          cursorEsperado: "pagina-2",
          proximoCursor: null,
          mensagens: ["msg-3", "msg-falha"],
          agora: 2000,
        }),
      /falha simulada/,
    );
  } finally {
    banco.exec("DROP TRIGGER rejeitar_mensagem");
  }
  assert.deepEqual(repo.obterProgresso(conta.id), antesDaFalha);
  assert.equal(repo.listarMensagens({ contaId: conta.id }).length, 2);
  pagina = repo.registrarPagina({
    contaId: conta.id,
    versaoEsperada: antesDaFalha.versao,
    cursorEsperado: "pagina-2",
    proximoCursor: null,
    mensagens: ["msg-2", "msg-3"],
    agora: 3000,
  });
  assert.equal(pagina.inseridos, 1);
  assert.equal(pagina.existentes, 1);
  assert.equal(pagina.progresso.fase, "historico");
  assert.equal(pagina.progresso.history_id, marco);
  assert.equal(repo.listarMensagens({ contaId: conta.id }).length, 3);
  assert.equal(repo.listarAnexos({ contaId: conta.id }).length, 0);

  // Abrir o mesmo arquivo por outra conexão simula a retomada após reinício.
  banco.close();
  banco = new DatabaseSync(caminho);
  prepararGmail(banco);
  repo = criarRepositorioGmail(banco);
  assert.equal(repo.obterProgresso(conta.id).history_id, marco);
  assert.equal(repo.listarMensagens({ contaId: conta.id }).length, 3);

  progresso = repo.obterProgresso(conta.id);
  pagina = repo.registrarPagina({
    contaId: conta.id,
    versaoEsperada: progresso.versao,
    cursorEsperado: null,
    proximoCursor: "historico-2",
    mensagens: [],
    agora: 4000,
  });
  assert.equal(pagina.progresso.history_id, marco);
  assert.throws(
    () =>
      repo.registrarPagina({
        contaId: conta.id,
        versaoEsperada: progresso.versao,
        cursorEsperado: null,
        proximoCursor: "outro-cursor",
        mensagens: [],
        agora: 4000,
      }),
    /obsoleta/,
  );
  const paginaHistoricaAntiga = pagina.progresso;
  progresso = repo.reiniciarBuscaHistorica(conta.id);
  assert.equal(progresso.cursor_pagina, null);
  assert.equal(progresso.history_id, marco);
  assert.throws(
    () =>
      repo.registrarPagina({
        contaId: conta.id,
        versaoEsperada: paginaHistoricaAntiga.versao,
        cursorEsperado: "historico-2",
        mensagens: ["msg-1"],
        novoHistoryId: "9007199254740999",
        agora: 5000,
      }),
    /obsoleta/,
  );
  pagina = repo.registrarPagina({
    contaId: conta.id,
    versaoEsperada: progresso.versao,
    cursorEsperado: null,
    proximoCursor: null,
    mensagens: ["msg-1"],
    novoHistoryId: "9007199254740999",
    agora: 5000,
  });
  assert.equal(pagina.progresso.history_id, "9007199254740999");
  assert.equal(repo.listarMensagens({ contaId: conta.id }).length, 3);

  // Revarrer após um histórico expirado preserva mensagens já descobertas.
  progresso = repo.iniciarVarreduraCompleta({
    contaId: conta.id,
    historyId: "9007199254741010",
    ressincronizacao: true,
  });
  assert.equal(progresso.history_id, "9007199254740999");
  assert.equal(progresso.marco_history_id, "9007199254741010");
  pagina = repo.registrarPagina({
    contaId: conta.id,
    versaoEsperada: progresso.versao,
    mensagens: ["msg-3"],
    agora: 6000,
  });
  assert.equal(pagina.progresso.history_id, "9007199254741010");
  assert.equal(repo.listarMensagens({ contaId: conta.id }).length, 3);

  // Cursor inválido durante a varredura completa exige um novo marco, sem
  // apagar IDs já vistos. Uma página da tentativa anterior fica obsoleta.
  const outraConta = repo.cadastrarConta({
    email: "outra@gmail.com",
    dataInicio: "2026-10-01",
  });
  repo.definirAutorizacao({ contaId: outraConta.id, estado: "conectada" });
  repo.definirPausa({ contaId: outraConta.id, pausada: false });
  progresso = repo.iniciarVarreduraCompleta({
    contaId: outraConta.id,
    historyId: "10",
  });
  pagina = repo.registrarPagina({
    contaId: outraConta.id,
    versaoEsperada: progresso.versao,
    proximoCursor: "inicial-2",
    mensagens: ["outra-1"],
    agora: 6100,
  });
  const paginaInicialAntiga = pagina.progresso;
  progresso = repo.reiniciarVarreduraCompleta({
    contaId: outraConta.id,
    historyId: "11",
  });
  assert.equal(progresso.cursor_pagina, null);
  assert.equal(progresso.marco_history_id, "11");
  assert.throws(
    () =>
      repo.registrarPagina({
        contaId: outraConta.id,
        versaoEsperada: paginaInicialAntiga.versao,
        cursorEsperado: "inicial-2",
        mensagens: ["outra-2"],
        agora: 6200,
      }),
    /obsoleta/,
  );
  pagina = repo.registrarPagina({
    contaId: outraConta.id,
    versaoEsperada: progresso.versao,
    mensagens: ["outra-1", "outra-2"],
    agora: 6300,
  });
  assert.equal(pagina.progresso.history_id, "11");
  assert.equal(repo.listarMensagens({ contaId: outraConta.id }).length, 2);
  assert.throws(
    () =>
      repo.reiniciarVarreduraCompleta({
        contaId: outraConta.id,
        historyId: "12",
      }),
    /Não há varredura completa/,
  );
  progresso = repo.registrarPagina({
    contaId: outraConta.id,
    versaoEsperada: pagina.progresso.versao,
    proximoCursor: "historico-obsoleto",
    mensagens: [],
    agora: 6400,
  }).progresso;
  assert.equal(progresso.cursor_pagina, "historico-obsoleto");
  progresso = repo.iniciarVarreduraCompleta({
    contaId: outraConta.id,
    historyId: "13",
    ressincronizacao: true,
  });
  assert.equal(progresso.cursor_pagina, null);
  assert.equal(progresso.history_id, "11");
  pagina = repo.registrarPagina({
    contaId: outraConta.id,
    versaoEsperada: progresso.versao,
    proximoCursor: "revarredura-2",
    mensagens: ["outra-2"],
    agora: 6500,
  });
  progresso = repo.reiniciarVarreduraCompleta({
    contaId: outraConta.id,
    historyId: "14",
  });
  assert.equal(progresso.history_id, "11");
  pagina = repo.registrarPagina({
    contaId: outraConta.id,
    versaoEsperada: progresso.versao,
    mensagens: ["outra-1"],
    agora: 6600,
  });
  assert.equal(pagina.progresso.history_id, "14");
  assert.equal(repo.listarMensagens({ contaId: outraConta.id }).length, 2);
  const primeiraOutra = repo.reservarMensagem({
    contaId: outraConta.id,
    agora: 6700,
    leaseMs: 1000,
  });
  assert.equal(primeiraOutra.message_id, "outra-1");
  const segundaOutra = repo.reservarMensagem({
    contaId: outraConta.id,
    agora: 7700,
    leaseMs: 1000,
  });
  assert.equal(segundaOutra.message_id, "outra-2");
  assert.notEqual(segundaOutra.id, primeiraOutra.id);

  // Uma mensagem com erro não bloqueia o detalhamento das outras duas.
  segundaConexao = new DatabaseSync(caminho);
  prepararGmail(segundaConexao);
  let outro = criarRepositorioGmail(segundaConexao);
  const m1 = repo.reservarMensagem({
    contaId: conta.id,
    agora: 7000,
    leaseMs: 1000,
  });
  const m2 = outro.reservarMensagem({
    contaId: conta.id,
    agora: 7000,
    leaseMs: 1000,
  });
  const m3 = repo.reservarMensagem({
    contaId: conta.id,
    agora: 7000,
    leaseMs: 1000,
  });
  assert.deepEqual(
    [m1.message_id, m2.message_id, m3.message_id],
    ["msg-1", "msg-2", "msg-3"],
  );
  const a = {
    partPath: "0.1",
    attachmentId: "att-1",
    nome: "fatura-a.pdf",
    mimeType: "application/pdf",
  };
  const b = { ...a, attachmentId: "att-2", nome: "fatura-b.pdf" };
  assert.equal(
    repo.registrarAnexosDaMensagem({
      mensagemId: m1.id,
      leaseToken: m1.lease_token,
      anexos: [a],
      agora: 7001,
    }),
    true,
  );
  assert.equal(
    outro.registrarFalhaMensagem({
      mensagemId: m2.id,
      leaseToken: m2.lease_token,
      codigo: "gmail_429",
      temporaria: true,
      proximaTentativaEm: 12000,
      agora: 7001,
    }),
    true,
  );
  assert.equal(
    repo.registrarAnexosDaMensagem({
      mensagemId: m3.id,
      leaseToken: m3.lease_token,
      anexos: [],
      agora: 7001,
    }),
    true,
  );
  assert.equal(
    repo.listarMensagens({ contaId: conta.id, estado: "detalhada" }).length,
    2,
  );
  assert.equal(
    repo.listarMensagens({ contaId: conta.id, estado: "falha_temporaria" })
      .length,
    1,
  );
  assert.equal(repo.listarAnexos({ contaId: conta.id }).length, 1);

  // A pendência e seu prazo permanecem após nova abertura do banco.
  segundaConexao.close();
  segundaConexao = undefined;
  banco.close();
  banco = new DatabaseSync(caminho);
  prepararGmail(banco);
  repo = criarRepositorioGmail(banco);
  assert.equal(repo.reservarMensagem({ contaId: conta.id, agora: 9000 }), null);
  const retryMensagem = repo.reservarMensagem({
    contaId: conta.id,
    agora: 12000,
    leaseMs: 1000,
  });
  assert.equal(retryMensagem.message_id, "msg-2");
  assert.throws(
    () =>
      repo.registrarAnexosDaMensagem({
        mensagemId: retryMensagem.id,
        leaseToken: retryMensagem.lease_token,
        anexos: [b, { ...b, partPath: "" }],
        agora: 12001,
      }),
    /Caminho da parte/,
  );
  assert.equal(repo.listarAnexos({ contaId: conta.id }).length, 1);
  assert.equal(
    repo.registrarAnexosDaMensagem({
      mensagemId: retryMensagem.id,
      leaseToken: retryMensagem.lease_token,
      anexos: [b],
      agora: 12001,
    }),
    true,
  );
  assert.equal(repo.listarAnexos({ contaId: conta.id }).length, 2);
  assert.equal(
    repo.listarMensagens({ contaId: conta.id, estado: "detalhada" }).length,
    3,
  );
  assert.throws(
    () =>
      banco
        .prepare("UPDATE gmail_anexos SET estado='capturado' WHERE conta_id=?")
        .run(conta.id),
    /CHECK constraint/,
  );

  // Dois trabalhadores não reservam o mesmo anexo; lease vencido invalida o antigo.
  segundaConexao = new DatabaseSync(caminho);
  prepararGmail(segundaConexao);
  outro = criarRepositorioGmail(segundaConexao);
  const anexo1 = repo.reservarAnexo({
    contaId: conta.id,
    agora: 13000,
    leaseMs: 1000,
  });
  const anexo2 = outro.reservarAnexo({
    contaId: conta.id,
    agora: 13000,
    leaseMs: 1000,
  });
  assert.notEqual(anexo1.id, anexo2.id);
  assert.equal(
    repo.reservarAnexo({ contaId: conta.id, agora: 13000, leaseMs: 1000 }),
    null,
  );
  const retomado = outro.reservarAnexo({
    contaId: conta.id,
    agora: 14000,
    leaseMs: 1000,
  });
  assert.equal(retomado.id, anexo1.id);
  assert.equal(
    repo.concluirAnexo({
      anexoId: anexo1.id,
      leaseToken: anexo1.lease_token,
      resultado: "capturado",
      documentoId: 1,
      hash: "a".repeat(64),
      agora: 14001,
    }),
    false,
  );
  assert.equal(
    outro.registrarFalhaAnexo({
      anexoId: retomado.id,
      leaseToken: retomado.lease_token,
      codigo: "gmail_429",
      temporaria: true,
      proximaTentativaEm: 16000,
      agora: 14001,
    }),
    true,
  );
  assert.equal(
    repo.registrarFalhaAnexo({
      anexoId: anexo2.id,
      leaseToken: anexo2.lease_token,
      codigo: "pdf_invalido",
      temporaria: false,
      agora: 14001,
    }),
    false,
  ); // O lease já venceu.
  const outroAntesDoRetry = repo.reservarAnexo({
    contaId: conta.id,
    agora: 16000,
    leaseMs: 1000,
  });
  assert.equal(outroAntesDoRetry.id, anexo2.id);
  assert.equal(
    repo.registrarFalhaAnexo({
      anexoId: outroAntesDoRetry.id,
      leaseToken: outroAntesDoRetry.lease_token,
      codigo: "revisao_manual",
      temporaria: false,
      agora: 16001,
    }),
    true,
  );
  const capturar = repo.reservarAnexo({
    contaId: conta.id,
    agora: 16000,
    leaseMs: 1000,
  });
  assert.equal(capturar.id, anexo1.id);
  assert.throws(
    () =>
      repo.concluirAnexo({
        anexoId: capturar.id,
        leaseToken: capturar.lease_token,
        resultado: "capturado",
        documentoId: 999,
        hash: "b".repeat(64),
        agora: 16001,
      }),
    /Documento de faturamento inexistente/,
  );
  const bytes = Buffer.from("%PDF-1.4\nconteudo de teste");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const documentoId = Number(
    banco
      .prepare(
        "INSERT INTO faturamento_documentos(hash,nome,pdf,lote,texto,extracao,dados) VALUES(?,?,?,?,?,?,?)",
      )
      .run(hash, "fatura-a.pdf", bytes, "teste", "", "{}", "{}")
      .lastInsertRowid,
  );
  assert.throws(
    () =>
      repo.concluirAnexo({
        anexoId: capturar.id,
        leaseToken: capturar.lease_token,
        resultado: "capturado",
        documentoId,
        hash: "c".repeat(64),
        agora: 16001,
      }),
    /hash divergente/,
  );
  assert.equal(
    repo.concluirAnexo({
      anexoId: capturar.id,
      leaseToken: capturar.lease_token,
      resultado: "capturado",
      documentoId,
      hash,
      agora: 16001,
    }),
    true,
  );
  assert.equal(
    repo.listarAnexos({ contaId: conta.id, estado: "capturado" }).length,
    1,
  );
  repo.reagendarAnexo(anexo2.id);
  const antesDaPausa = repo.reservarAnexo({
    contaId: conta.id,
    agora: 17000,
    leaseMs: 1000,
  });
  assert.equal(antesDaPausa.id, anexo2.id);
  repo.definirPausa({ contaId: conta.id, pausada: true });
  assert.equal(
    repo.concluirAnexo({
      anexoId: antesDaPausa.id,
      leaseToken: antesDaPausa.lease_token,
      resultado: "capturado",
      documentoId,
      hash,
      agora: 17001,
    }),
    false,
  );
  assert.equal(
    repo.listarAnexos({ contaId: conta.id, estado: "pendente" }).length,
    1,
  );
  repo.definirPausa({ contaId: conta.id, pausada: false });
  const aposPausa = repo.reservarAnexo({
    contaId: conta.id,
    agora: 17001,
    leaseMs: 1000,
  });
  assert.notEqual(aposPausa.lease_token, antesDaPausa.lease_token);
  assert.throws(
    () =>
      repo.concluirAnexo({
        anexoId: aposPausa.id,
        leaseToken: aposPausa.lease_token,
        resultado: "pendente_manual",
        agora: 17002,
      }),
    /Resultado do anexo inválido/,
  );
  assert.equal(
    repo.registrarFalhaAnexo({
      anexoId: aposPausa.id,
      leaseToken: aposPausa.lease_token,
      codigo: "pdf_invalido",
      temporaria: false,
      agora: 17002,
    }),
    true,
  );
  const manual = repo.listarAnexos({
    contaId: conta.id,
    estado: "pendente_manual",
  })[0];
  assert.equal(manual.documento_id, null);
  assert.equal(manual.hash_pdf, null);
  repo.reagendarAnexo(manual.id);
  const antesDaRevogacao = repo.reservarAnexo({
    contaId: conta.id,
    agora: 17003,
    leaseMs: 1000,
  });
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(
    banco.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  repo.definirAutorizacao({ contaId: conta.id, estado: "reconectar" });
  assert.equal(repo.obterConta(conta.id).pausada, 1);
  assert.equal(
    repo.concluirAnexo({
      anexoId: antesDaRevogacao.id,
      leaseToken: antesDaRevogacao.lease_token,
      resultado: "capturado",
      documentoId,
      hash,
      agora: 17004,
    }),
    false,
  );
  assert.throws(
    () => repo.reservarMensagem({ contaId: conta.id, agora: 17000 }),
    /não está ativa/,
  );
  assert.equal(
    banco.prepare("SELECT valor FROM dados_anteriores").get().valor,
    "preservado",
  );
  console.log("Persistência Gmail: testes concluídos.");
} finally {
  segundaConexao?.close();
  banco.close();
}
