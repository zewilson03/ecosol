import assert from "node:assert/strict";
import {
  normalizarDecimalImportado,
  normalizarDadosFinanceiros,
} from "../servidor/faturamento/normalizacaoFinanceira.mjs";
import { calcularCobranca } from "../servidor/faturamento/regras.mjs";
import { extrairCampos } from "../servidor/faturamento/extracao.mjs";

for (const [bruto, casas, esperado] of [
  ["36.659999999999997", 2, "36.66"],
  ["7.0000000000000007E-2", 2, "0.07"],
  ["1.1687890000000001", 9, "1.168789"],
  ["1.6996899999999999", 9, "1.69969"],
]) {
  const r = normalizarDecimalImportado(bruto, {
    origem: "planilha_teste",
    tipo: "numero",
    casas,
  });
  assert.equal(r.valor, esperado);
  assert.equal(r.registro.bruto, bruto);
  assert.equal(r.registro.normalizado, esperado);
  assert.equal(r.registro.origem, "planilha_teste");
  assert.equal(r.registro.situacao, "residuo_ieee754");
  assert.equal(
    normalizarDecimalImportado(bruto, {
      origem: "manual",
      tipo: "texto",
      casas,
    }).registro.normalizado,
    null,
  );
  assert.equal(
    normalizarDecimalImportado(r.valor, {
      origem: "planilha_teste",
      tipo: "numero",
      casas,
    }).valor,
    esperado,
  );
}
for (const bruto of ["12.345", "0.00000000000000001", "1.1687891234"]) {
  const r = normalizarDecimalImportado(bruto, {
    origem: "planilha",
    tipo: "numero",
    casas: 2,
  });
  assert.equal(r.valor, bruto);
  assert.equal(r.registro.normalizado, null);
}
assert.equal(
  normalizarDecimalImportado("1.123456789", {
    origem: "planilha",
    tipo: "numero",
    casas: 9,
  }).valor,
  "1.123456789",
);
assert.equal(
  normalizarDecimalImportado("12,34", {
    origem: "manual",
    tipo: "texto",
    casas: 2,
  }).valor,
  "12.34",
);
assert.equal(
  normalizarDecimalImportado("20.00000", {
    origem: "manual",
    tipo: "texto",
    casas: 2,
  }).registro.normalizado,
  null,
);
for (const bruto of ["NaN", "Infinity", "-1", "1.000,00", "1e9999"]) {
  assert.equal(
    normalizarDecimalImportado(bruto, {
      origem: "planilha",
      tipo: "numero",
      casas: 2,
    }).registro.normalizado,
    null,
  );
}
const entrada = {
  injecao: "35",
  tarifa_total: "1.169969",
  desconto: "25",
  total_equatorial: "36.66",
  juros: "0.07",
  multa: "1.49",
  ajuste_gdii: "0",
  modalidade: "GDI",
};
const copia = structuredClone(entrada);
const r = calcularCobranca(entrada);
assert.deepEqual(entrada, copia);
assert.equal(r.total_centavos, 6581);
assert.equal(r.juros_centavos, 7);
assert.equal(r.multa_centavos, 149);
assert.equal(
  r.consumo_centavos +
    r.equatorial_centavos -
    r.juros_centavos -
    r.multa_centavos -
    r.ajuste_centavos,
  r.total_centavos,
);
assert.equal(
  calcularCobranca({ ...entrada, juros: "0", multa: "0" }).total_centavos,
  6737,
);
for (const campos of [
  { juros: "-1" },
  { multa: "1.005" },
  { total_equatorial: "36.659999999999997" },
  { juros: null },
  { juros: "100" },
])
  assert.throws(() => calcularCobranca({ ...entrada, ...campos }));
const extraida = extrairCampos(
  "JUROS MORATORIA 0,07\nJUROS MORATORIA 0,03\nMULTA - 1,49",
);
assert.equal(extraida.dados.juros, "0.10");
assert.equal(extraida.dados.multa, "1.49");
assert.match(extraida.evidencias.juros, /JUROS/);
assert.equal(extrairCampos("JUROS MORATORIA ilegivel").dados.juros, "REVISAR");
const { registros } = normalizarDadosFinanceiros(extraida.dados, {
  origem: "pdf:manual",
  tipo: "texto",
});
assert.equal(registros.juros.bruto, "0.10");
console.log(
  "OK: resíduos importados, precisão legítima, entrada manual estrita, origem e abatimento de encargos.",
);
// Escala de tarifa fixa, sem quantização de resultados intermediários.
const escala6 = calcularCobranca({
  ...entrada,
  injecao: "3",
  tarifa_total: "0.333333",
  desconto: "33.333333",
  total_equatorial: "10",
  ajuste_gdii: "0.10",
  juros: "0.02",
  multa: "0.03",
  modalidade: "GDII",
});
assert.equal(escala6.tarifa_completa, "0.333333");
assert.equal(escala6.consumo_bruto, "0.66666600333333");
assert.equal(escala6.total_bruto, "10.51666600333333");
assert.equal(escala6.total_centavos, 1052);
assert.equal(escala6.entradas.desconto, "33.333333");
assert.equal(escala6.precisao.etapa, "total");
const zeros = calcularCobranca({
  ...entrada,
  tarifa_total: "",
  unitario: "0.100000",
  bandeira: "0.200000",
});
assert.equal(zeros.entradas.unitario, "0.100000");
assert.equal(zeros.entradas.bandeira, "0.200000");
assert.equal(zeros.tarifa_completa, "0.300000");
const empate = calcularCobranca({
  ...entrada,
  injecao: "1",
  tarifa_total: "1.005000",
  desconto: "0",
  total_equatorial: "10",
  ajuste_gdii: "0.03",
  juros: "0.01",
  multa: "0.02",
  modalidade: "GDII",
});
assert.equal(empate.consumo_bruto, "1.005");
assert.equal(empate.total_bruto, "10.945");
assert.equal(empate.total_centavos, 1094);
assert.throws(
  () =>
    calcularCobranca({
      ...entrada,
      injecao: "0.000001",
      tarifa_total: "0.000001",
      total_equatorial: "0",
      desconto: "0",
      juros: "0",
      multa: "0",
    }),
  /zerada ou negativa/,
);
for (const tarifa_total of ["1.1234567", "1.123456789"])
  assert.throws(
    () => calcularCobranca({ ...entrada, tarifa_total }),
    /até 6 casas/,
  );
const auditavel = normalizarDadosFinanceiros(
  { tarifa_total: "1.200000", unitario: "1.1687890000000001" },
  { origem: "planilha", tipo: "numero" },
);
assert.equal(auditavel.dados.tarifa_total, "1.200000");
assert.equal(auditavel.dados.unitario, "1.168789");
assert.equal(auditavel.registros.unitario.bruto, "1.1687890000000001");
assert.equal(
  normalizarDadosFinanceiros(
    { tarifa_total: "1.123456789" },
    { origem: "planilha", tipo: "numero" },
  ).registros.tarifa_total.normalizado,
  null,
);
console.log(
  "OK: tarifas 6 casas/zeros finais, percentuais 6 casas, GDII/encargos e HALF_EVEN somente no total.",
);
