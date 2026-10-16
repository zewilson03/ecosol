import { existsSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { obterBanco } from "../servidor/bancoDeDados.mjs";
import { prepararFaturamento } from "../servidor/faturamento/esquema.mjs";
import { lerPdf } from "../servidor/faturamento/extracao.mjs";
import {
  identificarUsinaPorGeracao,
  normalizarIdentificadorGeracao,
} from "../servidor/faturamento/identificadoresUsinas.mjs";

const arquivo = resolve(process.argv[2] ?? "");
const confirmar = process.argv.includes("--confirmar");
if (!arquivo || !existsSync(arquivo))
  throw new Error("Informe o caminho de uma planilha existente.");

const aliases = [
  { teste: (v) => v.startsWith("ABD"), destino: "Abadiânia" },
  { teste: (v) => v.includes("2000 SOLAR"), destino: "2000 Solar" },
  { teste: (v) => v.includes("FRANCISCO"), destino: "São Francisco" },
  { teste: (v) => v.includes("CARLOS UNIAO"), destino: "Carlos União" },
  { teste: (v) => v === "CLAUDIO", destino: "CLAUDIO" },
  { teste: (v) => v === "MARCIO", destino: "MÁRCIO" },
  { teste: (v) => v === "NEO", destino: "NEOVOLTS" },
  { teste: (v) => v.startsWith("OV "), destino: "OURO VERDE" },
  { teste: (v) => v.includes("ROYER"), destino: "ROYER" },
  { teste: (v) => v.includes("SAN GERM"), destino: "SAN GERMAN" },
  { teste: (v) => v.includes("SOLAR GREEN"), destino: "Solar Green" },
];
const chave = (valor) =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
const numeros = (valor) =>
  String(valor ?? "")
    .split(/\D+/)
    .map(normalizarIdentificadorGeracao)
    .filter(Boolean);

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(arquivo);
const aba = workbook.worksheets[0];
if (!aba) throw new Error("A planilha não contém abas.");
const cabecalhos = new Map();
aba
  .getRow(1)
  .eachCell((celula, coluna) => cabecalhos.set(chave(celula.text), coluna));
const colunaNome = cabecalhos.get("NOME USINA");
const colunaAntiga = cabecalhos.get("UC GERADORA");
const colunaAtual = cabecalhos.get("UC NOVA GERADORA");
if (!colunaNome || !colunaAntiga || !colunaAtual)
  throw new Error("Cabeçalhos de usina e UCs geradoras não encontrados.");

const banco = obterBanco();
const mapeamentos = [];
const ignoradas = [];
for (let linha = 2; linha <= aba.rowCount; linha++) {
  const nomeOrigem = aba.getCell(linha, colunaNome).text.trim();
  if (!nomeOrigem) continue;
  const alias = aliases.find((item) => item.teste(chave(nomeOrigem)));
  if (!alias) {
    ignoradas.push(nomeOrigem);
    continue;
  }
  const usina = banco
    .prepare("SELECT id,nome FROM usinas WHERE lower(nome)=lower(?)")
    .get(alias.destino);
  if (!usina)
    throw new Error(`Usina de destino não cadastrada: ${alias.destino}`);
  for (const numero of numeros(aba.getCell(linha, colunaAtual).text))
    mapeamentos.push({ usina, numero, tipo: "atual", nomeOrigem });
  for (const numero of numeros(aba.getCell(linha, colunaAntiga).text))
    mapeamentos.push({ usina, numero, tipo: "historico", nomeOrigem });
}

const porNumero = new Map();
for (const item of mapeamentos) {
  if (!porNumero.has(item.numero)) porNumero.set(item.numero, new Set());
  porNumero.get(item.numero).add(item.usina.nome);
}
const conflitos = [...porNumero]
  .filter(([, usinas]) => usinas.size > 1)
  .map(([numero, usinas]) => ({ numero, usinas: [...usinas] }));
const numerosConflitantes = new Set(conflitos.map((item) => item.numero));
const mapeamentosValidos = mapeamentos.filter(
  (item) => !numerosConflitantes.has(item.numero),
);

if (confirmar) {
  const pastaBackup = resolve("backend/data/backups");
  mkdirSync(pastaBackup, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[-:.]/g, "");
  const backup = join(
    pastaBackup,
    `ecosol-antes-identificadores-usinas-${carimbo}.db`,
  );
  banco.prepare("VACUUM INTO ?").run(backup);
  prepararFaturamento(banco);
  const documentos = banco
    .prepare(
      `SELECT id,pdf,extracao FROM faturamento_documentos
       WHERE classificacao='fatura' AND excluido_em IS NULL`,
    )
    .all();
  const extracoes = [];
  for (const documento of documentos) {
    const leitura = await lerPdf(Buffer.from(documento.pdf));
    const numero = leitura.dados?.uc_geradora;
    if (!numero) continue;
    const anterior = JSON.parse(documento.extracao);
    if (anterior.dados?.uc_geradora === numero) continue;
    extracoes.push({ documento, leitura, numero, anterior });
  }
  banco.exec("BEGIN IMMEDIATE");
  try {
    const salvar = banco.prepare(
      `INSERT INTO usinas_identificadores_geracao(usina_id,numero,tipo,origem)
       VALUES(?,?,?,?)
       ON CONFLICT(usina_id,numero) DO UPDATE SET
         tipo=excluded.tipo,origem=excluded.origem`,
    );
    const removerConflito = banco.prepare(
      "DELETE FROM usinas_identificadores_geracao WHERE numero=?",
    );
    for (const conflito of conflitos) removerConflito.run(conflito.numero);
    for (const item of mapeamentosValidos)
      salvar.run(
        item.usina.id,
        item.numero,
        item.tipo,
        `${basename(arquivo)} · ${item.nomeOrigem}`,
      );

    const atualizar = banco.prepare(
      `UPDATE faturamento_documentos
       SET extracao=?,versao=versao+1,atualizado_em=CURRENT_TIMESTAMP
       WHERE id=?`,
    );
    const auditar = banco.prepare(
      `INSERT INTO faturamento_historico
       (documento_id,responsavel,acao,dados) VALUES(?,?,?,?)`,
    );
    for (const { documento, leitura, numero, anterior } of extracoes) {
      const identificacao = identificarUsinaPorGeracao(banco, numero);
      const extracao = {
        ...anterior,
        dados: { ...anterior.dados, uc_geradora: numero },
        evidencias: {
          ...anterior.evidencias,
          uc_geradora: leitura.evidencias.uc_geradora,
        },
      };
      atualizar.run(JSON.stringify(extracao), documento.id);
      auditar.run(
        documento.id,
        "Importação de identificadores de usinas",
        "Usina geradora identificada no SCEE",
        JSON.stringify(identificacao),
      );
    }
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

console.log(
  JSON.stringify(
    {
      modo: confirmar ? "confirmado" : "previa",
      planilha: arquivo,
      identificadores: mapeamentosValidos.length,
      usinas: [...new Set(mapeamentosValidos.map((item) => item.usina.nome))],
      conflitos_desconsiderados: conflitos,
      linhas_ignoradas: ignoradas,
    },
    null,
    2,
  ),
);
