import assert from "node:assert/strict";
import { criarContaCorrenteSicoob } from "../servidor/bancario/contaCorrenteSicoob.mjs";
import { consultarExtratoBancario } from "../servidor/financeiro/extratoBancario.mjs";
import { obterConfiguracaoSicoob } from "../servidor/bancario/configuracaoSicoob.mjs";

function respostaValida() {
  return {
    status: 200,
    conteudo: {
      saldoAtual: "1500.25",
      saldoBloqueado: "0",
      saldoLimite: "1000,00",
      saldoAnterior: "1400.00",
      saldoBloqueioJudicial: "0.00",
      transacoes: [
        {
          transactionId: "tx-001",
          tipo: "CREDITO",
          valor: "100.25",
          data: "26/10/2026",
          dataLote: "26/10/2026",
          descricao: "RECEBIMENTO",
          numeroDocumento: "DOC-1",
          cpfCnpj: "52998224725",
          descInfComplementar: "Boleto liquidado",
        },
      ],
    },
  };
}

const chamadas = [];
let respostas = [{ status: 401, conteudo: {} }, respostaValida()];
const oauth = {
  indice: 0,
  invalidados: [],
  async obter() {
    this.indice += 1;
    return { accessToken: `token-${this.indice}`, tokenType: "Bearer" };
  },
  invalidar(token) {
    this.invalidados.push(token);
  },
};
const conta = criarContaCorrenteSicoob({
  clienteHttp: {
    async solicitar(requisicao) {
      chamadas.push(requisicao);
      return respostas.shift();
    },
  },
  gerenciadorOAuth: oauth,
  clientId: "cliente-teste",
  numeroContaCorrente: 45678,
  intervaloMinimoMs: 0,
});

const extrato = await conta.consultarExtrato({
  mes: 10,
  ano: 2026,
  diaInicial: 1,
  diaFinal: 26,
});
assert.equal(chamadas.length, 2);
assert.equal(oauth.invalidados[0], "token-1");
assert.equal(chamadas[0].metodo, "GET");
assert.equal(chamadas[0].cabecalhos.client_id, "cliente-teste");
assert.match(
  chamadas[0].caminho,
  /^\/extrato\/10\/2026\?numeroContaCorrente=45678&agruparCNAB=false&diaInicial=1&diaFinal=26$/,
);
assert.equal(extrato.saldos.atual, "1500.25");
assert.equal(extrato.saldos.limite, "1000.00");
assert.equal(extrato.transacoes[0].documento_mascarado, "***.982.247-**");
assert.equal("cpfCnpj" in extrato.transacoes[0], false);

await assert.rejects(
  () => conta.consultarExtrato({ mes: 13, ano: 2026 }),
  (erro) => erro.codigo === "SICOOB_EXTRATO_MES_INVALIDO",
);

respostas = [{ status: 200, conteudo: { saldoAtual: "1", transacoes: [] } }];
await assert.rejects(
  () => conta.consultarExtrato({ mes: 10, ano: 2026 }),
  (erro) => erro.codigo === "SICOOB_EXTRATO_FORA_DO_CONTRATO",
);

await assert.rejects(
  () =>
    consultarExtratoBancario(
      { mes: "10", ano: "2026", dia_inicial: "1" },
      {
        carregarIntegracao: () => ({ contaCorrente: conta }),
      },
    ),
  (erro) => erro.codigo === "SICOOB_EXTRATO_INTERVALO_INCOMPLETO",
);

await assert.rejects(
  () =>
    consultarExtratoBancario(
      { mes: "10", ano: "2026" },
      { carregarIntegracao: () => ({ contaCorrente: null }) },
    ),
  (erro) => erro.codigo === "SICOOB_CONTA_CORRENTE_NAO_CONFIGURADA",
);

assert.throws(
  () =>
    obterConfiguracaoSicoob({
      variaveis: {
        NODE_ENV: "test",
        SICOOB_AMBIENTE: "homologacao",
        SICOOB_HOMOLOGACAO_OAUTH_SCOPE: "boletos_consulta",
        SICOOB_HOMOLOGACAO_CONTA_CORRENTE_API_BASE_URL:
          "http://127.0.0.1:4100/conta-corrente/v4",
        SICOOB_HOMOLOGACAO_CONTA_CORRENTE_NUMERO_CONTA: "45678",
      },
    }),
  (erro) =>
    erro.codigo === "SICOOB_CONFIGURACAO_INVALIDA" &&
    erro.message.includes("cco_consulta"),
);

console.log(
  "OK: extrato Sicoob usa GET autenticado, renova 401 uma vez, valida contrato e mascara documento.",
);
