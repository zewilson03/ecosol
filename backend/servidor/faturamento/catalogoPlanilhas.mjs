import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

export function nomeUsinaDoArquivo(nome) {
  const match =
    /^\d+\s*-\s*Venda de Energia\s*-\s*Usina\s+(.+?)(?:\s+20\d{2})?(?:\.xlsx)+$/i.exec(
      nome,
    );
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}
function pasta() {
  return (
    process.env.ECOSOL_PLANILHAS_DIR ||
    path.join(os.homedir(), "Desktop", "00 - Planilhas Atualizadas")
  );
}
export async function listarPlanilhas() {
  const entradas = await readdir(pasta(), { withFileTypes: true });
  return entradas
    .filter((e) => e.isFile() && nomeUsinaDoArquivo(e.name))
    .map((e) => ({
      arquivo: e.name,
      usina: nomeUsinaDoArquivo(e.name),
    }))
    .sort((a, b) => a.usina.localeCompare(b.usina, "pt-BR", { numeric: true }));
}
export async function lerPlanilhaLocal(arquivo) {
  // Somente arquivos catalogados no nível principal; nunca aceita um caminho do cliente.
  const entrada = (await listarPlanilhas()).find((e) => e.arquivo === arquivo);
  if (!entrada) throw new Error("Planilha não encontrada na pasta de usinas.");
  const raiz = await realpath(pasta());
  const destino = await realpath(path.join(raiz, entrada.arquivo));
  if (path.dirname(destino).toLowerCase() !== raiz.toLowerCase())
    throw new Error("Arquivo fora da pasta de usinas.");
  if ((await stat(destino)).size > 5 * 1024 * 1024)
    throw new Error("A planilha excede 5 MB.");
  const buffer = await readFile(destino);
  if (buffer.length > 5 * 1024 * 1024)
    throw new Error("A planilha excede 5 MB.");
  return {
    ...entrada,
    buffer,
    hash: createHash("sha256").update(buffer).digest("hex"),
  };
}
