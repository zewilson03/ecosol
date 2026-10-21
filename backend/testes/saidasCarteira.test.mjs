import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { prepararFaturamento } from "../servidor/faturamento/esquema.mjs";
import {
  saidaDaCarteiraNaCompetencia,
  usinaDaUnidadeNaCompetencia,
} from "../servidor/faturamento/vinculosUsinas.mjs";
import { sincronizarVinculoDaGeradora } from "../servidor/faturamento/preenchimentoPorGeradora.mjs";

const banco = new DatabaseSync(":memory:");
try {
  banco.exec("CREATE TABLE usinas (id INTEGER PRIMARY KEY,nome TEXT NOT NULL)");
  banco
    .prepare("INSERT INTO usinas(id,nome) VALUES(?,?)")
    .run(1, "Usina Ecosol");
  banco
    .prepare("INSERT INTO usinas(id,nome) VALUES(?,?)")
    .run(2, "Outra usina Ecosol");
  prepararFaturamento(banco);
  const unidadeId = Number(
    banco
      .prepare(
        `INSERT INTO faturamento_unidades
         (uc,nome,documento,email,dia_vencimento,usina_id)
         VALUES(?,?,?,?,?,?)`,
      )
      .run("900001001", "UC transferida", "", "", 10, 1).lastInsertRowid,
  );
  banco
    .prepare(
      "INSERT INTO faturamento_vinculos_usina(unidade_id,inicio,usina_id) VALUES(?,?,?)",
    )
    .run(unidadeId, "2026-09", 1);
  banco
    .prepare(
      `INSERT INTO faturamento_saidas_carteira
       (unidade_id,inicio,data_efetiva,destino_externo,evidencia,operacao_id)
       VALUES(?,?,?,?,?,?)`,
    )
    .run(
      unidadeId,
      "2026-10",
      "2026-10-02",
      "Consórcio RBR Energia",
      "planilha de transferências, linha de teste",
      "teste-saida-rbr-1",
    );

  assert.equal(saidaDaCarteiraNaCompetencia(banco, unidadeId, "2026-09"), null);
  assert.equal(
    saidaDaCarteiraNaCompetencia(banco, unidadeId, "2026-10").destino_externo,
    "Consórcio RBR Energia",
  );
  assert.equal(
    saidaDaCarteiraNaCompetencia(banco, unidadeId, "2026-10").data_efetiva,
    "2026-10-02",
  );
  assert.equal(usinaDaUnidadeNaCompetencia(banco, unidadeId, "2026-09"), 1);
  assert.equal(usinaDaUnidadeNaCompetencia(banco, unidadeId, "2026-10"), 1);
  assert.equal(
    sincronizarVinculoDaGeradora(banco, {
      unidade: { id: unidadeId },
      identificacao: { situacao: "identificada", usina: { id: 2 } },
      competencia: "2026-10",
    }).motivo,
    "fora_da_carteira",
  );
  assert.equal(
    banco
      .prepare("SELECT usina_id FROM faturamento_unidades WHERE id=?")
      .get(unidadeId).usina_id,
    1,
  );

  const documentoId = Number(
    banco
      .prepare(
        `INSERT INTO faturamento_documentos
         (hash,nome,pdf,lote,texto,extracao,dados,unidade_id,competencia,status)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "saida-rbr-pendente",
        "pendente.pdf",
        Buffer.from("%PDF-1.4"),
        "teste",
        "",
        "{}",
        "{}",
        unidadeId,
        "2026-10",
        "Pendente de revisão",
      ).lastInsertRowid,
  );
  assert.throws(
    () =>
      banco
        .prepare(
          "UPDATE faturamento_documentos SET status='Calculada' WHERE id=?",
        )
        .run(documentoId),
    /fora da carteira operacional/,
  );
  assert.equal(
    banco
      .prepare("SELECT status FROM faturamento_documentos WHERE id=?")
      .get(documentoId).status,
    "Pendente de revisão",
  );
  assert.equal(
    banco.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  console.log(
    "OK: saída externa preserva histórico e bloqueia novos cálculos/vínculos.",
  );
} finally {
  banco.close();
}
