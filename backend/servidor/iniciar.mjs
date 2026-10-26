import "./configuracao.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { build as compilarInterface } from "vite";
import { fecharBanco, obterBanco } from "./bancoDeDados.mjs";
import { rotas } from "./rotasDaAplicacao.mjs";
import { rotasAdministrativas } from "./rotasAdministrativas.mjs";
import { rotasFaturamento } from "./faturamento/rotas.mjs";
import { rotasGmail, sincronizadorGmail } from "./gmail/rotas.mjs";
import { criarRepositorioGmail } from "./gmail/repositorio.mjs";
import { protecaoHttp, tratarErroHttp } from "./segurancaHttp.mjs";
import { iniciarExecutorBancarioSeConfigurado } from "./bancario/executor.mjs";
import { obterConfiguracaoRede } from "./configuracaoRede.mjs";
import { rotasSaude } from "./saude.mjs";
import { criarAgendadorGmail } from "./gmail/agendador.mjs";
import { criarEncerramentoOrdenado } from "./encerramento.mjs";
import { marcarAplicacaoEmEncerramento } from "./estadoOperacional.mjs";

const pastaDoBackend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pastaDoProjeto = resolve(pastaDoBackend, "..");
const pastaDoFrontend = join(pastaDoProjeto, "frontend");
const pastaCompilada = join(pastaDoFrontend, "dist");

const aplicacao = express();
const { porta, host, appUrl } = obterConfiguracaoRede();

aplicacao.disable("x-powered-by");
aplicacao.use(protecaoHttp(appUrl));
aplicacao.use(express.urlencoded({ extended: false, limit: "20kb" }));
aplicacao.use(
  "/api/admin/faturamento/planilhas",
  express.json({ limit: "2mb" }),
);
aplicacao.use(express.json({ limit: "20kb" }));

aplicacao.use(rotasSaude);
aplicacao.use(rotas);
aplicacao.use(rotasAdministrativas);
aplicacao.use(rotasFaturamento);
aplicacao.use(rotasGmail);
obterBanco();
const executorBancario = iniciarExecutorBancarioSeConfigurado();

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

const servidor = aplicacao.listen(porta, host, () => {
  console.log(`Ecosol disponível em ${appUrl}`);
});

const agendadorGmail = criarAgendadorGmail({
  listarContas: () => criarRepositorioGmail(obterBanco()).listarContas(),
  sincronizador: sincronizadorGmail,
});
agendadorGmail.iniciar();

const encerrar = criarEncerramentoOrdenado({
  servidor,
  tarefas: [agendadorGmail, executorBancario],
  fecharPersistencia: fecharBanco,
  marcarIndisponivel: marcarAplicacaoEmEncerramento,
});
process.once("SIGTERM", () => void encerrar("SIGTERM"));
process.once("SIGINT", () => void encerrar("SIGINT"));
