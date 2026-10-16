import "./configuracao.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { build as compilarInterface } from "vite";
import { obterBanco } from "./bancoDeDados.mjs";
import { rotas } from "./rotasDaAplicacao.mjs";
import { rotasAdministrativas } from "./rotasAdministrativas.mjs";
import { rotasFaturamento } from "./faturamento/rotas.mjs";
import { rotasGmail, sincronizadorGmail } from "./gmail/rotas.mjs";
import { criarRepositorioGmail } from "./gmail/repositorio.mjs";
import { protecaoHttp, tratarErroHttp } from "./segurancaHttp.mjs";
import { iniciarExecutorBancarioSeConfigurado } from "./bancario/executor.mjs";

const pastaDoBackend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pastaDoProjeto = resolve(pastaDoBackend, "..");
const pastaDoFrontend = join(pastaDoProjeto, "frontend");
const pastaCompilada = join(pastaDoFrontend, "dist");

const aplicacao = express();
const porta = Number(process.env.PORT ?? 3000);

aplicacao.disable("x-powered-by");
aplicacao.use(protecaoHttp(process.env.APP_URL ?? `http://localhost:${porta}`));
aplicacao.use(express.urlencoded({ extended: false, limit: "20kb" }));
aplicacao.use(
  "/api/admin/faturamento/planilhas",
  express.json({ limit: "2mb" }),
);
aplicacao.use(express.json({ limit: "20kb" }));

aplicacao.use(rotas);
aplicacao.use(rotasAdministrativas);
aplicacao.use(rotasFaturamento);
aplicacao.use(rotasGmail);
obterBanco();
iniciarExecutorBancarioSeConfigurado();

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

aplicacao.use(tratarErroHttp);

aplicacao.listen(porta, "127.0.0.1", () => {
  console.log(`Ecosol disponível em http://localhost:${porta}`);
});

function consultarGmail() {
  for (const conta of criarRepositorioGmail(obterBanco()).listarContas()) {
    if (conta.status_autorizacao !== "conectada" || conta.pausada) continue;
    if (sincronizadorGmail.emAndamento(conta.id)) continue;
    void sincronizadorGmail.sincronizar(conta.id).catch(() => {
      // A falha categorizada fica no progresso; nunca registrar tokens ou e-mails.
    });
  }
}

consultarGmail();
setInterval(consultarGmail, 5 * 60_000).unref();
