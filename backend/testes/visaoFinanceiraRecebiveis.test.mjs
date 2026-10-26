import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-recebiveis-"));
process.env.NODE_ENV = "test";

const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { obterVisaoDeRecebiveis, validarFiltrosRecebiveis } =
  await import("../servidor/financeiro/recebiveis.mjs");

const banco = obterBanco();
const administradorId = Number(
  banco
    .prepare(
      "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,3)",
    )
    .run("Financeiro", "financeiro-recebiveis@teste.local", "hash")
    .lastInsertRowid,
);
let sequencia = 0;

function inserir({ estado, valor, vencimento, uc, cliente, competencia }) {
  sequencia += 1;
  const id = randomUUID();
  const snapshot = JSON.stringify({
    cliente: { nome: cliente, documento: "12345678901" },
    unidade: { uc, competencia },
  });
  banco
    .prepare(
      `INSERT INTO bancario_operacoes
       (id,tipo,ambiente,conta_referencia,origem_tipo,origem_id,origem_versao,
        idempotencia,valor_centavos,vencimento,snapshot,snapshot_hash,estado,
        preparado_por)
       VALUES(?,'cobranca','homologacao','conta-teste','faturamento_documento',
              ?,1,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      String(sequencia),
      createHash("sha256").update(`idem-${sequencia}`).digest("hex"),
      valor,
      vencimento,
      snapshot,
      createHash("sha256").update(snapshot).digest("hex"),
      estado,
      administradorId,
    );
  return id;
}

inserir({
  estado: "registrada",
  valor: 10000,
  vencimento: "2026-10-20",
  uc: "100200300",
  cliente: "Cliente vencido",
  competencia: "2026-09",
});
inserir({
  estado: "registrada",
  valor: 20000,
  vencimento: "2026-11-20",
  uc: "100200301",
  cliente: "Cliente a receber",
  competencia: "2026-10",
});
inserir({
  estado: "liquidada",
  valor: 30000,
  vencimento: "2026-10-10",
  uc: "100200302",
  cliente: "Cliente pago",
  competencia: "2026-09",
});
inserir({
  estado: "resultado_desconhecido",
  valor: 40000,
  vencimento: "2026-10-12",
  uc: "100200303",
  cliente: "Cliente divergente",
  competencia: "2026-09",
});

const completa = obterVisaoDeRecebiveis(banco, {}, "2026-10-26");
assert.equal(completa.recebiveis.length, 4);
assert.deepEqual(completa.totais.vencido, {
  quantidade: 1,
  valor_centavos: 10000,
});
assert.deepEqual(completa.totais.a_receber, {
  quantidade: 1,
  valor_centavos: 20000,
});
assert.deepEqual(completa.totais.pago, {
  quantidade: 1,
  valor_centavos: 30000,
});
assert.deepEqual(completa.totais.divergente, {
  quantidade: 1,
  valor_centavos: 40000,
});
assert.doesNotMatch(JSON.stringify(completa), /12345678901|snapshot/i);

const porUc = obterVisaoDeRecebiveis(
  banco,
  { uc: "100.200.302" },
  "2026-10-26",
);
assert.equal(porUc.recebiveis.length, 1);
assert.equal(porUc.recebiveis[0].status, "pago");

const porPeriodoEStatus = obterVisaoDeRecebiveis(
  banco,
  { inicio: "2026-10-01", fim: "2026-10-31", status: "vencido" },
  "2026-10-26",
);
assert.equal(porPeriodoEStatus.recebiveis.length, 1);
assert.equal(porPeriodoEStatus.totais.vencido.valor_centavos, 10000);
assert.equal(porPeriodoEStatus.totais.pago.valor_centavos, 0);

assert.throws(
  () => validarFiltrosRecebiveis({ status: "quitado" }),
  /Status financeiro inválido/,
);
assert.throws(
  () => validarFiltrosRecebiveis({ uc: "100 OR 1=1" }),
  /Filtro de UC inválido/,
);
assert.throws(
  () => validarFiltrosRecebiveis({ inicio: "2026-11-01", fim: "2026-10-01" }),
  /data inicial não pode ser posterior/,
);

console.log("Visão financeira de recebíveis validada com sucesso.");
