import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import ExcelJS from "exceljs";
import { validarContatoCliente } from "../servidor/validacaoDeContato.mjs";

const args = process.argv.slice(2);
const option = (flag) => args[args.indexOf(flag) + 1];
const workbookPath = args.includes("--xlsx") ? resolve(option("--xlsx")) : null;
const dbPath = args.includes("--database")
  ? resolve(option("--database"))
  : null;
const apply = args.includes("--apply");
if (!workbookPath || !dbPath)
  throw new Error(
    "Uso: node importarClientesEgestor.mjs --xlsx ARQUIVO --database BANCO [--apply --expected-hash SHA256]",
  );
const hash = createHash("sha256")
  .update(readFileSync(workbookPath))
  .digest("hex");
if (apply && option("--expected-hash") !== hash)
  throw new Error(
    "O hash da planilha mudou; faça nova conferência antes de aplicar.",
  );

const digits = (v) => String(v ?? "").replace(/\D/g, "");
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const cell = (row, col) => {
  const v = row.getCell(col).value;
  if (v == null || typeof v === "object") return "";
  return String(v).trim();
};
const book = new ExcelJS.Workbook();
await book.xlsx.readFile(workbookPath);
const sheet = book.getWorksheet("personalizadoContatos");
if (
  !sheet ||
  norm(cell(sheet.getRow(1), 4)) !== "cpfcnpj" ||
  norm(cell(sheet.getRow(1), 17)) !== "uc"
)
  throw new Error(
    "Cabeçalho da planilha não corresponde ao formato conferido.",
  );
const rows = [];
sheet.eachRow((row, n) => {
  if (n === 1) return;
  const name = cell(row, 1);
  if (!name) return;
  const ucs = [
    ...new Set(
      Array.from({ length: 10 }, (_, j) => digits(cell(row, j + 17))).filter(
        Boolean,
      ),
    ),
  ];
  rows.push({
    n,
    name,
    doc: digits(cell(row, 4)),
    fantasy: cell(row, 3),
    email: cell(row, 6),
    phone: cell(row, 15),
    address: {
      logradouro: cell(row, 7),
      numero: cell(row, 8),
      complemento: cell(row, 9),
      bairro: cell(row, 10),
      cidade: cell(row, 11),
      uf: cell(row, 12),
      cep: digits(cell(row, 13)),
      pais: cell(row, 14),
    },
    ucs,
  });
});

const db = new DatabaseSync(dbPath, { readOnly: !apply });
db.exec("PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON");
if (
  apply &&
  db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='egestor_importacoes'",
    )
    .get() &&
  db.prepare("SELECT 1 FROM egestor_importacoes WHERE hash=?").get(hash)
) {
  db.close();
  throw new Error(
    "Esta versão da planilha já foi importada; nenhuma alteração repetida.",
  );
}
let backupPath = null;
if (apply) {
  const backupDir = join(dirname(dbPath), "backups");
  mkdirSync(backupDir, { recursive: true });
  backupPath = join(
    backupDir,
    `${basename(dbPath)}.antes-egestor-${Date.now()}.bak`,
  );
  await backup(db, backupPath);
  db.exec("BEGIN IMMEDIATE");
}
const existing = new Map(
  db
    .prepare("SELECT id,name,cpf,email,phone FROM customers")
    .all()
    .map((x) => [digits(x.cpf), x]),
);
const units = new Map(
  db
    .prepare("SELECT id,uc,documento,cliente_id,nome FROM faturamento_unidades")
    .all()
    .map((x) => [digits(x.uc), x]),
);
const aliases = new Map(
  db
    .prepare("SELECT uc,unidade_id FROM faturamento_unidades_aliases")
    .all()
    .map((x) => [digits(x.uc), x.unidade_id]),
);
const unitById = new Map([...units.values()].map((x) => [x.id, x]));
const unitMatchesDocument = (unit, doc) =>
  unit &&
  digits(unit.documento) === doc &&
  (!unit.cliente_id || existing.get(doc)?.id === unit.cliente_id);
