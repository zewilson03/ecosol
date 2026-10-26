import assert from "node:assert/strict";
import { simularDocumentoCentral } from "../servidor/faturamento/simulacaoCentral.mjs";

function bancoComDocumento(existe) {
  return {
    prepare() {
      return { get: () => (existe ? { id: 840 } : undefined) };
    },
  };
}

let chamadas = 0;
const simulador = async ({ documentos }) => {
  chamadas++;
  assert.deepEqual(documentos, [840]);
  return {
    resultados: [
      {
        documento: 840,
        situacao: "simulada",
        ucAntiga: "20057570",
        ucNova: "67069001202",
        valorBoleto: "10,00",
        motivos: [],
      },
    ],
  };
};

const simulada = await simularDocumentoCentral({
  banco: bancoComDocumento(true),
  documentoId: 840,
  simular: simulador,
});
assert.equal(simulada.ucNova, "67069001202");
assert.equal(chamadas, 1);

const revisar = await simularDocumentoCentral({
  banco: bancoComDocumento(true),
  documentoId: 840,
  simular: async () => ({
    resultados: [
      { documento: 840, situacao: "revisar", motivos: ["linha_ambigua"] },
    ],
  }),
});
assert.deepEqual(revisar.motivos, ["linha_ambigua"]);

await assert.rejects(
  simularDocumentoCentral({
    banco: bancoComDocumento(false),
    documentoId: 840,
    simular: simulador,
  }),
  /documento_gmail_indisponivel/,
);
await assert.rejects(
  simularDocumentoCentral({
    banco: bancoComDocumento(true),
    documentoId: 840,
    simular: async () => ({
      resultados: [{ documento: 840, situacao: "fora" }],
    }),
  }),
  /simulacao_central_invalida/,
);

console.log("Conferência Faturas: integração consultiva da Central validada.");
