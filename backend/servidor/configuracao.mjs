import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Este módulo deve preceder os módulos que consultam o ambiente ao importar.
const arquivo = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(arquivo)) process.loadEnvFile(arquivo);
