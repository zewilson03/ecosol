import assert from "node:assert/strict";

process.env.NODE_ENV = "test";

const { iniciarExecutorBancarioSeConfigurado } =
  await import("../servidor/bancario/executor.mjs");

assert.equal(
  iniciarExecutorBancarioSeConfigurado({
    variaveis: { BANCARIO_EXECUTOR_MODO: "desligado" },
  }),
  null,
);

assert.throws(
  () =>
    iniciarExecutorBancarioSeConfigurado({
      variaveis: {
        BANCARIO_EXECUTOR_MODO: "sicoob",
        SICOOB_AMBIENTE: "homologacao",
      },
    }),
  /ambiente de produção explícito/,
);

assert.throws(
  () =>
    iniciarExecutorBancarioSeConfigurado({
      variaveis: {
        NODE_ENV: "production",
        BANCARIO_EXECUTOR_MODO: "sicoob",
        SICOOB_AMBIENTE: "producao",
        SICOOB_PRODUCAO_HABILITADA: "NAO",
      },
    }),
  /produção habilitada explicitamente/,
);

let integracoes = 0;
let iniciou = 0;
const adaptador = {
  async registrarCobranca() {},
  async consultarCobranca() {},
};
const agendador = iniciarExecutorBancarioSeConfigurado({
  variaveis: {
    NODE_ENV: "production",
    BANCARIO_EXECUTOR_MODO: "sicoob",
    SICOOB_AMBIENTE: "producao",
    SICOOB_PRODUCAO_HABILITADA: "SIM",
  },
  banco: {},
  criarIntegracao({ variaveis }) {
    integracoes += 1;
    assert.equal(variaveis.SICOOB_AMBIENTE, "producao");
    return { adaptador };
  },
  criarAgendador({ executor }) {
    assert.equal(typeof executor.processarUma, "function");
    return {
      iniciar() {
        iniciou += 1;
      },
      async parar() {},
    };
  },
});
assert.equal(integracoes, 1);
assert.equal(iniciou, 1);
assert.equal(typeof agendador.parar, "function");

console.log(
  "OK: executor real exige produção explícita e compõe o adaptador Sicoob sem despachar no teste.",
);
