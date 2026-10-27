import assert from "node:assert/strict";
import express from "express";
import { configurarProxyConfiavel } from "../servidor/proxyConfiavel.mjs";

const aplicacao = express();
configurarProxyConfiavel(aplicacao);
aplicacao.get("/ip", (req, res) => res.json({ ip: req.ip }));
const servidor = aplicacao.listen(0, "127.0.0.1");
await new Promise((resolver) => servidor.once("listening", resolver));
try {
  const resposta = await fetch(
    `http://127.0.0.1:${servidor.address().port}/ip`,
    { headers: { "X-Forwarded-For": "198.51.100.27" } },
  );
  assert.deepEqual(await resposta.json(), { ip: "198.51.100.27" });
} finally {
  await new Promise((resolver) => servidor.close(resolver));
}

console.log("OK: proxy loopback preserva o IP original usado no rate limit.");
