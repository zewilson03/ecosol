import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import ExcelJS from "exceljs";
import { validarContatoCliente } from "../servidor/validacaoDeContato.mjs";

const args = process.argv.slice(2);
const arg = (key) => (args.includes(key) ? args[args.indexOf(key) + 1] : null);
const xlsx = arg("--xlsx") && resolve(arg("--xlsx"));
const database = arg("--database") && resolve(arg("--database"));
const apply = args.includes("--apply");
if (!xlsx || !database) throw new Error("Informe --xlsx e --database.");
const hash = createHash("sha256").update(readFileSync(xlsx)).digest("hex");
if (apply && arg("--expected-hash") !== hash)
  throw new Error("Hash da planilha divergente.");
const digits = (v) => String(v ?? "").replace(/\D/g, "");
const name = (v) =>
  String(v ?? "")
    .replace(/\s*[-–]?\s*CPF\s*[\d.\-/]+\s*$/i, "")
    .trim();
const norm = (v) =>
  name(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const email = (v) => validarContatoCliente(String(v ?? ""), "")?.email ?? "";
const phone = (v) => validarContatoCliente("", String(v ?? ""))?.phone ?? "";
const cell = (row, index) => {
  const value = row.getCell(index).value;
  return value == null || typeof value === "object" ? "" : String(value).trim();
};
const book = new ExcelJS.Workbook();
await book.xlsx.readFile(xlsx);
const sheet = book.getWorksheet("Abadiania");
if (
  !sheet ||
  norm(cell(sheet.getRow(1), 6)) !== "ucantiga" ||
  norm(cell(sheet.getRow(1), 7)) !== "ucnova"
)
  throw new Error("Cabeçalho da planilha não corresponde ao modelo conferido.");
const rows = [];
sheet.eachRow((row, line) => {
  if (line === 1) return;
  const current = digits(cell(row, 7));
  if (!current) return;
  rows.push({
    line,
    status: cell(row, 1),
    name: name(cell(row, 2)),
    sourceDoc: digits(cell(row, 3)),
    sourcePhone: cell(row, 4),
    sourceEmail: cell(row, 5),
    old: digits(cell(row, 6)),
    current,
    plant: cell(row, 8),
    exit: cell(row, 10),
  });
});
const db = new DatabaseSync(database, { readOnly: !apply });
db.exec("PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON");
const imported =
  db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='abadiania_importacoes'",
    )
    .get() &&
  db.prepare("SELECT 1 FROM abadiania_importacoes WHERE hash=?").get(hash);
if (apply && imported)
  throw new Error(
    "Esta planilha já foi aplicada; nenhuma duplicação permitida.",
  );
let backupPath = null;
if (apply) {
  const backupDir = join(dirname(database), "backups");
  mkdirSync(backupDir, { recursive: true });
  backupPath = join(
    backupDir,
    `${basename(database)}.antes-abadiania-${Date.now()}.bak`,
  );
  await backup(db, backupPath);
  db.exec("BEGIN IMMEDIATE");
}

