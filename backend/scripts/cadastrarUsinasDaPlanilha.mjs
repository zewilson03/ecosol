import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { lerExcel } from "../servidor/faturamento/planilhas.mjs";
import {
  chaveCanonicaUsina,
  chaveUsina,
  conferirVinculoComAprovadas,
  extrairVinculosDaAba,
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
    "Uso: node cadastrarUsinasDaPlanilha.mjs planilha.xlsx ecosol.db [--dry-run|--simulate HASH|--apply HASH]",
  );

const conteudo = readFileSync(arquivo);
const hashArquivo = createHash("sha256").update(conteudo).digest("hex");
const extraida = extrairVinculosDaAba(
  await lerExcel(conteudo),
  "Consulta",
  "uc por usina.xlsx",
);
const inicio = "2026-10";
const provisoria = (nome) => {
  const chave = chaveUsina(nome);
  return !chave || chave === "nan" || chave.startsWith("ecosol");
};

function planejar(banco) {
  const usinas = banco.prepare("SELECT id,nome,versao FROM usinas").all();
  const porChave = new Map();
  for (const usina of usinas) {
    const chave = chaveCanonicaUsina(usina.nome);
    if (porChave.has(chave))
      throw new Error(`Cadastro duplicado de usina: ${usina.nome}.`);
    porChave.set(chave, usina);
  }
  const ecosol = porChave.get("ecosol");
  if (!ecosol) throw new Error("O card provisório Ecosol não existe.");
  const nomes = new Map();
  for (const linha of extraida.linhas) {
    if (provisoria(linha.usina)) continue;
    const chave = chaveCanonicaUsina(linha.usina);
    if (!nomes.has(chave)) nomes.set(chave, linha.usina);
  }
  const novas = [...nomes]
    .filter(([chave]) => !porChave.has(chave))
    .map(([chave, nome]) => ({ chave, nome }));
  const escolhas = {};
  for (const linha of extraida.linhas) {
    if (provisoria(linha.usina)) continue;
    escolhas[chaveUsina(linha.usina)] =
      porChave.get(chaveCanonicaUsina(linha.usina))?.id ?? "criar";
  }
  const normais = extraida.linhas.filter((linha) => !provisoria(linha.usina));
  const previa = prepararPrevia(
    { linhas: JSON.stringify(normais) },
    escolhas,
    banco,
  );
  const ativas = previa.linhas.filter((l) =>
    ["criar_uc", "vincular", "atualizar_uc_antiga"].includes(l.acao),
  );
  const unidades = banco
    .prepare(
      `SELECT u.id,u.uc,u.uc_antiga,u.usina_id,u.versao,
       COALESCE(c.name,p.nome,u.nome) AS cliente_nome
       FROM faturamento_unidades u
       LEFT JOIN customers c ON c.id=u.cliente_id
       LEFT JOIN faturamento_clientes_provisorios p ON p.id=u.cliente_provisorio_id`,
    )
    .all();
  const porUc = new Map(unidades.map((u) => [u.uc, u]));
  const porAntiga = new Map();
  for (const u of unidades) if (u.uc_antiga) porAntiga.set(u.uc_antiga, u);
  const pendentes = [];
  const provisoes = [];
  for (const l of extraida.linhas.filter((linha) => provisoria(linha.usina))) {
    if (l.erro || !l.uc || !l.cliente) {
      pendentes.push({
        linha: l.linha,
        motivo: l.erro || "UC ou cliente ausente",
      });
      continue;
    }
    const u = porUc.get(l.uc);
    if (
      (!u && porAntiga.has(l.uc)) ||
      (l.uc_antiga &&
        ((porUc.has(l.uc_antiga) && porUc.get(l.uc_antiga)?.id !== u?.id) ||
          (porAntiga.has(l.uc_antiga) &&
            porAntiga.get(l.uc_antiga)?.id !== u?.id)))
    ) {
      pendentes.push({ linha: l.linha, motivo: "Numeração de UC conflitante" });
      continue;
    }
    if (u && chaveUsina(u.cliente_nome) !== chaveUsina(l.cliente)) {
      pendentes.push({ linha: l.linha, motivo: "Cliente divergente" });
      continue;
    }
    if (u?.uc_antiga && l.uc_antiga && u.uc_antiga !== l.uc_antiga) {
      pendentes.push({ linha: l.linha, motivo: "UC antiga divergente" });
      continue;
    }
    if (u?.usina_id && u.usina_id !== ecosol.id) {
      pendentes.push({ linha: l.linha, motivo: "UC vinculada a outra usina" });
      continue;
    }
    const acao = !u
      ? "criar_uc"
      : u.usina_id === null
        ? "vincular"
        : l.uc_antiga && !u.uc_antiga
          ? "atualizar_uc_antiga"
          : "inalterada";
    provisoes.push({ ...l, acao, unidade_id: u?.id, versao: u?.versao });
  }
  const resumo = {
    usinas_novas: novas.length,
    ucs_identificadas: previa.resumo,
    ecosol: {
      criar_uc: provisoes.filter((l) => l.acao === "criar_uc").length,
      vincular: provisoes.filter((l) => l.acao === "vincular").length,
      atualizar_uc_antiga: provisoes.filter(
        (l) => l.acao === "atualizar_uc_antiga",
      ).length,
      inalteradas: provisoes.filter((l) => l.acao === "inalterada").length,
      pendentes: pendentes.length,
    },
  };
  const hash = createHash("sha256")
    .update(hashArquivo)
    .update(
      JSON.stringify({
        usinas,
        novas,
        escolhas,
        previa: previa.linhas,
        provisoes,
        pendentes,
      }),
    )
    .digest("hex");
  return { ecosol, novas, ativas, provisoes, pendentes, resumo, hash };
}

