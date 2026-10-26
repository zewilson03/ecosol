import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarAgendadorExecutorBancario } from "../servidor/bancario/executor.mjs";
import { fecharBanco, obterBanco } from "../servidor/bancoDeDados.mjs";
import { criarEncerramentoOrdenado } from "../servidor/encerramento.mjs";
import { criarAgendadorGmail } from "../servidor/gmail/agendador.mjs";

function adiada() {
  let resolver;
  const promessa = new Promise((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const drenagemHttp = adiada();
const tarefaAtiva = adiada();
const eventos = [];
const saidas = [];
const servidor = {
  close(callback) {
    eventos.push("http_parando");
    void drenagemHttp.promessa.then(() => callback());
  },
  closeIdleConnections() {
    eventos.push("http_ocioso_fechado");
  },
};
const encerrar = criarEncerramentoOrdenado({
  servidor,
  tarefas: [
    {
      async parar() {
        eventos.push("tarefa_parando");
        await tarefaAtiva.promessa;
        eventos.push("tarefa_concluida");
      },
    },
  ],
  marcarIndisponivel: () => eventos.push("indisponivel"),
  fecharPersistencia: () => eventos.push("banco_fechado"),
  sair: (codigo) => saidas.push(codigo),
  registrar: { info() {}, error() {} },
});
const primeira = encerrar("SIGTERM");
const repetida = encerrar("SIGINT");
assert.equal(primeira, repetida);
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(eventos.slice(0, 4), [
  "indisponivel",
  "http_parando",
  "http_ocioso_fechado",
  "tarefa_parando",
]);
assert.ok(!eventos.includes("banco_fechado"));
tarefaAtiva.resolver();
drenagemHttp.resolver();
await primeira;
assert.deepEqual(eventos.slice(-2), ["tarefa_concluida", "banco_fechado"]);
assert.deepEqual(saidas, [0]);

let conexoesForcadas = 0;
const saidasDoLimite = [];
await criarEncerramentoOrdenado({
  servidor: {
    close() {},
    closeIdleConnections() {},
    closeAllConnections() {
      conexoesForcadas += 1;
    },
  },
  tarefas: [{ parar: () => new Promise(() => {}) }],
  marcarIndisponivel() {},
  fecharPersistencia() {
    assert.fail("Persistência não deve fechar enquanto há trabalho ativo.");
  },
  limiteMs: 1,
  agendar(callback, tempo) {
    return { id: setTimeout(callback, tempo) };
  },
  cancelarAgendamento: (temporizador) => clearTimeout(temporizador.id),
  sair: (codigo) => saidasDoLimite.push(codigo),
  registrar: { info() {}, error() {} },
})("SIGTERM");
assert.equal(conexoesForcadas, 1);
assert.deepEqual(saidasDoLimite, [1]);

for (const tipo of ["gmail", "bancario"]) {
  const ativa = adiada();
  let execucoes = 0;
  let pulso;
  const opcoesComuns = {
    agendar(callback) {
      pulso = callback;
      return { unref() {} };
    },
    cancelar() {},
  };
  const agendador =
    tipo === "gmail"
      ? criarAgendadorGmail({
          ...opcoesComuns,
          listarContas: () => [
            { id: 1, status_autorizacao: "conectada", pausada: 0 },
          ],
          sincronizador: {
            emAndamento: () => false,
            sincronizar: async () => {
              execucoes += 1;
              await ativa.promessa;
            },
          },
        })
      : criarAgendadorExecutorBancario({
          ...opcoesComuns,
          executor: {
            async processarUma() {
              execucoes += 1;
              await ativa.promessa;
            },
          },
        });
  agendador.iniciar();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(execucoes, 1, tipo);
  const parada = agendador.parar();
  pulso();
  assert.equal(execucoes, 1, `${tipo}: não inicia novo ciclo`);
  ativa.resolver();
  await parada;
}

const pasta = mkdtempSync(join(tmpdir(), "ecosol-encerramento-"));
process.env.ECOSOL_DATA_DIR = pasta;
const banco = obterBanco();
banco.exec("CREATE TABLE teste_checkpoint(valor TEXT)");
banco.prepare("INSERT INTO teste_checkpoint(valor) VALUES(?)").run("ok");
fecharBanco();
assert.equal(
  obterBanco().prepare("SELECT valor FROM teste_checkpoint").get().valor,
  "ok",
);
fecharBanco();

console.log(
  "OK: encerramento drena HTTP e tarefas, respeita limite e fecha o SQLite após checkpoint.",
);
