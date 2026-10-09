import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { lerExcel } from "../servidor/faturamento/planilhas.mjs";
import {
  chaveUsina,
  conferirVinculoComAprovadas,
  extrairVinculosDaAba,
  modalidadeVigenteDaUsina,
} from "../servidor/faturamento/vinculosUsinas.mjs";
import { prepararPrevia } from "../servidor/faturamento/rotasVinculosUsinas.mjs";

const [arquivo, bancoArquivo, modo = "--dry-run", hashEsperado] =
  process.argv.slice(2);
if (
  !arquivo ||
  !bancoArquivo ||
  !["--dry-run", "--simulate", "--apply"].includes(modo)
)
  throw new Error(
    "Uso: node importarVinculosConfirmados.mjs planilha.xlsx ecosol.db [--dry-run|--simulate|--apply HASH_DA_PREVIA]",
  );

const conteudo = readFileSync(arquivo);
const hashArquivo = createHash("sha256").update(conteudo).digest("hex");
const abas = await lerExcel(conteudo);
const extraida = extrairVinculosDaAba(abas, "Consulta", "uc por usina.xlsx");
const linhas = JSON.stringify(extraida.linhas);
const autorizadas = new Map([
  ["saofrancisco", "São Francisco"],
  ["solargreen", "Solar Green"],
  ["2000solar", "2000 Solar"],
]);

function planejar(banco) {
  const usinas = banco.prepare("SELECT id,nome FROM usinas").all();
  const escolhas = {};
  for (const [chave, nome] of autorizadas) {
    const correspondentes = usinas.filter((u) => chaveUsina(u.nome) === chave);
    if (correspondentes.length !== 1 || correspondentes[0].nome !== nome)
      throw new Error(`A identificação da usina ${nome} não é única e exata.`);
    if (
      modalidadeVigenteDaUsina(banco, correspondentes[0].id, "2026-10")
        ?.modalidade !== "GDII"
    )
      throw new Error(`A modalidade de ${nome} não está confirmada.`);
    escolhas[chave] = correspondentes[0].id;
  }
  const previa = prepararPrevia({ linhas }, escolhas, banco);
  const ativas = previa.linhas.filter((l) =>
    ["criar_uc", "vincular", "atualizar_uc_antiga"].includes(l.acao),
  );
  if (!ativas.length) throw new Error("Não há vínculos novos para importar.");
  if (
    ativas.some(
      (l) =>
        !autorizadas.has(chaveUsina(l.usina)) ||
        l.destino?.tipo !== "existente",
    )
  )
    throw new Error("A prévia contém uma usina ainda não autorizada.");
  const hash = createHash("sha256")
    .update(hashArquivo)
    .update(JSON.stringify(previa.linhas))
    .digest("hex");
  return { previa, ativas, hash };
}

const fonte = new DatabaseSync(bancoArquivo, { readOnly: true });
let plano;
try {
  plano = planejar(fonte);
} finally {
  fonte.close();
}
console.log(
  JSON.stringify({
    modo,
    hashArquivo,
    hashPrevia: plano.hash,
    totalPlanilha: extraida.linhas.length,
    resumo: plano.previa.resumo,
  }),
);
if (modo === "--dry-run") process.exit(0);
if (modo === "--apply" && hashEsperado !== plano.hash)
  throw new Error("A prévia mudou. Execute --dry-run e confira novamente.");

const destino =
  modo === "--simulate"
    ? join(mkdtempSync(join(tmpdir(), "ecosol-vinculos-")), "ecosol.db")
    : join(
        dirname(bancoArquivo),
        "backups",
        `ecosol-antes-vinculos-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
      );
if (modo === "--apply") mkdirSync(dirname(destino), { recursive: true });
const origem = new DatabaseSync(bancoArquivo, { readOnly: true });
try {
  await backup(origem, destino);
} finally {
  origem.close();
}
const alvoArquivo = modo === "--simulate" ? destino : bancoArquivo;
const banco = new DatabaseSync(alvoArquivo);
banco.exec("PRAGMA busy_timeout=5000");
banco.exec("BEGIN IMMEDIATE");
try {
  const atual = planejar(banco);
  if (atual.hash !== plano.hash)
    throw new Error(
      "Os cadastros mudaram durante a análise. Nada foi importado.",
    );
  for (const l of atual.ativas) {
    const usinaId = l.destino.id;
    let unidadeId = l.unidade_id;
    if (l.acao === "vincular") {
      conferirVinculoComAprovadas(banco, unidadeId, usinaId);
      const r = banco
        .prepare(
          "UPDATE faturamento_unidades SET usina_id=?,uc_antiga=COALESCE(uc_antiga,?),versao=versao+1 WHERE id=? AND usina_id IS NULL AND versao=?",
        )
        .run(usinaId, l.uc_antiga || null, unidadeId, l.versao);
      if (r.changes !== 1) throw new Error("UC alterada durante o vínculo.");
    } else if (l.acao === "atualizar_uc_antiga") {
      const r = banco
        .prepare(
          "UPDATE faturamento_unidades SET uc_antiga=?,versao=versao+1 WHERE id=? AND usina_id=? AND uc_antiga IS NULL AND versao=?",
        )
        .run(l.uc_antiga, unidadeId, usinaId, l.versao);
      if (r.changes !== 1)
        throw new Error("UC alterada durante a atualização.");
    } else {
      const chaveOrigem = `planilha-usina:${l.uc}`;
      const provisorioId = Number(
        banco
          .prepare(
            "INSERT INTO faturamento_clientes_provisorios(nome,chave_origem,origem) VALUES(?,?,?)",
          )
          .run(l.cliente, chaveOrigem, "Importação de UC por usina")
          .lastInsertRowid,
      );
      unidadeId = Number(
        banco
          .prepare(
            "INSERT INTO faturamento_unidades(uc,uc_antiga,nome,documento,email,dia_vencimento,usina_id,cliente_provisorio_id) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            l.uc,
            l.uc_antiga || null,
            l.cliente,
            "",
            "",
            0,
            usinaId,
            provisorioId,
          ).lastInsertRowid,
      );
    }
    banco
      .prepare(
        "INSERT INTO faturamento_historico(unidade_id,responsavel,acao,dados) VALUES(?,?,?,?)",
      )
      .run(
        unidadeId,
        "Importação autorizada pelo usuário",
        "UC por usina importada de planilha",
        JSON.stringify({
          hash: hashArquivo,
          aba: "Consulta",
          linha: l.linha,
          uc: l.uc,
          uc_antiga: l.uc_antiga,
          usina_id: usinaId,
          acao: l.acao,
        }),
      );
  }
  if (banco.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw new Error("A verificação do banco falhou.");
  banco.exec("COMMIT");
  console.log(
    JSON.stringify({ aplicado: atual.ativas.length, backup: destino, modo }),
  );
} catch (erro) {
  banco.exec("ROLLBACK");
  throw erro;
} finally {
  banco.close();
}
