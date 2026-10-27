import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ECOSOL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "ecosol-gmail-periodo-"),
);

const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { criarRepositorioGmail } =
  await import("../servidor/gmail/repositorio.mjs");
const {
  atalhoDiarioOitoHoras,
  instanteNoFusoDeSaoPaulo,
  recebidaNoPeriodo,
  validarPeriodoRecebimento,
} = await import("../servidor/gmail/sincronizar.mjs");
const { criarClienteGoogle } = await import("../servidor/gmail/google.mjs");

assert.equal(
  instanteNoFusoDeSaoPaulo("2026-10-22T08:00"),
  Date.UTC(2026, 9, 22, 11),
);
assert.deepEqual(atalhoDiarioOitoHoras(Date.UTC(2026, 9, 22, 12)), {
  inicio: "2026-10-21T08:00",
  fim: "2026-10-22T08:00",
  fuso: "America/Sao_Paulo",
});
const periodo = validarPeriodoRecebimento({
  inicio: "2026-10-21T08:00",
  fim: "2026-10-22T08:00",
});
assert.equal(periodo.inicio, Date.UTC(2026, 9, 21, 11));
assert.equal(periodo.fim, Date.UTC(2026, 9, 22, 11));
assert.equal(recebidaNoPeriodo(String(periodo.inicio), periodo), true);
assert.equal(recebidaNoPeriodo(String(periodo.fim - 1), periodo), true);
assert.equal(recebidaNoPeriodo(String(periodo.fim), periodo), false);
assert.throws(
  () =>
    validarPeriodoRecebimento({
      inicio: "2026-10-22T08:00",
      fim: "2026-10-22T08:00",
    }),
  /anterior/,
);
assert.throws(
  () =>
    validarPeriodoRecebimento({
      inicio: "2026-10-22",
      fim: "2026-10-23T08:00",
    }),
  /inválidas/,
);