const groups = new Map();
const ucDocs = new Map();
for (const r of rows) {
  if (/^(\d{11}|\d{14})$/.test(r.doc)) {
    if (!groups.has(r.doc)) groups.set(r.doc, []);
    groups.get(r.doc).push(r);
  }
  for (const uc of r.ucs) {
    if (!ucDocs.has(uc)) ucDocs.set(uc, new Set());
    ucDocs.get(uc).add(r.doc || `linha:${r.n}`);
  }
}
const plan = new Map();
const counts = {
  linhas: rows.length,
  documentos: groups.size,
  clientes_existentes: 0,
  clientes_novos_seguros: 0,
  clientes_pendentes: 0,
  ucs_atuais: 0,
  ucs_historicas: 0,
  ucs_pendentes: 0,
  conflitos_uc: 0,
};
for (const [doc, group] of groups) {
  const current = existing.get(doc);
  if (current) {
    plan.set(doc, { action: "existing", current });
    counts.clientes_existentes++;
    continue;
  }
  const names = new Set(group.map((x) => norm(x.name)));
  const contacts = group
    .map((x) => validarContatoCliente(x.email, x.phone))
    .filter(Boolean);
  const emails = new Set(contacts.map((x) => x.email).filter(Boolean));
  const phones = new Set(contacts.map((x) => x.phone).filter(Boolean));
  const conflict = group.some((x) =>
    x.ucs.some((uc) => {
      const unit = units.get(uc) ?? unitById.get(aliases.get(uc));
      return (
        ucDocs.get(uc).size > 1 ||
        (unit && digits(unit.documento) && digits(unit.documento) !== doc) ||
        (unit?.cliente_id && existing.get(doc)?.id !== unit.cliente_id)
      );
    }),
  );
  if (
    names.size === 1 &&
    contacts.length &&
    emails.size <= 1 &&
    phones.size <= 1 &&
    !conflict &&
    !db.prepare("SELECT 1 FROM staff_users WHERE cpf=?").get(doc)
  ) {
    plan.set(doc, {
      action: "create",
      name: group[0].name,
      email: [...emails][0] ?? "",
      phone: [...phones][0] ?? "",
    });
    counts.clientes_novos_seguros++;
  } else {
    plan.set(doc, { action: "pending" });
    counts.clientes_pendentes++;
  }
}
for (const r of rows)
  for (const uc of r.ucs) {
    const unit = units.get(uc) ?? unitById.get(aliases.get(uc));
    if (ucDocs.get(uc).size > 1) counts.conflitos_uc++;
    if (unitMatchesDocument(unit, r.doc) && ucDocs.get(uc).size === 1)
      counts[units.has(uc) ? "ucs_atuais" : "ucs_historicas"]++;
    else counts.ucs_pendentes++;
  }
console.log(JSON.stringify({ arquivo_sha256: hash, ...counts }, null, 2));
if (!apply) {
  db.close();
  process.exit(0);
}

