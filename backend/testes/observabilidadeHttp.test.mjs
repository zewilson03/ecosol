import assert from "node:assert/strict";
import express from "express";
import { observabilidadeHttp } from "../servidor/observabilidadeHttp.mjs";

const eventos = [];
let relogio = 10;
const aplicacao = express();
aplicacao.use(
  observabilidadeHttp({
    agora: () => (relogio += 5),
    identificador: () => "00000000-0000-4000-8000-000000000001",
    registrar: (evento) => eventos.push(evento),
  }),
);
aplicacao.get("/api/clientes/:id", (_req, res) => res.json({ ok: true }));
const servidor = aplicacao.listen(0, "127.0.0.1");
await new Promise((resolver) => servidor.once("listening", resolver));
try {
  const resposta = await fetch(
    `http://127.0.0.1:${servidor.address().port}/api/clientes/123?cpf=nao-logar`,
  );
  assert.equal(resposta.status, 200);
  assert.equal(
    resposta.headers.get("x-request-id"),
    "00000000-0000-4000-8000-000000000001",
  );
  await new Promise((resolver) => setImmediate(resolver));
  assert.deepEqual(eventos, [
    {
      evento: "http_request",
      request_id: "00000000-0000-4000-8000-000000000001",
      metodo: "GET",
      rota: "/api/clientes/:id",
      status: 200,
      duracao_ms: 5,
    },
  ]);
  assert.ok(!JSON.stringify(eventos).includes("123"));
  assert.ok(!JSON.stringify(eventos).includes("cpf"));
} finally {
  await new Promise((resolver) => servidor.close(resolver));
}

console.log("OK: telemetria HTTP correlacionada sem URL nem dados pessoais.");