const chamadas = [];
const cliente = criarClienteGoogle(
  {
    clientId: "cliente-teste",
    clientSecret: "segredo-teste",
    redirectUri: "http://localhost:3000/api/admin/gmail/oauth/retorno",
  },
  async (url) => {
    chamadas.push(String(url));
    return new Response(JSON.stringify({ messages: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  },
);
await cliente.listarMensagens({
  accessToken: "acesso",
  recebidaApos: Math.floor(periodo.inicio / 1000),
  recebidaAntes: Math.ceil(periodo.fim / 1000),
});
const busca = new URL(chamadas.at(-1));
assert.equal(
  busca.searchParams.get("q"),
  `after:${Math.floor(periodo.inicio / 1000) - 1} before:${Math.ceil(periodo.fim / 1000)}`,
);

const db = obterBanco();
try {
  const repo = criarRepositorioGmail(db);
  const conta = repo.cadastrarConta({
    email: "periodo@gmail.com",
    dataInicio: "2026-10-01",
  });
  repo.definirAutorizacao({ contaId: conta.id, estado: "conectada" });
  repo.definirPausa({ contaId: conta.id, pausada: false });
  assert.deepEqual(
    repo.registrarMensagensAvulsas({
      contaId: conta.id,
      mensagens: ["email-na-borda-inicial", "email-na-borda-inicial"],
    }),
    { inseridas: 1, existentes: 0 },
  );
  assert.deepEqual(
    repo.registrarMensagensAvulsas({
      contaId: conta.id,
      mensagens: ["email-na-borda-inicial"],
    }),
    { inseridas: 0, existentes: 1 },
  );
  assert.equal(repo.listarMensagens({ contaId: conta.id }).length, 1);
  const captura = repo.iniciarCapturaPeriodo({
    contaId: conta.id,
    inicio: "2026-10-21T08:00",
    fim: "2026-10-22T08:00",
    agora: Date.UTC(2026, 9, 22, 12),
  });
  assert.equal(captura.estado, "em_andamento");
  assert.equal(
    repo.iniciarCapturaPeriodo({
      contaId: conta.id,
      inicio: "2026-10-21T08:00",
      fim: "2026-10-22T08:00",
      agora: Date.UTC(2026, 9, 22, 12),
    }).existente,
    true,
  );
  repo.atualizarCapturaPeriodo({ id: captura.id, emails: 18, anexos: 17 });
  assert.equal(
    repo.concluirCapturaPeriodo({
      id: captura.id,
      estado: "concluida",
      capturados: 17,
      duplicados: 0,
      triagem: 0,
      falhas: 0,
      agora: Date.UTC(2026, 9, 22, 12, 1),
    }).estado,
    "concluida",
  );
  const preparacao = repo.salvarPreparacaoCentralDaCaptura({
    capturaId: captura.id,
    chaveIdempotencia: "a".repeat(64),
    estado: "concluida",
    resultado: { resumo: { pdfsProntosParaImpressao: 1 }, itens: [] },
  });
  assert.equal(preparacao.estado, "concluida");
  assert.equal(
    repo.obterPreparacaoCentralDaCaptura(captura.id).resultado.resumo
      .pdfsProntosParaImpressao,
    1,
  );
  repo.salvarPreparacaoCentralDaCaptura({
    capturaId: captura.id,
    chaveIdempotencia: "b".repeat(64),
    estado: "revisar",
    resultado: { resumo: { pdfsProntosParaImpressao: 0 }, itens: [] },
  });
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS total FROM gmail_capturas_periodo_preparacoes_central_historico WHERE captura_id=?",
      )
      .get(captura.id).total,
    1,
  );
  repo.salvarPreparacaoCentralDaCaptura({
    capturaId: captura.id,
    chaveIdempotencia: "b".repeat(64),
    estado: "concluida",
    resultado: { resumo: { pdfsProntosParaImpressao: 1 }, itens: [] },
  });
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS total FROM gmail_capturas_periodo_preparacoes_central_historico WHERE captura_id=?",
      )
      .get(captura.id).total,
    2,
  );
  const retomavel = repo.iniciarCapturaPeriodo({
    contaId: conta.id,
    inicio: "2026-10-22T00:00",
    fim: "2026-10-24T00:00",
    agora: Date.UTC(2026, 9, 24, 3),
  });
  repo.registrarMensagensDaCaptura({
    capturaId: retomavel.id,
    mensagens: [
      { id: "mensagem-estavel", anexos: 1 },
      { id: "mensagem-sem-pdf", anexos: 0 },
    ],
  });
  assert.deepEqual(repo.contagensDaCaptura(retomavel.id), {
    emails: 2,
    anexos: 1,
    capturados: 0,
    duplicados: 0,
    triagem: 0,
    falhas: 0,
  });
  repo.concluirCapturaPeriodo({
    id: retomavel.id,
    estado: "falha",
    capturados: 0,
    duplicados: 0,
    triagem: 0,
    falhas: 1,
    erroCodigo: "google_limite",
    proximaTentativaEm: Date.UTC(2026, 9, 24, 3, 5),
    agora: Date.UTC(2026, 9, 24, 3),
  });
  assert.equal(
    repo.iniciarCapturaPeriodo({
      contaId: conta.id,
      inicio: "2026-10-22T00:00",
      fim: "2026-10-24T00:00",
      agora: Date.UTC(2026, 9, 24, 3, 1),
    }).aguardar,
    true,
  );
  const retomada = repo.iniciarCapturaPeriodo({
    contaId: conta.id,
    inicio: "2026-10-22T00:00",
    fim: "2026-10-24T00:00",
    agora: Date.UTC(2026, 9, 24, 3, 5),
  });
  assert.equal(retomada.retomada, true);
  assert.equal(retomada.estado, "em_andamento");
  assert.equal(retomada.tentativas, 2);
  assert.equal(repo.documentosDaCaptura(retomavel.id).length, 0);
  console.log(
    "Gmail por período: fuso, bordas, retomada, deduplicação e limite OK.",
  );
} finally {
  db.close();
}
