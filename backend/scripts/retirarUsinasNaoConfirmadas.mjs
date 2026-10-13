import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { chaveUsina } from "../servidor/faturamento/vinculosUsinas.mjs";

const [bancoArquivo, modo = "--dry-run", hashEsperado] = process.argv.slice(2);
if (!bancoArquivo || !["--dry-run", "--simulate", "--apply"].includes(modo))
  throw new Error(
    "Uso: node retirarUsinasNaoConfirmadas.mjs ecosol.db [--dry-run|--simulate HASH|--apply HASH]",
  );

const conservar = new Set([
  "2000solar",
  "abadiania",
  "claudio",
  "marcio",
  "neovolts",
  "saofrancisco",
  "sangerman",
  "solargreen",
  "royer",
  "ouroverde",
  "ecosol", // Card provisório; não representa uma usina real.
]);

function tabelaExiste(banco, nome) {
  return Boolean(
    banco
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(nome),
  );
}

function planejar(banco) {
  const usinas = banco
    .prepare("SELECT id,nome,localizacao,status,versao FROM usinas ORDER BY id")
    .all();
  const porChave = new Map();
  for (const usina of usinas) {
    const chave = chaveUsina(usina.nome);
    if (porChave.has(chave))
      throw new Error(`Há cadastros equivalentes para ${usina.nome}.`);
    porChave.set(chave, usina);
  }
  for (const chave of conservar)
    if (!porChave.has(chave))
      throw new Error(`Falta uma usina que deve ser conservada: ${chave}.`);
  const ecosol = porChave.get("ecosol");
  const abadiania = porChave.get("abadiania");
  if (
    tabelaExiste(banco, "usinas_importacoes_vinculos") &&
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM usinas_importacoes_vinculos WHERE status='Pendente'",
      )
      .get().n
  )
    throw new Error("Há uma importação de UCs aguardando confirmação.");
  const retiradas = usinas
    .filter((u) => !conservar.has(chaveUsina(u.nome)))
    .map((usina) => {
      const unidades = banco
        .prepare(
          "SELECT id,versao FROM faturamento_unidades WHERE usina_id=? ORDER BY id",
        )
        .all(usina.id);
      const documentos = banco
        .prepare(
          `SELECT COUNT(*) AS n FROM faturamento_documentos d
           JOIN faturamento_unidades u ON u.id=d.unidade_id
           WHERE u.usina_id=?`,
        )
        .get(usina.id).n;
      if (documentos)
        throw new Error(
          `${usina.nome} tem faturas vinculadas; não será retirada.`,
        );
      if (
        tabelaExiste(banco, "faturamento_vinculos_usina") &&
        banco
          .prepare(
            "SELECT COUNT(*) AS n FROM faturamento_vinculos_usina WHERE usina_id=? OR origem_usina_id=?",
          )
          .get(usina.id, usina.id).n
      )
        throw new Error(
          `${usina.nome} participa de um histórico de transferências; não será retirada.`,
        );
      if (
        tabelaExiste(banco, "faturamento_importacoes") &&
        banco
          .prepare(
            "SELECT COUNT(*) AS n FROM faturamento_importacoes WHERE usina_id=?",
          )
          .get(usina.id).n
      )
        throw new Error(`${usina.nome} participa de uma importação pendente.`);
      const modalidades = banco
        .prepare(
          "SELECT inicio,modalidade FROM usinas_modalidades WHERE usina_id=? ORDER BY inicio",
        )
        .all(usina.id);
      return { usina, unidades, modalidades };
    });
  const ecosolAntes = banco
    .prepare("SELECT COUNT(*) AS n FROM faturamento_unidades WHERE usina_id=?")
    .get(ecosol.id).n;
  const plano = { usinas, ecosol, abadiania, ecosolAntes, retiradas };
  return {
    ...plano,
    hash: createHash("sha256").update(JSON.stringify(plano)).digest("hex"),
  };
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
      ecosolAntes: previa.ecosolAntes,
      usinasRetiradas: previa.retiradas.length,
      ucsParaEcosol: previa.retiradas.reduce(
        (total, item) => total + item.unidades.length,
        0,
      ),
      porUsina: previa.retiradas.map(({ usina, unidades }) => ({
        nome: usina.nome,
        ucs: unidades.length,
      })),
      nomeCompletoAbd: "Abadiânia",
    },
    null,
    2,
  ),
);
if (modo === "--dry-run") process.exit(0);
if (hashEsperado !== previa.hash)
  throw new Error("A prévia mudou. Gere uma nova prévia antes de aplicar.");

