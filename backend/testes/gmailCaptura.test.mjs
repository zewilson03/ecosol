import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-captura-"));
process.env.GMAIL_OAUTH_CLIENT_ID = "cliente-teste";
process.env.GMAIL_OAUTH_CLIENT_SECRET = "segredo-teste";
process.env.GMAIL_OAUTH_REDIRECT_URI =
  "http://localhost:3000/api/admin/gmail/oauth/retorno";
process.env.GMAIL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { criarRepositorioGmail } =
  await import("../servidor/gmail/repositorio.mjs");
const { cifrarRefreshToken } =
  await import("../servidor/gmail/credenciais.mjs");
const { receberAnexoGmail } =
  await import("../servidor/gmail/receberAnexo.mjs");
const { criarSincronizadorGmail, partesPdf } =
  await import("../servidor/gmail/sincronizar.mjs");
const { ErroGoogleGmail } = await import("../servidor/gmail/google.mjs");

const db = obterBanco();
const repo = criarRepositorioGmail(db);
const pdf = Buffer.from("%PDF-1.4\nPDF de teste sem dados reais\n");
const ler = async () => ({
  texto: "Fatura de teste",
  dados: {},
  qualidade: { modo: "automatico" },
});

function conta(email) {
  const nova = repo.cadastrarConta({ email, dataInicio: "2026-10-01" });
  repo.definirAutorizacao({ contaId: nova.id, estado: "conectada" });
  repo.definirPausa({ contaId: nova.id, pausada: false });
  return nova.id;
}

function enfileirar(contaId, messageId) {
  let progresso = repo.obterProgresso(contaId);
  if (!progresso.marco_history_id && progresso.fase === "inicial")
    progresso = repo.iniciarVarreduraCompleta({ contaId, historyId: "100" });
  repo.registrarPagina({
    contaId,
    versaoEsperada: progresso.versao,
    cursorEsperado: progresso.cursor_pagina,
    mensagens: [messageId],
  });
  const mensagem = repo.reservarMensagem({ contaId });
  assert.equal(mensagem.message_id, messageId);
  assert.equal(
    repo.registrarAnexosDaMensagem({
      mensagemId: mensagem.id,
      leaseToken: mensagem.lease_token,
      anexos: [
        {
          messageId,
          partPath: "0.0",
          attachmentId: "a1",
          nome: "fatura.pdf",
          mimeType: "application/pdf",
        },
      ],
    }),
    true,
  );
  return repo.reservarAnexo({ contaId });
}

