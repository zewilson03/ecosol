import assert from "node:assert/strict";

import {
  avaliarHistoricoPilotoSicoob,
  criarIdempotenciaLegadaPilotoSicoob,
  criarIdempotenciaPilotoSicoob,
} from "../servidor/bancario/idempotenciaPilotoSicoob.mjs";

const entrada = {
  cliente: {
    documento: "529.982.247-25",
    nome: "Cliente Piloto",
    endereco: "Rua de Teste, 100",
    bairro: "Centro",
    cidade: "Goiânia",
    uf: "GO",
    cep: "74000-000",
  },
  uc: "PILOTO-SICOOB",
  valor_centavos: 100,
  vencimento: "2026-10-30",
};
const configuracao = {
  ambiente: "producao",
  contratoVersao: "cobranca-bancaria-v3",
  cobranca: {
    numeroCliente: 123456,
    codigoModalidade: 1,
    numeroContaCorrente: 45678,
    codigoEspecieDocumento: "DM",
    identificacaoEmissaoBoleto: 1,
    identificacaoDistribuicaoBoleto: 2,
    numeroContratoCobranca: null,
    gerarPdf: true,
  },
};

const original = criarIdempotenciaPilotoSicoob({ entrada, configuracao });
const revisaoSeguinte = criarIdempotenciaPilotoSicoob({
  entrada,
  configuracao,
  revisao: 3,
});
assert.notEqual(revisaoSeguinte, original);
assert.throws(
  () =>
    criarIdempotenciaPilotoSicoob({
      entrada,
      configuracao,
      revisao: 1,
    }),
  /revisão idempotente/,
);
assert.equal(original.length, 64);
assert.equal(
  criarIdempotenciaLegadaPilotoSicoob(entrada),
  "e89f61e148e90d4b7f321e210484cee95cfb1c137ffa1a0061b2c21971d920ea",
);
assert.equal(
  criarIdempotenciaPilotoSicoob({
    entrada: {
      ...entrada,
      versao_piloto: 999,
      cliente: {
        ...entrada.cliente,
        documento: "52998224725",
        cep: "74000000",
        uf: "go",
      },
    },
    configuracao: {
      ...configuracao,
      clientId: "nao-participa",
      clientSecret: "segredo-tambem-nao-participa",
    },
  }),
  original,
);

for (const alteracao of [
  { numeroCliente: 123457 },
  { numeroContaCorrente: 45679 },
  { codigoModalidade: 3 },
  { numeroContratoCobranca: 654321 },
]) {
  assert.notEqual(
    criarIdempotenciaPilotoSicoob({
      entrada,
      configuracao: {
        ...configuracao,
        cobranca: { ...configuracao.cobranca, ...alteracao },
      },
    }),
    original,
  );
}
assert.notEqual(
  criarIdempotenciaPilotoSicoob({
    entrada: { ...entrada, valor_centavos: 101 },
    configuracao,
  }),
  original,
);

assert.equal(
  avaliarHistoricoPilotoSicoob({
    registroAtual: { estado: "registrada", codigo: "OK" },
  }).permitida,
  false,
);
assert.equal(
  avaliarHistoricoPilotoSicoob({
    registroLegado: { estado: "resultado_desconhecido" },
  }).motivo,
  "PILOTO_LEGADO_EXIGE_RECONCILIACAO",
);
assert.deepEqual(
  avaliarHistoricoPilotoSicoob({
    registroLegado: { estado: "rejeitada", codigo: "5002" },
  }),
  { permitida: true, migraRejeicaoLegada: true },
);

console.log("Idempotência do piloto Sicoob validada.");