const copia =
  modo === "--simulate"
    ? join(mkdtempSync(join(tmpdir(), "ecosol-retirar-usinas-")), "ecosol.db")
    : join(
        dirname(bancoArquivo),
        "backups",
        `ecosol-antes-retirar-usinas-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
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
    throw new Error("O banco mudou após a prévia. Nenhuma usina foi retirada.");
  for (const { usina, unidades, modalidades } of atual.retiradas) {
    for (const unidade of unidades) {
      const alterada = banco
        .prepare(
          "UPDATE faturamento_unidades SET usina_id=?,versao=versao+1 WHERE id=? AND usina_id=? AND versao=?",
        )
        .run(atual.ecosol.id, unidade.id, usina.id, unidade.versao);
      if (alterada.changes !== 1)
        throw new Error(`A UC ${unidade.id} mudou durante a operação.`);
      banco
        .prepare(
          "INSERT INTO faturamento_historico(unidade_id,responsavel,acao,dados) VALUES(?,?,?,?)",
        )
        .run(
          unidade.id,
          "Reorganização autorizada pelo usuário",
          "UC movida para classificação provisória Ecosol",
          JSON.stringify({
            origem_usina_id: usina.id,
            origem_usina_nome: usina.nome,
            destino_usina_id: atual.ecosol.id,
            modalidades_origem: modalidades,
          }),
        );
    }
    banco
      .prepare(
        "INSERT INTO faturamento_historico(responsavel,acao,dados) VALUES(?,?,?)",
      )
      .run(
        "Reorganização autorizada pelo usuário",
        "Usina não confirmada retirada do catálogo",
        JSON.stringify({
          usina_id: usina.id,
          nome: usina.nome,
          localizacao: usina.localizacao,
          status: usina.status,
          modalidades,
          unidades: unidades.map((u) => u.id),
          destino_provisorio_id: atual.ecosol.id,
        }),
      );
    banco
      .prepare("DELETE FROM usinas_modalidades WHERE usina_id=?")
      .run(usina.id);
    const retirada = banco
      .prepare("DELETE FROM usinas WHERE id=?")
      .run(usina.id);
    if (retirada.changes !== 1)
      throw new Error(`Não foi possível retirar ${usina.nome}.`);
  }
  if (atual.abadiania.nome !== "Abadiânia") {
    const renomeada = banco
      .prepare(
        "UPDATE usinas SET nome=?,versao=versao+1 WHERE id=? AND versao=?",
      )
      .run("Abadiânia", atual.abadiania.id, atual.abadiania.versao);
    if (renomeada.changes !== 1)
      throw new Error("Abadiânia mudou durante a confirmação.");
    banco
      .prepare(
        "INSERT INTO faturamento_historico(responsavel,acao,dados) VALUES(?,?,?)",
      )
      .run(
        "Reorganização autorizada pelo usuário",
        "Nome completo da usina confirmado",
        JSON.stringify({
          usina_id: atual.abadiania.id,
          anterior: atual.abadiania.nome,
          atual: "Abadiânia",
        }),
      );
  }
  const esperadas = conservar.size;
  if (banco.prepare("SELECT COUNT(*) AS n FROM usinas").get().n !== esperadas)
    throw new Error("A quantidade final de cards não corresponde à prévia.");
  const ecosolDepois = banco
    .prepare("SELECT COUNT(*) AS n FROM faturamento_unidades WHERE usina_id=?")
    .get(atual.ecosol.id).n;
  const movidas = atual.retiradas.reduce(
    (total, item) => total + item.unidades.length,
    0,
  );
  if (ecosolDepois !== atual.ecosolAntes + movidas)
    throw new Error("A quantidade de UCs provisórias não confere.");
  const unidadesOrfas = banco
    .prepare(
      "SELECT COUNT(*) AS n FROM faturamento_unidades u WHERE u.usina_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM usinas s WHERE s.id=u.usina_id)",
    )
    .get().n;
  if (unidadesOrfas || banco.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("Restaram referências inválidas a usinas.");
  if (banco.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw new Error("A integridade do banco falhou.");
  banco.exec("COMMIT");
  console.log(
    JSON.stringify({
      modo,
      usinasRetiradas: atual.retiradas.length,
      ucsMovidas: movidas,
      ecosolDepois,
      backup: copia,
    }),
  );
} catch (erro) {
  banco.exec("ROLLBACK");
  throw erro;
} finally {
  banco.close();
}
