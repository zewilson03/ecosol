import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Este módulo deve preceder os módulos que consultam o ambiente ao importar.
const arquivo = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(arquivo)) process.loadEnvFile(arquivo);
// O build em modo watch do Vite define NODE_ENV=production quando ele está
// ausente. Fixar o modo do servidor antes do build evita mudar regras de
// segurança durante a execução local.
if (!process.env.NODE_ENV) process.env.NODE_ENV = "development";
