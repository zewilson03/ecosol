import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { build as compilarInterface } from "vite";
import { obterBanco } from "./bancoDeDados.mjs";
import { rotas } from "./rotasDaAplicacao.mjs";
import { rotasAdministrativas } from "./rotasAdministrativas.mjs";
import { rotasFaturamento } from "./faturamento/rotas.mjs";

const pastaDoBackend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pastaDoProjeto = resolve(pastaDoBackend, "..");
const pastaDoFrontend = join(pastaDoProjeto, "frontend");
const pastaCompilada = join(pastaDoFrontend, "dist");

const arquivoDeConfiguracao = join(pastaDoBackend, ".env.local");
if (existsSync(arquivoDeConfiguracao))
  process.loadEnvFile(arquivoDeConfiguracao);

const aplicacao = express();
const porta = Number(process.env.PORT ?? 3000);

aplicacao.disable("x-powered-by");
aplicacao.use(express.urlencoded({ extended: false, limit: "20kb" }));
aplicacao.use(
  "/api/admin/faturamento/planilhas",
  express.json({ limit: "2mb" }),
);
aplicacao.use(express.json({ limit: "20kb" }));

// Formulários só podem ser enviados pela própria origem do site.
aplicacao.use((requisicao, resposta, proximo) => {
  if (
    ["POST", "PATCH", "PUT", "DELETE"].includes(requisicao.method) &&
    requisicao.headers.origin
  ) {
    const origemPermitida = process.env.APP_URL ?? `http://localhost:${porta}`;
    if (
      new URL(requisicao.headers.origin).origin !==
      new URL(origemPermitida).origin
    ) {
      return resposta.sendStatus(403);
    }
  }
  proximo();
});

aplicacao.use(rotas);
aplicacao.use(rotasAdministrativas);
aplicacao.use(rotasFaturamento);
obterBanco();

if (process.env.NODE_ENV !== "production") {
  // Recompila automaticamente a interface quando o código é salvo no VS Code.
  await compilarInterface({
    configFile: join(pastaDoFrontend, "vite.config.ts"),
    configLoader: "runner",
    define: { "import.meta.env.DEV": "true" },
    build: { watch: {} },
  });
}

aplicacao.use(express.static(pastaCompilada));
aplicacao.get("/{*caminho}", (_requisicao, resposta) => {
  resposta.sendFile(join(pastaCompilada, "index.html"));
});

aplicacao.use((erro, _requisicao, resposta, _proximo) => {
  console.error("Erro no servidor Ecosol:", erro);
  resposta.status(500).send("Não foi possível concluir a solicitação.");
});

aplicacao.listen(porta, "127.0.0.1", () => {
  console.log(`Ecosol disponível em http://localhost:${porta}`);
});
