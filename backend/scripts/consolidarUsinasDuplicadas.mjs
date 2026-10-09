import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { chaveUsina } from "../servidor/faturamento/vinculosUsinas.mjs";

const [bancoArquivo, modo = "--dry-run", hashEsperado] = process.argv.slice(2);
if (!bancoArquivo || !["--dry-run", "--simulate", "--apply"].includes(modo))
  throw new Error(
    "Uso: node consolidarUsinasDuplicadas.mjs ecosol.db [--dry-run|--simulate HASH|--apply HASH]",
  );

const pares = [
  { origem: "CLAU", destino: "CLAUDIO" },
  { origem: "CARLOS", destino: "CARLOS UNIÃO" },
  { origem: "BOLT", destino: "BOLT ENERGIA" },
  { origem: "JB C", destino: "J B CARVALHO", nomeFinal: "JB Carvalho" },
  { origem: "PEDRO H", destino: "PEDRO HENRIQUE" },
  { origem: "SOLAR", destino: "Solar Green" },
  {
    origem: "TG SILVA",
    destino: "TG SILVA DANIELE",
    nomeFinal: "TG Silva Danielle",
  },
];

function tabelaExiste(banco, nome) {
  return Boolean(
    banco
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(nome),
  );
}

function planejar(banco) {
  if (
    tabelaExiste(banco, "usinas_importacoes_vinculos") &&
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM usinas_importacoes_vinculos WHERE status='Pendente'",
      )
      .get().n
  )
    throw new Error(
      "Existe uma importação de vínculos pendente de confirmação.",
    );
  const usinas = banco
    .prepare("SELECT id,nome,localizacao,status,versao FROM usinas")
    .all();
  const porNome = new Map(usinas.map((u) => [u.nome, u]));
  const porChave = new Map();
  for (const u of usinas) {
    const chave = chaveUsina(u.nome);
    if (porChave.has(chave))
      throw new Error(`Há usinas com nomes equivalentes: ${u.nome}.`);
    porChave.set(chave, u);
  }
  const plano = pares.map((par) => {
    const origem = porNome.get(par.origem);
    const destino = porNome.get(par.destino) ?? porNome.get(par.nomeFinal);
    if (!destino)
      throw new Error(`A usina de destino ${par.destino} não foi encontrada.`);
    if (!origem)
      return {
        ...par,
        destino,
        concluido: true,
        unidades: [],
        modalidades: [],
      };
    if (origem.id === destino.id)
      throw new Error(`Origem e destino coincidem em ${par.origem}.`);
    if (
      par.nomeFinal &&
      porChave.has(chaveUsina(par.nomeFinal)) &&
      porChave.get(chaveUsina(par.nomeFinal)).id !== destino.id
    )
      throw new Error(
        `O nome final ${par.nomeFinal} já pertence a outra usina.`,
      );
    const unidades = banco
      .prepare(
        "SELECT id,versao FROM faturamento_unidades WHERE usina_id=? ORDER BY id",
      )
      .all(origem.id);
    const documentos = banco
      .prepare(
        `SELECT COUNT(*) AS n FROM faturamento_documentos d
         JOIN faturamento_unidades u ON u.id=d.unidade_id WHERE u.usina_id=?`,
      )
      .get(origem.id).n;
    if (documentos)
      throw new Error(
        `${par.origem} possui faturas vinculadas; a modalidade e o histórico precisam de revisão antes da união.`,
      );
    if (
      tabelaExiste(banco, "faturamento_vinculos_usina") &&
      banco
        .prepare(
          "SELECT COUNT(*) AS n FROM faturamento_vinculos_usina WHERE usina_id=? OR origem_usina_id=?",
        )
        .get(origem.id, origem.id).n
    )
      throw new Error(
        `${par.origem} possui vínculos históricos de transferência.`,
      );
    if (
      tabelaExiste(banco, "faturamento_importacoes") &&
      banco
        .prepare(
          "SELECT COUNT(*) AS n FROM faturamento_importacoes WHERE usina_id=?",
        )
        .get(origem.id).n
    )
      throw new Error(
        `${par.origem} possui importações de planilha pendentes.`,
      );
    const modalidades = banco
      .prepare(
        "SELECT inicio,modalidade FROM usinas_modalidades WHERE usina_id=? ORDER BY inicio",
      )
      .all(origem.id);
    const destinoModalidades = banco
      .prepare(
        "SELECT inicio,modalidade FROM usinas_modalidades WHERE usina_id=? ORDER BY inicio",
      )
      .all(destino.id);
    if (!destinoModalidades.length)
      throw new Error(`${par.destino} não possui modalidade cadastrada.`);
    return {
      ...par,
      origem,
      destino,
      unidades,
      modalidades,
      destinoModalidades,
      concluido: false,
    };
  });
  const hash = createHash("sha256").update(JSON.stringify(plano)).digest("hex");
  return { plano, hash };
}

