import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { prepararFaturamento } from "./faturamento/esquema.mjs";

let banco;

export function obterBanco() {
  if (banco) return banco;

  const pastaDoBackend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const pasta = process.env.ECOSOL_DATA_DIR || join(pastaDoBackend, "data");
  mkdirSync(pasta, { recursive: true });
  banco = new DatabaseSync(join(pasta, "ecosol.db"));

  // A criação é segura para um banco já existente: as tabelas são preservadas.
  banco.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      cpf TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      city TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Novo',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS staff_users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      cpf TEXT UNIQUE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER,
      staff_id INTEGER,
      token_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      purpose TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS dev_mail (
      id INTEGER PRIMARY KEY,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    );
  `);

  const colunasDaEquipe = banco.prepare("PRAGMA table_info(staff_users)").all();
  if (!colunasDaEquipe.some((coluna) => coluna.name === "access_level")) {
    banco.exec(
      "ALTER TABLE staff_users ADD COLUMN access_level INTEGER NOT NULL DEFAULT 1 CHECK(access_level BETWEEN 1 AND 3)",
    );
  }
  banco.exec(`
    CREATE TABLE IF NOT EXISTS contas_a_pagar (
      id INTEGER PRIMARY KEY,
      descricao TEXT NOT NULL,
      favorecido TEXT NOT NULL,
      valor_centavos INTEGER NOT NULL CHECK(valor_centavos >= 0),
      vencimento TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Pendente', 'Pago')),
      versao INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS historico_financeiro (
      id INTEGER PRIMARY KEY,
      conta_id INTEGER NOT NULL,
      administrador_id INTEGER,
      responsavel TEXT NOT NULL,
      acao TEXT NOT NULL,
      valor_anterior INTEGER,
      valor_novo INTEGER NOT NULL,
      dados_anteriores TEXT,
      dados_novos TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS usinas (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL,
      localizacao TEXT NOT NULL,
      potencia_kw REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Em implantação'
    );
    CREATE TABLE IF NOT EXISTS faturas (
      id INTEGER PRIMARY KEY,
      cliente_id INTEGER NOT NULL,
      referencia TEXT NOT NULL,
      vencimento TEXT NOT NULL,
      valor_centavos INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pendente'
    );
  `);
  if (!colunasDaEquipe.some((coluna) => coluna.name === "cpf")) {
    banco.exec("ALTER TABLE staff_users ADD COLUMN cpf TEXT");
  }

  const colunasDasFaturas = banco.prepare("PRAGMA table_info(faturas)").all();
  if (!colunasDasFaturas.some((coluna) => coluna.name === "cliente_nome")) {
    banco.exec("ALTER TABLE faturas ADD COLUMN cliente_nome TEXT");
  }

  banco.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS staff_users_cpf_unique
    ON staff_users(cpf) WHERE cpf IS NOT NULL
  `);

  prepararFaturamento(banco);
  return banco;
}