try {
  const customers = new Map(
    db
      .prepare("SELECT id,name,cpf,email,phone FROM customers")
      .all()
      .map((x) => [digits(x.cpf), x]),
  );
  const units = new Map(
    db
      .prepare(
        "SELECT id,uc,nome,documento,email,dia_vencimento,cliente_id,usina_id FROM faturamento_unidades",
      )
      .all()
      .map((x) => [digits(x.uc), x]),
  );
  const unitsById = new Map([...units.values()].map((x) => [x.id, x]));
  const aliases = new Map(
    db
      .prepare("SELECT uc,unidade_id FROM faturamento_unidades_aliases")
      .all()
      .map((x) => [digits(x.uc), x.unidade_id]),
  );
  const egestor = new Map();
  if (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='egestor_uc_referencias'",
      )
      .get()
  ) {
    for (const x of db
      .prepare(
        `SELECT r.uc,l.documento,l.nome,l.email,l.telefone
      FROM egestor_uc_referencias r JOIN egestor_linhas l
      ON l.import_hash=r.import_hash AND l.linha=r.linha`,
      )
      .all()) {
      const uc = digits(x.uc);
      if (!egestor.has(uc)) egestor.set(uc, []);
      egestor.get(uc).push(x);
    }
  }
  const currentOwners = new Map();
  for (const row of rows) {
    if (!currentOwners.has(row.current))
      currentOwners.set(row.current, new Set());
    currentOwners.get(row.current).add(row.sourceDoc || norm(row.name));
  }
  for (const row of rows) {
    const unit = units.get(row.current);
    const oldUnit = unitsById.get(aliases.get(row.old)) ?? units.get(row.old);
    const evidence = new Set();
    if ([11, 14].includes(digits(unit?.documento).length))
      evidence.add(digits(unit.documento));
    if ([11, 14].includes(digits(oldUnit?.documento).length))
      evidence.add(digits(oldUnit.documento));
    for (const uc of [row.current, row.old])
      for (const item of egestor.get(uc) ?? [])
        if (
          [11, 14].includes(digits(item.documento).length) &&
          norm(item.nome) === norm(row.name)
        )
          evidence.add(digits(item.documento));
    row.unit = unit;
    row.oldUnit = oldUnit;
    row.doc = row.sourceDoc || (evidence.size === 1 ? [...evidence][0] : "");
    row.reason = "";
    if (row.status !== "ATIVA PROVISORIA" || norm(row.exit) !== "nao")
      row.reason = "Status ou rescisão exige revisão";
    else if (row.sourceDoc && ![11, 14].includes(row.sourceDoc.length))
      row.reason = "Documento da planilha inválido";
    else if (
      evidence.size > 1 ||
      (row.sourceDoc && evidence.size && !evidence.has(row.sourceDoc))
    )
      row.reason = "Documentos divergentes entre fontes";
    else if (!row.doc) row.reason = "Documento não identificado com segurança";
    else if (currentOwners.get(row.current).size > 1)
      row.reason = "UC nova aparece com titulares diferentes";
    else if (unit?.documento && digits(unit.documento) !== row.doc)
      row.reason = "Documento da UC atual divergente";
    else if (unit?.cliente_id && customers.get(row.doc)?.id !== unit.cliente_id)
      row.reason = "UC vinculada a outro cliente";
    else if (
      row.old &&
      units.has(row.old) &&
      units.get(row.old).id !== unit?.id
    )
      row.reason = "UC antiga cadastrada como outra UC atual";
    else if (
      row.old &&
      aliases.has(row.old) &&
      aliases.get(row.old) !== unit?.id
    )
      row.reason = "UC antiga já vinculada a outra UC atual";
    else if (unit && !unit.documento && norm(unit.nome) !== norm(row.name))
      row.reason = "Nome da UC sem documento diverge";
  }
  const groups = new Map();
  for (const row of rows)
    if (!row.reason) {
      if (!groups.has(row.doc)) groups.set(row.doc, []);
      groups.get(row.doc).push(row);
    }
  const newCustomers = new Map();
  for (const [doc, group] of groups) {
    if (customers.has(doc)) continue;
    const names = new Set(group.map((x) => norm(x.name)));
    const emails = new Set(),
      phones = new Set();
    for (const row of group) {
      if (email(row.sourceEmail)) emails.add(email(row.sourceEmail));
      if (phone(row.sourcePhone)) phones.add(phone(row.sourcePhone));
      if (email(row.unit?.email)) emails.add(email(row.unit.email));
      for (const uc of [row.current, row.old])
        for (const x of egestor.get(uc) ?? [])
          if (digits(x.documento) === doc) {
            if (email(x.email)) emails.add(email(x.email));
            if (phone(x.telefone)) phones.add(phone(x.telefone));
          }
    }
    const e = emails.size === 1 ? [...emails][0] : "";
    const p = phones.size === 1 ? [...phones][0] : "";
    if (
      names.size !== 1 ||
      (!e && !p) ||
      db.prepare("SELECT 1 FROM staff_users WHERE cpf=?").get(doc)
    ) {
      for (const row of group)
        row.reason = "Novo cliente sem nome ou contato único confirmado";
    } else newCustomers.set(doc, { name: group[0].name, email: e, phone: p });
  }
  const summary = {
    linhas: rows.length,
    ja_cadastrados: 0,
    criar_clientes: newCustomers.size,
    vincular_ucs: 0,
    criar_ucs_atuais: 0,
    adicionar_ucs_antigas: 0,
    revisao: 0,
  };
  for (const row of rows) {
    if (row.reason) {
      summary.revisao++;
      continue;
    }
    const customer = customers.get(row.doc);
    if (customer) summary.ja_cadastrados++;
    if (row.unit && !row.unit.cliente_id) summary.vincular_ucs++;
    if (!row.unit) summary.criar_ucs_atuais++;
    if (row.old && !units.has(row.old) && !aliases.has(row.old))
      summary.adicionar_ucs_antigas++;
  }
  console.log(JSON.stringify({ arquivo_sha256: hash, ...summary }, null, 2));
  if (!apply) {
    db.close();
    process.exit(0);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS abadiania_importacoes (
    hash TEXT PRIMARY KEY, arquivo TEXT NOT NULL, resumo TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS abadiania_linhas (
    import_hash TEXT NOT NULL REFERENCES abadiania_importacoes(hash), linha INTEGER NOT NULL,
    nome TEXT NOT NULL, documento_fonte TEXT NOT NULL, documento_resolvido TEXT NOT NULL,
    telefone TEXT NOT NULL, email TEXT NOT NULL, uc_antiga TEXT NOT NULL, uc_atual TEXT NOT NULL,
    status_fonte TEXT NOT NULL, rescisao TEXT NOT NULL, cliente_id INTEGER REFERENCES customers(id),
    unidade_id INTEGER REFERENCES faturamento_unidades(id), resultado TEXT NOT NULL,
    PRIMARY KEY(import_hash,linha)
  );`);
  if (db.prepare("SELECT 1 FROM abadiania_importacoes WHERE hash=?").get(hash))
    throw new Error("Importação já registrada.");
  db.prepare(
    "INSERT INTO abadiania_importacoes(hash,arquivo,resumo) VALUES(?,?,?)",
  ).run(hash, "Unidades Abadiania.xlsx", JSON.stringify(summary));
  const insertCustomer = db.prepare(
    "INSERT INTO customers(name,cpf,email,phone) VALUES(?,?,?,?)",
  );
  for (const [doc, data] of newCustomers) {
    const id = Number(
      insertCustomer.run(data.name, doc, data.email, data.phone)
        .lastInsertRowid,
    );
    customers.set(doc, { id, cpf: doc, ...data });
  }
  const insertUnit = db.prepare(
    "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento,cliente_id) VALUES(?,?,?,?,0,?)",
  );
  const linkUnit = db.prepare(
    "UPDATE faturamento_unidades SET cliente_id=?,documento=CASE WHEN documento='' THEN ? ELSE documento END,versao=versao+1 WHERE id=? AND cliente_id IS NULL AND documento=?",
  );
  const insertAlias = db.prepare(
    "INSERT INTO faturamento_unidades_aliases(unidade_id,uc,origem) VALUES(?,?,?)",
  );
  const insertLine = db.prepare(
    "INSERT INTO abadiania_linhas(import_hash,linha,nome,documento_fonte,documento_resolvido,telefone,email,uc_antiga,uc_atual,status_fonte,rescisao,cliente_id,unidade_id,resultado) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const applied = {
    clientes: newCustomers.size,
    ucs_vinculadas: 0,
    ucs_criadas: 0,
    aliases_criados: 0,
  };
  for (const row of rows) {
    let unitId = row.unit?.id ?? null;
    const customerId = row.reason ? null : customers.get(row.doc)?.id;
    if (customerId && !row.unit) {
      unitId = Number(
        insertUnit.run(
          row.current,
          customers.get(row.doc).name,
          row.doc,
          customers.get(row.doc).email,
          customerId,
        ).lastInsertRowid,
      );
      applied.ucs_criadas++;
    } else if (customerId && row.unit && !row.unit.cliente_id) {
      const changed = linkUnit.run(
        customerId,
        row.doc,
        unitId,
        row.unit.documento,
      ).changes;
      if (changed !== 1)
        throw new Error(`UC mudou durante a importação na linha ${row.line}`);
      applied.ucs_vinculadas++;
    }
    if (
      customerId &&
      unitId &&
      row.old &&
      !units.has(row.old) &&
      !aliases.has(row.old)
    ) {
      insertAlias.run(
        unitId,
        row.old,
        "Planilha Unidades Abadiania: UC antiga",
      );
      aliases.set(row.old, unitId);
      applied.aliases_criados++;
    }
    insertLine.run(
      hash,
      row.line,
      row.name,
      row.sourceDoc,
      row.doc,
      row.sourcePhone,
      row.sourceEmail,
      row.old,
      row.current,
      row.status,
      row.exit,
      customerId ?? null,
      customerId ? unitId : null,
      row.reason || "cadastro_conferido",
    );
  }
  db.exec("COMMIT");
  console.log(
    JSON.stringify({ aplicado: true, backup: backupPath, ...applied }),
  );
} catch (error) {
  if (apply) db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
