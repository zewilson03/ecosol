import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { prepararFaturamento } from "../servidor/faturamento/esquema.mjs";

const banco = new DatabaseSync(":memory:");
banco.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE usinas (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    localizacao TEXT NOT NULL,
    potencia_kw REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Em implantação'
  );
`);
prepararFaturamento(banco);

const inserirUnidade = banco.prepare(`
  INSERT INTO faturamento_unidades
    (uc,nome,documento,email,dia_vencimento,cliente_id)
  VALUES(?,?,?,?,?,?)
`);
const primeira = Number(
  inserirUnidade.run("UC-ATUAL-A", "Mesmo cliente", "", "", 0, 10)
    .lastInsertRowid,
);
const segunda = Number(
  inserirUnidade.run("UC-ATUAL-B", "Mesmo cliente", "", "", 0, 10)
    .lastInsertRowid,
);

const inserirAlias = banco.prepare(`
  INSERT INTO faturamento_unidades_aliases(unidade_id,uc,origem)
  VALUES(?,?,?)
`);
inserirAlias.run(primeira, "UC-ANTIGA-A1", "Teste");
inserirAlias.run(primeira, "UC-ANTIGA-A2", "Teste");
inserirAlias.run(segunda, "UC-ANTIGA-B1", "Teste");

const localizar = banco.prepare(`
  SELECT u.id,u.uc
  FROM faturamento_unidades u
  WHERE u.uc=?
     OR u.id=(SELECT unidade_id FROM faturamento_unidades_aliases WHERE uc=?)
`);
for (const identificador of ["UC-ATUAL-A", "UC-ANTIGA-A1", "UC-ANTIGA-A2"])
  assert.equal(localizar.get(identificador, identificador).id, primeira);
for (const identificador of ["UC-ATUAL-B", "UC-ANTIGA-B1"])
  assert.equal(localizar.get(identificador, identificador).id, segunda);

assert.throws(
  () => inserirAlias.run(segunda, "UC-ANTIGA-A1", "Sobreposição"),
  /UNIQUE|outro cadastro|constraint/i,
  "Uma UC antiga não pode identificar duas unidades diferentes.",
);
assert.throws(
  () =>
    inserirUnidade.run("UC-ANTIGA-A2", "Cadastro sobreposto", "", "", 0, 10),
  /identificador histórico|constraint/i,
  "Uma UC histórica não pode reaparecer como nova unidade independente.",
);

// Quando uma nova numeração comprovada substitui a atual, o id da unidade
// permanece. A numeração anterior vira mais um identificador histórico.
banco.exec("BEGIN IMMEDIATE");
try {
  banco
    .prepare("UPDATE faturamento_unidades SET uc=? WHERE id=?")
    .run("UC-NOVA-A", primeira);
  inserirAlias.run(primeira, "UC-ATUAL-A", "Renumerada em teste");
  banco.exec("COMMIT");
} catch (erro) {
  banco.exec("ROLLBACK");
  throw erro;
}

for (const identificador of [
  "UC-NOVA-A",
  "UC-ATUAL-A",
  "UC-ANTIGA-A1",
  "UC-ANTIGA-A2",
]) {
  const unidade = localizar.get(identificador, identificador);
  assert.equal(unidade.id, primeira);
  assert.equal(unidade.uc, "UC-NOVA-A");
}
assert.equal(
  banco
    .prepare(
      "SELECT COUNT(*) AS total FROM faturamento_unidades WHERE cliente_id=10",
    )
    .get().total,
  2,
  "O mesmo cliente continua podendo possuir várias UCs atuais.",
);
assert.equal(
  banco.prepare("PRAGMA integrity_check").get().integrity_check,
  "ok",
);
assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
banco.close();

console.log(
  "OK: cliente com múltiplas UCs, histórico sem sobreposição e renumeração preservada.",
);
