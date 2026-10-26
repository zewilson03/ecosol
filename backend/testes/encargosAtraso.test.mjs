import assert from "node:assert/strict";
import { calcularEncargosAtraso } from "../servidor/financeiro/encargosAtraso.mjs";

function calcular(dataReferencia, principal = 10_000) {
  return calcularEncargosAtraso({
    principal_centavos: principal,
    vencimento: "2026-10-01",
    data_referencia: dataReferencia,
  });
}

assert.deepEqual(
  {
    dias: calcular("2026-10-01").dias_atraso,
    total: calcular("2026-10-01").total_centavos,
  },
  { dias: 0, total: 0 },
);
assert.equal(calcular("2026-10-02").total_centavos, 0);

const segundoDia = calcular("2026-10-03");
assert.equal(segundoDia.dias_juros, 1);
assert.equal(segundoDia.multa_centavos, 300);
assert.equal(segundoDia.juros_centavos, 5);
assert.equal(segundoDia.total_centavos, 305);

assert.equal(calcular("2026-10-31").dias_juros, 29);
const trintaEUmDias = calcular("2026-11-01");
assert.equal(trintaEUmDias.dias_juros, 30);
assert.equal(trintaEUmDias.multa_centavos, 300);
assert.equal(trintaEUmDias.juros_centavos, 150);
assert.equal(trintaEUmDias.total_centavos, 450);

const arredondado = calcularEncargosAtraso({
  principal_centavos: 10_001,
  vencimento: "2026-10-01",
  data_referencia: "2026-10-03",
});
assert.equal(arredondado.multa_centavos, 300);
assert.equal(arredondado.juros_centavos, 5);
assert.equal(arredondado.total_centavos, 305);

assert.throws(
  () =>
    calcularEncargosAtraso({
      principal_centavos: 0,
      vencimento: "2026-10-01",
      data_referencia: "2026-10-03",
    }),
  /principal.+positivo/i,
);
assert.throws(
  () =>
    calcularEncargosAtraso({
      principal_centavos: 100,
      vencimento: "2026-02-30",
      data_referencia: "2026-10-03",
    }),
  /vencimento.+inválida/i,
);

console.log("Regra decimal de multa e juros por atraso validada com sucesso.");
