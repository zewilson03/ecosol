import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { prepararFaturamento } from "../servidor/faturamento/esquema.mjs";
import {
  chaveProcessamentoCentral,
  concluirProcessamentoCentral,
  iniciarProcessamentoCentral,
  processamentoCentralSeguro,
} from "../servidor/faturamento/processamentoCentral.mjs";

const banco = new DatabaseSync(":memory:");
banco.exec(`CREATE TABLE usinas (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, localizacao TEXT NOT NULL,
  potencia_kw REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Teste'
)`);
prepararFaturamento(banco);
banco
  .prepare(
    "INSERT INTO usinas(id,nome,localizacao) VALUES (9,'Usina documental','Teste')",
  )
  .run();
banco
  .prepare(
    "INSERT INTO usinas_processamento_central(usina_id,modo,origem) VALUES (9,'documental','fixture')",
  )
  .run();
assert.equal(
  banco
    .prepare("SELECT modo FROM usinas_processamento_central WHERE usina_id=9")
    .get().modo,
  "documental",
);
// Registro mínimo só para satisfazer a chave estrangeira; nenhum banco real é usado.
banco
  .prepare(
    `INSERT INTO faturamento_documentos
     (id,hash,nome,pdf,lote,texto,extracao,dados)
     VALUES (41,?,?,?,?,?,?,?)`,
  )
  .run(
    "a".repeat(64),
    "fatura.pdf",
    Buffer.from("pdf"),
    "teste",
    "",
    "{}",
    "{}",
  );
const documento = {
  id: 41,
  versao: 3,
  hash: "a".repeat(64),
  competencia: "2026-11",
  modoProcessamento: "financeiro",
};
const administrador = { id: 7, nome: "Homologação" };

const primeiro = iniciarProcessamentoCentral({
  banco,
  documento,
  administrador,
  modo: "financeiro",
});
assert.equal(primeiro.criado, true);
assert.equal(
  banco
    .prepare(
      "SELECT estado,ambiente,modo FROM faturamento_processamentos_central WHERE id=?",
    )
    .get(primeiro.id).estado,
  "em_andamento",
);
assert.equal(
  banco
    .prepare("SELECT modo FROM faturamento_processamentos_central WHERE id=?")
    .get(primeiro.id).modo,
  "financeiro",
);
assert.equal(chaveProcessamentoCentral(documento).length, 64);

const repetido = iniciarProcessamentoCentral({
  banco,
  documento,
  administrador,
  modo: "financeiro",
});
assert.equal(repetido.criado, false);
assert.equal(repetido.existente.id, primeiro.id);

const concluido = concluirProcessamentoCentral({
  banco,
  id: primeiro.id,
  estado: "concluido",
  resultado: { planilhaPreenchida: "C:\\tmp\\copia.xlsx", pdfs: [] },
});
const seguro = processamentoCentralSeguro(concluido);
assert.equal(seguro.estado, "concluido");
assert.equal(seguro.origem.hash, documento.hash);
assert.equal(seguro.resultado.pdfs.length, 0);
assert.throws(
  () =>
    concluirProcessamentoCentral({
      banco,
      id: primeiro.id,
      estado: "em_andamento",
      resultado: {},
    }),
  /estado_processamento_central_invalido/,
);

console.log(
  "Processamento Central: idempotência e auditoria de homologação validadas.",
);
