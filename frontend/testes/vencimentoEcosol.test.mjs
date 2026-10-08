import assert from "node:assert/strict";
import { sugerirVencimentoEcosol } from "../src/admin/vencimentoEcosol.ts";

const dia = (ano, mes, numero) => new Date(Date.UTC(ano, mes - 1, numero, 15));
assert.equal(sugerirVencimentoEcosol(5, dia(2026, 10, 1)), "2026-10-05");
assert.equal(sugerirVencimentoEcosol(5, dia(2026, 10, 5)), "2026-10-05");
assert.equal(sugerirVencimentoEcosol(5, dia(2026, 10, 8)), "2026-11-05");
assert.equal(sugerirVencimentoEcosol(31, dia(2027, 2, 27)), "2027-02-28");
assert.equal(sugerirVencimentoEcosol(31, dia(2027, 2, 28)), "2027-02-28");
assert.equal(sugerirVencimentoEcosol(31, dia(2027, 3, 1)), "2027-03-31");
assert.equal(sugerirVencimentoEcosol(31, dia(2028, 2, 28)), "2028-02-29");
assert.equal(
  sugerirVencimentoEcosol(5, new Date("2026-10-06T01:30:00Z")),
  "2026-10-05",
);
assert.throws(() => sugerirVencimentoEcosol(0), RangeError);
console.log("Vencimentos Ecosol: testes concluídos.");