try {
  const primeira = conta("captura1@gmail.com");
  const anexo1 = enfileirar(primeira, "m1");
  db.exec(`CREATE TRIGGER falha_recebimento BEFORE INSERT ON faturamento_recebimentos_pdf
    WHEN NEW.gmail_anexo_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'falha simulada'); END`);
  await assert.rejects(
    receberAnexoGmail({ anexo: anexo1, arquivo: pdf, banco: db, ler }),
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM faturamento_documentos").get().n,
    0,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM faturamento_recebimentos_pdf WHERE gmail_anexo_id IS NOT NULL",
      )
      .get().n,
    0,
  );
  db.exec("DROP TRIGGER falha_recebimento");
  assert.equal(
    (await receberAnexoGmail({ anexo: anexo1, arquivo: pdf, banco: db, ler }))
      .duplicado,
    false,
  );
  assert.equal(
    (await receberAnexoGmail({ anexo: anexo1, arquivo: pdf, banco: db, ler }))
      .confirmado,
    false,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM faturamento_documentos").get().n,
    1,
  );
  assert.equal(
    db.prepare("SELECT classificacao FROM faturamento_documentos LIMIT 1").get()
      .classificacao,
    "triagem",
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM faturamento_recebimentos_pdf WHERE gmail_anexo_id IS NOT NULL",
      )
      .get().n,
    1,
  );

  const segunda = conta("captura2@gmail.com");
  const anexo2 = enfileirar(segunda, "m2");
  const duplicata = await receberAnexoGmail({
    anexo: anexo2,
    arquivo: pdf,
    banco: db,
    ler,
  });
  assert.equal(duplicata.duplicado, true);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM faturamento_documentos").get().n,
    1,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM faturamento_recebimentos_pdf WHERE gmail_anexo_id IS NOT NULL",
      )
      .get().n,
    2,
  );

  const terceira = conta("captura3@gmail.com");
  const anexo3 = enfileirar(terceira, "m3");
  const pausado = await receberAnexoGmail({
    anexo: anexo3,
    arquivo: pdf,
    banco: db,
    ler: async () => {
      repo.definirPausa({ contaId: terceira, pausada: true });
      return ler();
    },
  });
  assert.equal(pausado.confirmado, false);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM faturamento_recebimentos_pdf WHERE gmail_anexo_id=?",
      )
      .get(anexo3.id).n,
    0,
  );

  const quarta = conta("captura4@gmail.com");
  db.prepare(
    `INSERT INTO gmail_credenciais
    (conta_id,refresh_token_cifrado,email_verificado,escopo,autorizado_em,autorizado_por)
    VALUES (?,?,?,?,?,?)`,
  ).run(
    quarta,
    cifrarRefreshToken("refresh-teste", quarta, Buffer.alloc(32, 9)),
    "captura4@gmail.com",
    "https://www.googleapis.com/auth/gmail.readonly",
    Date.now(),
    1,
  );
  const chamadas = [];
  let renovacoes = 0;
  let acessoExpirado = true;
  let leiturasMensagem = 0;
  const cliente = {
    async renovarAcesso() {
      renovacoes++;
      return { accessToken: `acesso-teste-${renovacoes}`, expiresIn: 3600 };
    },
    async obterPerfilCompleto() {
      return { email: "captura4@gmail.com", historyId: "100" };
    },
    async listarMensagens({ pagina }) {
      chamadas.push(pagina ?? "inicio");
      return pagina
        ? { mensagens: [{ id: "m5" }], proximaPagina: null }
        : { mensagens: [{ id: "m4" }], proximaPagina: "pagina-2" };
    },
    async listarHistorico() {
      return {
        mensagens: [{ id: "m6" }],
        proximaPagina: null,
        historyId: "101",
      };
    },
    async obterMensagem({ id }) {
      if (acessoExpirado) {
        acessoExpirado = false;
        throw new ErroGoogleGmail("autorizacao", 401);
      }
      leiturasMensagem++;
      return {
        id,
        internalDate: String(Date.UTC(2026, 9, 2)),
        payload: {
          mimeType: "multipart/mixed",
          parts: [
            {
              mimeType: "application/pdf",
              filename: `${id}.pdf`,
              body: {
                size: pdf.length,
                attachmentId: `a-${id}-${leiturasMensagem}`,
              },
            },
          ],
        },
      };
    },
    async obterAnexo() {
      return { size: pdf.length, data: pdf.toString("base64url") };
    },
  };
  const sincronizador = criarSincronizadorGmail({
    banco: () => db,
    criarCliente: () => cliente,
    receber: (entrada) => receberAnexoGmail({ ...entrada, ler }),
  });
  assert.equal((await sincronizador.sincronizar(quarta)).concluida, true);
  assert.equal(renovacoes, 2);
  assert.equal(repo.obterConta(quarta).status_autorizacao, "conectada");
  assert.deepEqual(chamadas, ["inicio", "pagina-2"]);
  assert.equal(
    repo.contarEstados(quarta).find((x) => x.estado === "duplicado")
      ?.quantidade,
    3,
  );
  assert.equal(repo.obterProgresso(quarta).history_id, "101");

  const quinta = conta("captura5@gmail.com");
  db.prepare(
    `INSERT INTO gmail_credenciais
    (conta_id,refresh_token_cifrado,email_verificado,escopo,autorizado_em,autorizado_por)
    VALUES (?,?,?,?,?,?)`,
  ).run(
    quinta,
    cifrarRefreshToken("refresh-teste", quinta, Buffer.alloc(32, 9)),
    "captura5@gmail.com",
    "https://www.googleapis.com/auth/gmail.readonly",
    Date.now(),
    1,
  );
  const clienteMultiplos = {
    ...cliente,
    async obterPerfilCompleto() {
      return { email: "captura5@gmail.com", historyId: "200" };
    },
    async listarMensagens() {
      return { mensagens: [{ id: "m7" }], proximaPagina: null };
    },
    async listarHistorico() {
      return { mensagens: [], proximaPagina: null, historyId: "201" };
    },
    async obterMensagem() {
      return {
        id: "m7",
        internalDate: String(Date.UTC(2026, 9, 2)),
        payload: {
          mimeType: "multipart/mixed",
          parts: [
            {
              mimeType: "application/pdf",
              filename: "valido.pdf",
              body: { size: pdf.length, attachmentId: "bom" },
            },
            {
              mimeType: "application/pdf",
              filename: "grande.pdf",
              body: { size: 10 * 1024 * 1024 + 1, attachmentId: "grande" },
            },
          ],
        },
      };
    },
  };
  const sincronizadorMultiplos = criarSincronizadorGmail({
    banco: () => db,
    criarCliente: () => clienteMultiplos,
    receber: (entrada) => receberAnexoGmail({ ...entrada, ler }),
  });
  assert.equal(
    (await sincronizadorMultiplos.sincronizar(quinta)).concluida,
    true,
  );
  assert.equal(
    repo.contarEstados(quinta).find((x) => x.estado === "duplicado")
      ?.quantidade,
    1,
  );
  assert.equal(
    repo.contarEstados(quinta).find((x) => x.estado === "pendente_manual")
      ?.quantidade,
    1,
  );
  assert.deepEqual(
    partesPdf({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "application/pdf", filename: "ruim.pdf", body: {} },
        {
          mimeType: "application/pdf",
          filename: "bom.pdf",
          body: { size: pdf.length, attachmentId: "bom" },
        },
      ],
    }).map((item) => item.tamanho),
    [null, pdf.length],
  );

  const sexta = conta("captura6@gmail.com");
  db.prepare(
    `INSERT INTO gmail_credenciais
    (conta_id,refresh_token_cifrado,email_verificado,escopo,autorizado_em,autorizado_por)
    VALUES (?,?,?,?,?,?)`,
  ).run(
    sexta,
    cifrarRefreshToken("refresh-teste", sexta, Buffer.alloc(32, 9)),
    "captura6@gmail.com",
    "https://www.googleapis.com/auth/gmail.readonly",
    Date.now(),
    1,
  );
  let falharPagina = true;
  const clienteInterrompido = {
    ...cliente,
    async obterPerfilCompleto() {
      return { email: "captura6@gmail.com", historyId: "300" };
    },
    async listarMensagens({ pagina }) {
      if (!pagina)
        return { mensagens: [{ id: "m8" }], proximaPagina: "segunda" };
      if (falharPagina) throw new Error("rede simulada");
      return { mensagens: [{ id: "m9" }], proximaPagina: null };
    },
    async listarHistorico() {
      return { mensagens: [], proximaPagina: null, historyId: "301" };
    },
  };
  const sincronizadorInterrompido = criarSincronizadorGmail({
    banco: () => db,
    criarCliente: () => clienteInterrompido,
    receber: (entrada) => receberAnexoGmail({ ...entrada, ler }),
  });
  await assert.rejects(sincronizadorInterrompido.sincronizar(sexta));
  assert.equal(repo.obterProgresso(sexta).cursor_pagina, "segunda");
  assert.equal(repo.listarMensagens({ contaId: sexta }).length, 1);
  falharPagina = false;
  assert.equal(
    (await sincronizadorInterrompido.sincronizar(sexta)).concluida,
    true,
  );
  assert.equal(repo.listarMensagens({ contaId: sexta }).length, 2);
  assert.equal(
    repo.contarEstados(sexta).find((x) => x.estado === "duplicado")?.quantidade,
    2,
  );
  const setima = conta("captura7@gmail.com");
  db.prepare(
    `INSERT INTO gmail_credenciais
    (conta_id,refresh_token_cifrado,email_verificado,escopo,autorizado_em,autorizado_por)
    VALUES (?,?,?,?,?,?)`,
  ).run(
    setima,
    cifrarRefreshToken("refresh-teste", setima, Buffer.alloc(32, 9)),
    "captura7@gmail.com",
    "https://www.googleapis.com/auth/gmail.readonly",
    Date.now(),
    1,
  );
  let leituras = 0;
  const clienteLixeira = {
    ...cliente,
    async obterPerfilCompleto() {
      return { email: "captura7@gmail.com", historyId: "400" };
    },
    async listarMensagens() {
      return { mensagens: [{ id: "m10" }], proximaPagina: null };
    },
    async listarHistorico() {
      return { mensagens: [], proximaPagina: null, historyId: "401" };
    },
    async obterMensagem() {
      leituras++;
      return {
        id: "m10",
        internalDate: String(Date.UTC(2026, 9, 2)),
        labelIds: leituras === 1 ? ["INBOX"] : ["TRASH"],
        payload: {
          mimeType: "application/pdf",
          filename: "fatura.pdf",
          body: { size: pdf.length, attachmentId: "a10" },
        },
      };
    },
  };
  const sincronizadorLixeira = criarSincronizadorGmail({
    banco: () => db,
    criarCliente: () => clienteLixeira,
    receber: (entrada) => receberAnexoGmail({ ...entrada, ler }),
  });
  assert.equal(
    (await sincronizadorLixeira.sincronizar(setima)).concluida,
    true,
  );
  assert.equal(repo.contarEstados(setima)[0].estado, "pendente_manual");
  assert.equal(
    repo.listarAnexos({ contaId: setima })[0].erro_codigo,
    "mensagem_excluida",
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM faturamento_recebimentos_pdf WHERE gmail_anexo_id=?",
      )
      .get(repo.listarAnexos({ contaId: setima })[0].id).n,
    0,
  );
  assert.equal(
    db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  console.log(
    "Captura Gmail: paginação, histórico, PDF, duplicidade, rollback e pausa OK.",
  );
} finally {
  db.close();
}