function registrarUc(banco, linha, usinaId, origem) {
  let unidadeId = linha.unidade_id;
  if (linha.acao === "vincular") {
    if (origem === "identificada")
      conferirVinculoComAprovadas(banco, unidadeId, usinaId);
    const r = banco
      .prepare(
        "UPDATE faturamento_unidades SET usina_id=?,uc_antiga=COALESCE(uc_antiga,?),versao=versao+1 WHERE id=? AND usina_id IS NULL AND versao=?",
      )
      .run(usinaId, linha.uc_antiga || null, unidadeId, linha.versao);
    if (r.changes !== 1) throw new Error("UC alterada durante o vínculo.");
  } else if (linha.acao === "atualizar_uc_antiga") {
    const r = banco
      .prepare(
        "UPDATE faturamento_unidades SET uc_antiga=?,versao=versao+1 WHERE id=? AND usina_id=? AND uc_antiga IS NULL AND versao=?",
      )
      .run(linha.uc_antiga, unidadeId, usinaId, linha.versao);
    if (r.changes !== 1) throw new Error("UC alterada durante a atualização.");
  } else if (linha.acao === "criar_uc") {
    const chaveOrigem = `planilha-usina:${linha.uc}`;
    const provisorioId = Number(
      banco
        .prepare(
          "INSERT INTO faturamento_clientes_provisorios(nome,chave_origem,origem) VALUES(?,?,?)",
        )
        .run(linha.cliente, chaveOrigem, "Importação de UC por usina")
        .lastInsertRowid,
    );
    unidadeId = Number(
      banco
        .prepare(
          "INSERT INTO faturamento_unidades(uc,uc_antiga,nome,documento,email,dia_vencimento,usina_id,cliente_provisorio_id) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          linha.uc,
          linha.uc_antiga || null,
          linha.cliente,
          "",
          "",
          0,
          usinaId,
          provisorioId,
        ).lastInsertRowid,
    );
  } else return;
  banco
    .prepare(
      "INSERT INTO faturamento_historico(unidade_id,responsavel,acao,dados) VALUES(?,?,?,?)",
    )
    .run(
      unidadeId,
      "Importação autorizada pelo usuário",
      "UC vinculada à usina por planilha",
      JSON.stringify({
        hash: hashArquivo,
        aba: "Consulta",
        linha: linha.linha,
        uc: linha.uc,
        usina_id: usinaId,
        origem,
        acao: linha.acao,
      }),
    );
}

const leitura = new DatabaseSync(bancoArquivo, { readOnly: true });
let plano;
try {
  plano = planejar(leitura);
} finally {
  leitura.close();
}
console.log(
  JSON.stringify(
    {
      modo,
      hashArquivo,
      hashPrevia: plano.hash,
      ...plano.resumo,
      nomesNovos: plano.novas.map((u) => u.nome),
      linhasParaConferencia: plano.pendentes.map((l) => l.linha),
    },
    null,
    2,
  ),
);
if (modo === "--dry-run") process.exit(0);
if (hashEsperado !== plano.hash)
  throw new Error("A prévia mudou. Confira o hash antes de aplicar.");

const copia =
  modo === "--simulate"
    ? join(mkdtempSync(join(tmpdir(), "ecosol-usinas-")), "ecosol.db")
    : join(
        dirname(bancoArquivo),
        "backups",
        `ecosol-antes-usinas-planilha-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
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
  if (atual.hash !== plano.hash)
    throw new Error("O banco mudou durante a análise. Nada foi importado.");
  const ids = new Map(
    banco
      .prepare("SELECT id,nome FROM usinas")
      .all()
      .map((u) => [chaveCanonicaUsina(u.nome), u.id]),
  );
  for (const nova of atual.novas) {
    const id = Number(
      banco
        .prepare(
          "INSERT INTO usinas(nome,localizacao,status) VALUES(?,'A confirmar','Cadastro inicial')",
        )
        .run(nova.nome).lastInsertRowid,
    );
    banco
      .prepare(
        "INSERT INTO usinas_modalidades(usina_id,inicio,modalidade) VALUES(?,?,?)",
      )
      .run(id, inicio, "GDI");
    banco
      .prepare(
        "INSERT INTO faturamento_historico(responsavel,acao,dados) VALUES(?,?,?)",
      )
      .run(
        "Cadastro autorizado pelo usuário",
        "Usina criada a partir da planilha",
        JSON.stringify({
          hash: hashArquivo,
          usina_id: id,
          nome: nova.nome,
          modalidade: "GDI",
          inicio,
        }),
      );
    ids.set(nova.chave, id);
  }
  for (const linha of atual.ativas)
    registrarUc(
      banco,
      linha,
      ids.get(chaveCanonicaUsina(linha.usina)),
      "identificada",
    );
  for (const linha of atual.provisoes)
    registrarUc(banco, linha, atual.ecosol.id, "ecosol_pendente");
  if (banco.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw new Error("A integridade do banco falhou.");
  banco.exec("COMMIT");
  console.log(
    JSON.stringify(
      {
        modo,
        aplicadas:
          atual.ativas.length +
          atual.provisoes.filter((l) => l.acao !== "inalterada").length,
        usinasCriadas: atual.novas.length,
        backup: copia,
      },
      null,
      2,
    ),
  );
} catch (erro) {
  banco.exec("ROLLBACK");
  throw erro;
} finally {
  banco.close();
}
