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
    versao INTEGER, competencia TEXT, unidade_id INTEGER, hash TEXT, excluido_em TEXT
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
    (101, 'financeiro.pdf', 'triagem', 'cobranca', 1, '2026-10', 1, 'a', NULL),
    (102, 'desconhecido.pdf', 'fatura', 'cobranca', 1, '2026-10', 2, 'b', NULL),
    (103, 'sem-anexo.pdf', 'triagem', 'cobranca', 1, '2026-10', 3, 'c', NULL),
    (104, 'royer.pdf', 'triagem', 'cobranca', 1, '2026-10', 4, 'd', NULL);
`);

const resultado = await prepararLoteCentralDaCaptura({
  banco,
  contaId: 7,
  capturaId: 41,
  localizar: async ({ documentos }) => {
    assert.deepEqual(documentos, [101, 102, 104]);
    return {
      resultados: [
        {
          documento: 101,
          situacao: "segura",
          usina: "Abadiânia",
          cliente: "Cliente financeiro",
          competencia: "2026-10",
        },
        {
          documento: 102,
          situacao: "revisar",
          motivo: "linha_da_uc_ambigua:2",
          ucNova: "123456789012",
          cliente: "Cliente em revisão",
          usina: "Usina em revisão",
          competencia: "2026-10",
        },
        {
          documento: 104,
          situacao: "identificada",
          usina: "Royer",
          cliente: "Cliente Royer",
          competencia: "2026-10",
          motivoFinanceiro: "planilha_da_usina_nao_localizada",
        },
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
  identificadosDocumentalmente: 2,
  documentosDocumentaisProntos: 0,
  revisaoDocumental: 4,
  financeiramenteAptos: 1,
  revisaoFinanceira: 2,
  elegiveis: 2,
  preparados: 2,
  revisar: 2,
  processados: 0,
  falhas: 0,
  pdfsProntosParaImpressao: 0,
});
assert.equal(resultado.itens[0].situacao, "preparado");
assert.equal(resultado.itens[0].modo, "financeiro");
assert.deepEqual(resultado.itens[1].motivos, ["linha_da_uc_ambigua:2"]);
assert.equal(resultado.itens[1].simulacao.cliente, "Cliente em revisão");
assert.equal(resultado.itens[1].simulacao.competencia, "2026-10");
assert.deepEqual(resultado.itens[2].motivos, ["anexo_nao_disponivel_no_lote"]);
assert.equal(resultado.itens[3].situacao, "preparado");
assert.equal(resultado.itens[3].modo, "documental");
assert.equal(resultado.itens[3].simulacao.cliente, "Cliente Royer");
assert.equal(resultado.itens[3].simulacao.competencia, "2026-10");
assert.equal(resultado.itens[3].simulacao.motivoFinanceiro, "planilha_da_usina_nao_localizada");
assert.equal(
  banco.prepare("SELECT COUNT(*) AS total FROM faturamento_documentos").get()
    .total,
  4,
);

let persistido = null;
let documentosFinanceirosProcessados = [];
const documental = await prepararLoteCentralDaCaptura({
  banco,
  contaId: 7,
  capturaId: 41,
  localizar: async () => ({
    resultados: [
      {
        documento: 101,
        situacao: "segura",
        ucNova: "408283801242",
        cliente: "Cliente financeiro",
        usina: "Abadiânia",
        planilha: "C:\\homologacao\\abadiania.xlsx",
        mesFaturamento: "NOV",
      },
      {
        documento: 102,
        situacao: "identificada",
        ucNova: "100000000102",
        cliente: "Cliente sem linha financeira",
        usina: "Usina sem modalidade",
        motivoFinanceiro: "planilha_da_usina_nao_localizada",
      },
      {
        documento: 104,
        situacao: "identificada",
        ucNova: "32836401204",
        cliente: "Cliente Royer",
        usina: "Royer",
      },
    ],
  }),
  simular: async () => ({
    resultados: [
      {
        documento: 101,
        situacao: "simulada",
        ucNova: "408283801242",
        cliente: "Cliente financeiro",
        usina: "Abadiânia",
        planilha: "C:\\homologacao\\abadiania.xlsx",
        mesFaturamento: "NOV",
      },
    ],
  }),
  processarFinanceiro: async ({ documentos }) => {
    documentosFinanceirosProcessados = documentos;
    return {
      situacao: "concluido",
      pdfs: documentos.map((documento) => ({
        documento,
        nomeFinal: `${documento}.pdf`,
        pdf_final: `C:\\homologacao\\financeiro-${documento}.pdf`,
        pdf_impressao: `C:\\homologacao\\financeiro-${documento}-a4.pdf`,
        valor_boleto: "3724,71",
      })),
      pendencias: [],
    };
  },
  processarDocumental: async ({ documentos }) => {
    return {
      situacao: "concluido",
      pdfs: documentos.map((documento) => ({
        documento,
        nomeFinal: `${documento}.pdf`,
        pdf_final: `C:\\homologacao\\${documento}.pdf`,
        pdf_impressao: `C:\\homologacao\\${documento}-a4.pdf`,
      })),
      pendencias: [],
    };
  },
  obterPreparacao: () => persistido,
  obterAssinaturaFonte: async () => "fonte-central-a",
  salvarPreparacao: (item) => {
    persistido = { chave_idempotencia: item.chaveIdempotencia, resultado: item.resultado };
  },
});
assert.equal(documental.resumo.pdfsProntosParaImpressao, 3);
assert.equal(documental.resumo.processados, 3);
assert.equal(documental.itens[0].documental.situacao, "pronto");
assert.equal(documental.itens[1].situacao, "revisar");
assert.equal(documental.itens[1].modo, null);
assert.equal(documental.itens[1].documental.situacao, "pronto");
assert.equal(documental.itens[3].documental.situacao, "pronto");
assert.deepEqual(documentosFinanceirosProcessados, [101]);
assert.equal(documental.itens[0].documental.valorBoleto, "3724,71");
const reaproveitado = await prepararLoteCentralDaCaptura({
  banco,
  contaId: 7,
  capturaId: 41,
  localizar: async () => assert.fail("não deve relocalizar preparação idempotente"),
  simular: async () => assert.fail("não deve ressimular preparação idempotente"),
  obterPreparacao: () => persistido,
  obterAssinaturaFonte: async () => "fonte-central-a",
});
assert.equal(reaproveitado.resumo.pdfsProntosParaImpressao, 3);

const resultadoInterrompido = structuredClone(persistido.resultado);
resultadoInterrompido.itens[0].documental = {
  situacao: "revisar",
  motivo: "preparacao_documental_indisponivel:diretorio_de_homologacao_ja_existe",
};
let retomouPreparacaoDocumental = false;
await prepararLoteCentralDaCaptura({
  banco,
  contaId: 7,
  capturaId: 41,
  localizar: async () => ({
    resultados: [
      {
        documento: 101,
        situacao: "segura",
        ucNova: "408283801242",
        cliente: "Cliente financeiro",
        usina: "Abadiânia",
      },
      {
        documento: 102,
        situacao: "identificada",
        ucNova: "100000000102",
        cliente: "Cliente sem linha financeira",
        usina: "Usina sem modalidade",
      },
      {
        documento: 104,
        situacao: "identificada",
        ucNova: "32836401204",
        cliente: "Cliente Royer",
        usina: "Royer",
      },
    ],
  }),
  simular: async () => ({
    resultados: [
      {
        documento: 101,
        situacao: "simulada",
        ucNova: "408283801242",
        cliente: "Cliente financeiro",
        usina: "Abadiânia",
      },
    ],
  }),
  processarDocumental: async ({ documentos }) => {
    retomouPreparacaoDocumental = true;
    return {
      situacao: "concluido",
      pdfs: documentos.map((documento) => ({
        documento,
        nomeFinal: `${documento}.pdf`,
        pdf_final: `C:\\homologacao\\${documento}.pdf`,
        pdf_impressao: `C:\\homologacao\\${documento}-a4.pdf`,
      })),
      pendencias: [],
    };
  },
  obterPreparacao: () => ({
    chave_idempotencia: persistido.chave_idempotencia,
    resultado: resultadoInterrompido,
  }),
  obterAssinaturaFonte: async () => "fonte-central-a",
});
assert.equal(retomouPreparacaoDocumental, true);

let relocalizouComFonteNova = false;
await prepararLoteCentralDaCaptura({
  banco,
  contaId: 7,
  capturaId: 41,
  localizar: async () => {
    relocalizouComFonteNova = true;
    return { resultados: [] };
  },
  simular: async () => ({ resultados: [] }),
  obterPreparacao: () => persistido,
  obterAssinaturaFonte: async () => "fonte-central-b",
  salvarPreparacao: (item) => {
    persistido = { chave_idempotencia: item.chaveIdempotencia, resultado: item.resultado };
  },
});
assert.equal(relocalizouComFonteNova, true);

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

console.log(
  "Lote Central Gmail: origem persistida, revisão e ausência de gravação validadas.",
);