try {
  db.exec(`CREATE TABLE IF NOT EXISTS egestor_importacoes (
  hash TEXT PRIMARY KEY, origem TEXT NOT NULL, linhas INTEGER NOT NULL,
  resumo TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS egestor_linhas (
  import_hash TEXT NOT NULL REFERENCES egestor_importacoes(hash), linha INTEGER NOT NULL,
  cliente_id INTEGER REFERENCES customers(id), nome TEXT NOT NULL, documento TEXT NOT NULL,
  nome_fantasia TEXT NOT NULL, email TEXT NOT NULL, telefone TEXT NOT NULL,
  endereco_json TEXT NOT NULL, ucs_json TEXT NOT NULL, situacao TEXT NOT NULL,
  PRIMARY KEY(import_hash,linha)
);
CREATE TABLE IF NOT EXISTS egestor_uc_referencias (
  import_hash TEXT NOT NULL, linha INTEGER NOT NULL, uc TEXT NOT NULL,
  unidade_id INTEGER REFERENCES faturamento_unidades(id), classificacao TEXT NOT NULL,
  PRIMARY KEY(import_hash,linha,uc),
  FOREIGN KEY(import_hash,linha) REFERENCES egestor_linhas(import_hash,linha)
);
CREATE INDEX IF NOT EXISTS egestor_uc_referencias_uc ON egestor_uc_referencias(uc);`);
  if (db.prepare("SELECT 1 FROM egestor_importacoes WHERE hash=?").get(hash)) {
    throw new Error(
      "Esta versão da planilha já foi importada; nenhuma alteração repetida.",
    );
  }
  db.prepare(
    "INSERT INTO egestor_importacoes(hash,origem,linhas,resumo) VALUES(?,?,?,?)",
  ).run(
    hash,
    "Clientes Grupo Ecosol - Egestor.xlsx",
    rows.length,
    JSON.stringify(counts),
  );
  const insertCustomer = db.prepare(
    "INSERT INTO customers(name,cpf,email,phone) VALUES(?,?,?,?)",
  );
  const updateContact = db.prepare(
    "UPDATE customers SET email=CASE WHEN email='' THEN ? ELSE email END,phone=CASE WHEN phone='' THEN ? ELSE phone END WHERE id=?",
  );
  for (const [doc, p] of plan) {
    if (p.action === "create") {
      p.id = Number(
        insertCustomer.run(p.name, doc, p.email, p.phone).lastInsertRowid,
      );
    } else if (p.action === "existing") {
      p.id = p.current.id;
      const g = groups.get(doc);
      const normalizedEmails = new Set(
        g.map((x) => validarContatoCliente(x.email, "")?.email).filter(Boolean),
      );
      const normalizedPhones = new Set(
        g.map((x) => validarContatoCliente("", x.phone)?.phone).filter(Boolean),
      );
      const safeEmail =
        normalizedEmails.size === 1 && !p.current.email
          ? [...normalizedEmails][0]
          : "";
      const safePhone =
        normalizedPhones.size === 1 && !p.current.phone
          ? [...normalizedPhones][0]
          : "";
      if (safeEmail || safePhone) updateContact.run(safeEmail, safePhone, p.id);
    }
  }
  const insertRow = db.prepare(
    "INSERT INTO egestor_linhas(import_hash,linha,cliente_id,nome,documento,nome_fantasia,email,telefone,endereco_json,ucs_json,situacao) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  );
  const insertUc = db.prepare(
    "INSERT INTO egestor_uc_referencias(import_hash,linha,uc,unidade_id,classificacao) VALUES(?,?,?,?,?)",
  );
  const link = db.prepare(
    "UPDATE faturamento_unidades SET cliente_id=?,versao=versao+1 WHERE id=? AND cliente_id IS NULL AND documento=?",
  );
  let linked = 0;
  for (const r of rows) {
    const customer = plan.get(r.doc);
    const customerId = customer?.id ?? null;
    insertRow.run(
      hash,
      r.n,
      customerId,
      r.name,
      r.doc,
      r.fantasy,
      r.email,
      r.phone,
      JSON.stringify(r.address),
      JSON.stringify(r.ucs),
      customerId ? "identificado" : "revisao",
    );
    for (const uc of r.ucs) {
      const unit = units.get(uc) ?? unitById.get(aliases.get(uc));
      const safe =
        unitMatchesDocument(unit, r.doc) && ucDocs.get(uc).size === 1;
      const type = safe ? (units.has(uc) ? "atual" : "historica") : "pendente";
      insertUc.run(hash, r.n, uc, safe ? unit.id : null, type);
      if (safe && customerId && !unit.cliente_id) {
        linked += link.run(customerId, unit.id, unit.documento).changes;
        unit.cliente_id = customerId;
      }
    }
  }
  db.exec("COMMIT");
  console.log(
    JSON.stringify({
      aplicado: true,
      backup: backupPath,
      clientes_criados: counts.clientes_novos_seguros,
      unidades_vinculadas: linked,
    }),
  );
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
} finally {
  db.close();
}
