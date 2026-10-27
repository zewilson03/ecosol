import assert from "node:assert/strict";
import { obterApuracaoDeDividas } from "../servidor/financeiro/dividas.mjs";

function operacao({ id, estado, valor, vencimento, uc, cliente = "Cliente" }) {
  return {
    id,
    origem_id: id.replace(/\D/g, "") || "1",
    valor_centavos: valor,
    vencimento,
    estado,
    provedor_id: null,
    snapshot: JSON.stringify({
      cliente: { nome: cliente, documento: "12345678901" },
      unidade: { uc, competencia: "2026-09" },
    }),
    atualizado_em: "2026-10-26 12:00:00",
  };
}

const linhas = [
  operacao({
    id: "cobranca-1",
    estado: "registrada",
    valor: 600000,
    vencimento: "2026-10-01",
    uc: "100",
    cliente: "Acima do limite",
  }),
  operacao({
    id: "cobranca-2",
    estado: "registrada",
    valor: 400001,
    vencimento: "2026-10-02",
    uc: "100",
    cliente: "Acima do limite",
  }),
  operacao({
    id: "cobranca-3",
    estado: "registrada",
    valor: 1000000,
    vencimento: "2026-10-03",
    uc: "200",
    cliente: "Igual ao limite",
  }),
  operacao({
    id: "cobranca-4",
    estado: "liquidada",
    valor: 900000,
    vencimento: "2026-09-01",
    uc: "100",
  }),
  operacao({
    id: "cobranca-5",
    estado: "resultado_desconhecido",
    valor: 700000,
    vencimento: "2026-09-01",
    uc: "100",
  }),
  operacao({
    id: "cobranca-6",
    estado: "registrada",
    valor: 50000,
    vencimento: "2026-10-04",
    uc: "",
  }),
];
const banco = {
  prepare() {
    return { all: () => linhas };
  },
};

const resultado = obterApuracaoDeDividas(banco, {}, "2026-10-26", 1_000_000);
assert.equal(resultado.dividas.length, 2);
assert.equal(resultado.dividas[0].uc, "100");
assert.equal(resultado.dividas[0].principal_centavos, 1_000_001);
assert.equal(resultado.dividas[0].encargos_centavos, 41_800);
assert.equal(resultado.dividas[0].total_centavos, 1_041_801);
assert.equal(resultado.dividas[0].alerta, true);
assert.equal(resultado.dividas[0].cobrancas.length, 2);
assert.equal(resultado.dividas[0].cobrancas[0].multa_centavos, 18_000);
assert.equal(resultado.dividas[0].cobrancas[0].juros_centavos, 7_200);
assert.equal(resultado.dividas[1].principal_centavos, 1_000_000);
assert.equal(resultado.dividas[1].encargos_centavos, 41_000);
assert.equal(resultado.dividas[1].total_centavos, 1_041_000);
assert.equal(resultado.dividas[1].alerta, true);
assert.deepEqual(resultado.totais, {
  unidades: 2,
  alertas: 2,
  valor_centavos: 2_082_801,
  cobrancas_sem_uc: 1,
});
assert.doesNotMatch(JSON.stringify(resultado), /12345678901|snapshot/i);

const filtrado = obterApuracaoDeDividas(
  banco,
  { uc: "200" },
  "2026-10-26",
  1_000_000,
);
assert.equal(filtrado.dividas.length, 1);
assert.equal(filtrado.dividas[0].uc, "200");

console.log("Apuração de dívidas por UC validada com sucesso.");
