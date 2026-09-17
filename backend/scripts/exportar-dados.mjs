import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dataDir = process.env.ECOSOL_DATA_DIR
  ? path.resolve(process.env.ECOSOL_DATA_DIR)
  : path.join(projectRoot, "data");
const databasePath = path.join(dataDir, "ecosol.db");
const outputDir = path.join(dataDir, "consultas");

if (!existsSync(databasePath)) {
  console.error(
    "Banco ainda não criado. Inicie o site e acesse a área da equipe antes de exportar.",
  );
  process.exitCode = 1;
} else {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok")
      throw new Error(
        "Falha na integridade do banco: " + integrity.integrity_check,
      );

    // Apenas hashes com sal são exportados; nunca senhas em texto, tokens ou sessões.
    const clientes = database
      .prepare(
        "SELECT id, name AS nome, cpf, email, password_hash AS senha_hash, created_at AS criado_em FROM customers ORDER BY id",
      )
      .all();
    const contatos = database
      .prepare(
        "SELECT id, name AS nome, email, phone AS telefone, city AS cidade, message AS mensagem, status, created_at AS criado_em FROM leads ORDER BY id DESC",
      )
      .all();
    const hasAdmins = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'staff_users'",
      )
      .get();
    const adminColumns = hasAdmins
      ? database.prepare("PRAGMA table_info(staff_users)").all()
      : [];
    const hasCpf = adminColumns.some((column) => column.name === "cpf");
    const temNivel = adminColumns.some(
      (coluna) => coluna.name === "access_level",
    );
    const administradores = hasAdmins
      ? database
          .prepare(
            "SELECT id, name AS nome, " +
              (hasCpf ? "cpf, " : "") +
              (temNivel ? "access_level AS nivel, " : "") +
              "email, password_hash AS senha_hash, created_at AS criado_em FROM staff_users ORDER BY id DESC",
          )
          .all()
      : [];

    mkdirSync(outputDir, { recursive: true });
    for (const [name, rows] of [
      ["clientes", clientes],
      ["contatos", contatos],
      ["administradores", administradores],
    ]) {
      const target = path.join(outputDir, name + ".json");
      writeFileSync(target, JSON.stringify(rows, null, 2) + "\n", "utf8");
      console.log(name + ": " + rows.length + " registro(s) -> " + target);
    }
    console.log("Integridade do banco: ok. Abra os arquivos JSON no VS Code.");
  } finally {
    database.close();
  }
}
