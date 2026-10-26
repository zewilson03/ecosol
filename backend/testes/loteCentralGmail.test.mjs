import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { modoTemporarioDeHomologacaoCentral } from "../servidor/centralFaturas.mjs";
import { prepararLoteCentralDaCaptura } from "../servidor/gmail/loteCentral.mjs";

assert.equal(modoTemporarioDeHomologacaoCentral("Abadiânia"), "financeiro");
assert.equal(modoTemporarioDeHomologacaoCentral("Ecosol"), "financeiro");
assert.equal(modoTemporarioDeHomologacaoCentral("Royer"), "documental");
assert.equal(modoTemporarioDeHomologacaoCentral("Outra usina"), null);

const banco = new DatabaseSync(":memory:");
banco.exec(`
  CREATE TABLE gmail_capturas_periodo (
    id INTEGER PRIMARY KEY, conta_id INTEGER, estado TEXT, inicio_local TEXT,
    fim_local TEXT, capturados INTEGER, duplicados INTEGER, triagem INTEGER,
    falhas INTEGER
  );
  CREATE TABLE gmail_capturas_periodo_mensagens (
    captura_id INTEGER, message_id TEXT
  );
  CREATE TABLE gmail_anexos (
    conta_id INTEGER, message_id TEXT, estado TEXT, documento_id INTEGER
  );
  CREATE TABLE faturamento_documentos (
    id INTEGER PRIMARY KEY, nome TEXT, classificacao TEXT, finalidade TEXT,
    versao INTEGER, competencia TEXT, unidade_id INTEGER, excluido_em TEXT
  );
  INSERT INTO gmail_capturas_periodo VALUES
    (41, 7, 'concluida', '2026-10-22T08:00', '2026-10-23T08:00', 4, 0, 4, 0),
    (42, 7, 'em_andamento', '2026-10-23T08:00', '2026-10-24T08:00', 0, 0, 0, 0);
  INSERT INTO gmail_capturas_periodo_mensagens VALUES
    (41, 'm-financeiro'), (41, 'm-sem-modalidade'), (41, 'm-sem-anexo'),
    (41, 'm-royer');
  INSERT INTO gmail_anexos VALUES
    (7, 'm-financeiro', 'capturado', 101),
    (7, 'm-sem-modalidade', 'capturado', 102),
    (7, 'm-sem-anexo', 'duplicado', 103),
    (7, 'm-royer', 'capturado', 104);
  INSERT INTO faturamento_documentos VALUES
    (101, 'financeiro.pdf', 'triagem', 'cobranca', 1, '2026-10', 1, NULL),
    (102, 'desconhecido.pdf', 'fatura', 'cobranca', 1, '2026-10', 2, NULL),
    (103, 'sem-anexo.pdf', 'triagem', 'cobranca', 1, '2026-10', 3, NULL),
    (104, 'royer.pdf', 'triagem', 'cobranca', 1, '2026-10', 4, NULL);
`);

const resultado = await prepararLoteCentralDaCaptura({
  banco,
  contaId: 7,
  capturaId: 41,
  localizar: async ({ documentos }) => {
    assert.deepEqual(documentos, [101, 102, 104]);
    return {
      resultados: [
        { documento: 101, situacao: "segura", usina: "Abadiânia" },
        { documento: 102, situacao: "segura", usina: "Usina sem modalidade" },
        { documento: 104, situacao: "segura", usina: "Royer" },
      ],
    };
  },
  simular: async ({ documentos }) => {
    assert.deepEqual(documentos, [101]);
    return {
      resultados: [
        {
          documento: 101,
          situacao: "simulada",
          usina: "Abadiânia",
          ucNova: "408283801242",
          valorBoleto: "3724,71",
        },
      ],
    };
  },
});

assert.equal(resultado.captura.id, 41);
assert.equal(resultado.resumo.documentosNoLote, 4);
assert.deepEqual(resultado.resumo, {
  totalCapturado: 4,
  documentosNoLote: 4,
  elegiveis: 2,
  preparados: 2,
  revisar: 2,
  processados: 0,
  falhas: 0,
  pdfsProntosParaImpressao: 0,
});
assert.equal(resultado.itens[0].situacao, "preparado");
assert.equal(resultado.itens[0].modo, "financeiro");
assert.deepEqual(resultado.itens[1].motivos, [
  "modalidade_operacional_nao_confirmada",
]);
assert.deepEqual(resultado.itens[2].motivos, ["anexo_nao_disponivel_no_lote"]);
assert.equal(resultado.itens[3].situacao, "preparado");
assert.equal(resultado.itens[3].modo, "documental");
assert.equal(
  banco.prepare("SELECT COUNT(*) AS total FROM faturamento_documentos").get().total,
  4,
);

await assert.rejects(
  prepararLoteCentralDaCaptura({
    banco,
    contaId: 7,
    capturaId: 42,
    localizar: async () => ({ resultados: [] }),
    simular: async () => ({ resultados: [] }),
  }),
  /captura_periodo_nao_concluida/,
);

console.log("Lote Central Gmail: origem persistida, revisão e ausência de gravação validadas.");