const leitura = new DatabaseSync(bancoArquivo, { readOnly: true });
let previa;
try {
  previa = planejar(leitura);
} finally {
  leitura.close();
}
console.log(
  JSON.stringify(
    {
      modo,
      hashPrevia: previa.hash,
      pares: previa.plano.map((p) => ({
        origem: p.origem?.nome ?? p.origem,
        destino: p.nomeFinal ?? p.destino.nome,
        ucs: p.unidades.length,
        modalidadeOrigem: p.modalidades,
        modalidadeDestino: p.destinoModalidades,
        concluido: p.concluido,
      })),
    },
    null,
    2,
  ),
);
if (modo === "--dry-run") process.exit(0);
if (hashEsperado !== previa.hash)
  throw new Error("A prévia mudou. Confira o hash antes de aplicar.");

const copia =
  modo === "--simulate"
    ? join(mkdtempSync(join(tmpdir(), "ecosol-unir-usinas-")), "ecosol.db")
    : join(
        dirname(bancoArquivo),
        "backups",
        `ecosol-antes-unir-usinas-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
      );
if (modo === "--apply") mkdirSync(dirname(copia), { recursive: true });
const origem = new DatabaseSync(bancoArquivo, { readOnly: true });
try {
  await backup(origem, copia);
} finally {
  origem.close();
}
const banco = new DatabaseSync(modo === "--simulate" ? copia : bancoArquivo);
banco.exec("PRAGMA busy_timeout=5000");
banco.exec("BEGIN IMMEDIATE");
try {
  const atual = planejar(banco);
  if (atual.hash !== previa.hash)
    throw new Error("O banco mudou durante a análise. Nada foi consolidado.");
  for (const par of atual.plano) {
    if (par.concluido) continue;
    const atualizadas = banco
      .prepare(
        "UPDATE faturamento_unidades SET usina_id=?,versao=versao+1 WHERE usina_id=?",
      )
      .run(par.destino.id, par.origem.id);
    if (atualizadas.changes !== par.unidades.length)
      throw new Error(`A quantidade de UCs de ${par.origem.nome} mudou.`);
    if (par.nomeFinal)
      banco
        .prepare("UPDATE usinas SET nome=?,versao=versao+1 WHERE id=?")
        .run(par.nomeFinal, par.destino.id);
    banco
      .prepare(
        "INSERT INTO faturamento_historico(responsavel,acao,dados) VALUES(?,?,?)",
      )
      .run(
        "Consolidação autorizada pelo usuário",
        "Usinas duplicadas consolidadas",
        JSON.stringify({
          origem: { id: par.origem.id, nome: par.origem.nome },
          destino: {
            id: par.destino.id,
            nome: par.nomeFinal ?? par.destino.nome,
          },
          unidades_movidas: par.unidades.map((u) => u.id),
          modalidades_origem: par.modalidades,
          modalidades_destino: par.destinoModalidades,
        }),
      );
    banco
      .prepare("DELETE FROM usinas_modalidades WHERE usina_id=?")
      .run(par.origem.id);
    const removida = banco
      .prepare("DELETE FROM usinas WHERE id=?")
      .run(par.origem.id);
    if (removida.changes !== 1)
      throw new Error(`A usina duplicada ${par.origem.nome} não foi removida.`);
  }
  if (banco.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw new Error("A integridade do banco falhou.");
  const verificada = planejar(banco);
  if (verificada.plano.some((p) => !p.concluido))
    throw new Error("Ainda existem duplicatas após a consolidação.");
  banco.exec("COMMIT");
  console.log(
    JSON.stringify({
      modo,
      usinasRemovidas: atual.plano.filter((p) => !p.concluido).length,
      ucsReunidas: atual.plano.reduce((n, p) => n + p.unidades.length, 0),
      backup: copia,
    }),
  );
} catch (erro) {
  banco.exec("ROLLBACK");
  throw erro;
} finally {
  banco.close();
}
