import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { extrairCampos } from "../servidor/faturamento/extracao.mjs";
import { montarDemonstrativoBoleto } from "../servidor/bancario/demonstrativoBoleto.mjs";
import { gerarPdfBoletoEcosol } from "../servidor/bancario/pdfBoletoEcosol.mjs";

const consumo = extrairCampos(
  "FORNECIMENTO\nCONSUMO NÃO COMPENSADO\nkWh 50,00 1,000000 50,00\n" +
    "CONSUMO SCEE\nkWh 100,00 1,000000 100,00\nITENS FINANCEIROS",
);
assert.equal(consumo.dados.consumo_total, "150.00");
assert.equal(
  extrairCampos(
    "CONSUMO SCEE kWh 100,00 1,00 100,00\n" +
      "CONSUMO SCEE kWh 120,00 1,00 120,00",
  ).dados.consumo_total,
  undefined,
);
assert.equal(
  extrairCampos(
    "CONSUMO SCEE\nINJECAO SCEE - UC 123 - GD I kWh 100,00 1,00 -100,00",
  ).dados.consumo_total,
  undefined,
);

const snapshot = {
  tipo: "cobranca",
  origem: { documento_id: 1 },
  cliente: { nome: "Cliente de teste" },
  unidade: { uc: "123456789012", competencia: "2026-10" },
  cobranca: {
    valor_centavos: 12000,
    encargos_atraso_centavos: 0,
    vencimento: "2026-11-20",
  },
  memoria_calculo: {
    entradas: { injecao: "100", desconto: "20", modalidade: "GDII" },
    tarifa_completa: "1.000000",
    equatorial_centavos: 5000,
    ajuste_centavos: 1000,
    total_centavos: 12000,
  },
};
const demonstrativo = montarDemonstrativoBoleto(snapshot, "150.00");
assert.equal(demonstrativo.consumo_total_kwh, "150.00");
assert.equal(demonstrativo.equatorial_centavos, 5000);
assert.equal(demonstrativo.referencia_sem_desconto_centavos, 14000);
assert.equal(demonstrativo.total_ecosol_centavos, 12000);
assert.equal(demonstrativo.economia_centavos, 2000);
const classico = montarDemonstrativoBoleto(
  {
    ...snapshot,
    cobranca: { ...snapshot.cobranca, valor_centavos: 14000 },
    memoria_calculo: {
      ...snapshot.memoria_calculo,
      modelo_calculo: "classico",
      entradas: {
        ...snapshot.memoria_calculo.entradas,
        consumo_total: "150",
        iluminacao: "10",
      },
      tarifa_minima_bruto: "50",
      total_centavos: 14000,
    },
  },
  null,
);
assert.equal(classico.equatorial_centavos, null);
assert.equal(classico.tarifa_minima_centavos, 5000);
assert.equal(classico.iluminacao_centavos, 1000);
assert.equal(classico.referencia_sem_desconto_centavos, 16000);
assert.equal(
  montarDemonstrativoBoleto(
    { ...snapshot, memoria_calculo: { total_centavos: 12000 } },
    null,
  ),
  null,
);
assert.throws(
  () =>
    montarDemonstrativoBoleto(
      { ...snapshot, cobranca: { valor_centavos: 11999 } },
      null,
    ),
  /diverge/,
);

const operacao = { id: "teste", tipo: "cobranca", snapshot };
const previa = await gerarPdfBoletoEcosol({ operacao, demonstrativo });
assert.equal((await PDFDocument.load(previa)).getPageCount(), 2);
assert.equal(
  (
    await PDFDocument.load(
      await gerarPdfBoletoEcosol({
        operacao: {
          ...operacao,
          snapshot: {
            ...snapshot,
            cliente: { nome: "EMPRESA DE TESTE ".repeat(12) + "☀" },
          },
        },
        demonstrativo,
      }),
    )
  ).getPageCount(),
  2,
);
const banco = await PDFDocument.create();
banco.addPage([595, 842]);
const pdfFinal = await gerarPdfBoletoEcosol({
  operacao,
  demonstrativo,
  pdfBanco: await banco.save(),
});
assert.equal((await PDFDocument.load(pdfFinal)).getPageCount(), 2);
if (process.env.ECOSOL_TEST_PDF_OUTPUT)
  writeFileSync(process.env.ECOSOL_TEST_PDF_OUTPUT, pdfFinal);
console.log(
  "OK: extração de consumo, valores, economia e PDF final com boleto original.",
);
