import assert from "node:assert/strict";
import express from "express";
import { criarRotasSaude } from "../servidor/saude.mjs";
import { protecaoHttp } from "../servidor/segurancaHttp.mjs";
import { obterConfiguracaoRede } from "../servidor/configuracaoRede.mjs";

assert.throws(
  () => obterConfiguracaoRede({ NODE_ENV: "production" }),
  /APP_URL é obrigatória em produção/,
);
assert.throws(
  () =>
    obterConfiguracaoRede({
      NODE_ENV: "production",
      APP_URL: "http://ecosol.example",
    }),
  /HTTPS em produção/,
);
assert.deepEqual(
  obterConfiguracaoRede({
    NODE_ENV: "production",
    APP_URL: "https://ecosol.example",
  }),
  {
    porta: 3000,
    host: "127.0.0.1",
    appUrl: "https://ecosol.example",
  },
);

function criarAplicacao(obterBanco, aceitaTrafego = () => true) {
  const aplicacao = express();
  aplicacao.use(protecaoHttp("https://ecosol.example"));
  aplicacao.use(criarRotasSaude({ banco: obterBanco, aceitaTrafego }));
  return aplicacao;
}

async function iniciar(aplicacao) {
  const servidor = aplicacao.listen(0, "127.0.0.1");
  await new Promise((resolver) => servidor.once("listening", resolver));
  return servidor;
}

async function encerrar(servidor) {
  servidor.closeAllConnections();
  await new Promise((resolver, rejeitar) =>
    servidor.close((erro) => (erro ? rejeitar(erro) : resolver())),
  );
}

const bancoDisponivel = {
  prepare(comando) {
    assert.equal(comando, "SELECT 1");
    return { get: () => ({ 1: 1 }) };
  },
};

for (const caso of [
  {
    nome: "disponível",
    banco: () => bancoDisponivel,
    status: 200,
    corpo: { status: "disponivel" },
  },
  {
    nome: "indisponível",
    banco: () => {
      throw new Error("C:/segredo/ecosol.db");
    },
    status: 503,
    corpo: { status: "indisponivel" },
  },
  {
    nome: "em encerramento",
    banco: () => {
      assert.fail("O banco não deve ser consultado durante o encerramento.");
    },
    aceitaTrafego: () => false,
    status: 503,
    corpo: { status: "indisponivel" },
  },
]) {
  const servidor = await iniciar(
    criarAplicacao(caso.banco, caso.aceitaTrafego),
  );
  try {
    const resposta = await fetch(
      `http://127.0.0.1:${servidor.address().port}/api/saude`,
    );
    assert.equal(resposta.status, caso.status, caso.nome);
    assert.equal(resposta.headers.get("cache-control"), "no-store");
    const texto = await resposta.text();
    assert.deepEqual(JSON.parse(texto), caso.corpo);
    assert.ok(!texto.includes("segredo"));
    assert.ok(!texto.includes("ecosol.db"));
  } finally {
    await encerrar(servidor);
  }
}

console.log(
  "OK: saúde pública mínima e configuração HTTPS obrigatória em produção.",
);
