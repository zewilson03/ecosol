import express, { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { obterBanco } from "../bancoDeDados.mjs";
import { exigirNivel } from "../permissoesDaEquipe.mjs";
import { falhar, texto } from "./regras.mjs";
import { lerExcel } from "./planilhas.mjs";
import {
  chaveCanonicaUsina,
  chaveUsina,
  conferirVinculoComAprovadas,
  extrairVinculosDaAba,
  identificarAbasDeVinculos,
  modalidadeInicialDaUsina,
  modalidadeVigenteDaUsina,
} from "./vinculosUsinas.mjs";

export const rotasVinculosUsinas = Router();
rotasVinculosUsinas.use(exigirNivel(3));
const mime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const inicio = "2026-10";

function sessao(req, banco) {
  const s = banco
    .prepare("SELECT * FROM usinas_importacoes_vinculos WHERE id=?")
    .get(String(req.params.id));
  if (!s || s.responsavel_id !== req.administrador.id)
    falhar("Análise de UCs não encontrada para este acesso.", 404);
  if (s.status !== "Concluída" && s.expira_em < Date.now())
    falhar("A análise expirou. Envie a planilha novamente.", 410);
  return s;
}

function resumirNomes(linhas, banco) {
  const usinas = banco
    .prepare("SELECT id,nome FROM usinas ORDER BY nome,id")
    .all();
  const nomes = new Map();
  for (const linha of linhas) {
    if (!linha.usina) continue;
    const chave = chaveUsina(linha.usina);
    if (!nomes.has(chave))
      nomes.set(chave, { chave, nome: linha.usina, quantidade: 0 });
    nomes.get(chave).quantidade++;
  }
  return [...nomes.values()].map((item) => {
    const candidatas = usinas.filter(
      (u) =>
        item.chave !== "ecosol" &&
        chaveCanonicaUsina(u.nome) === chaveCanonicaUsina(item.nome),
    );
    const semelhanteGdii = ["saofrancisco", "solargreen", "2000solar"].some(
      (chave) => item.chave !== chave && item.chave.includes(chave),
    );
    return {
      ...item,
      usina_id_sugerida: candidatas.length === 1 ? candidatas[0].id : null,
      modalidade_sugerida:
        item.chave === "ecosol" ? null : modalidadeInicialDaUsina(item.nome),
      ambigua: candidatas.length > 1,
      semelhante_gdii: semelhanteGdii,
    };
  });
}

rotasVinculosUsinas.post(
  "/analisar",
  express.raw({ type: mime, limit: "5mb" }),
  async (req, res) => {
    const nome = texto(req.query.nome, "o nome do arquivo", 200);
    if (
      !/\.xlsx$/i.test(nome) ||
      !Buffer.isBuffer(req.body) ||
      req.body.length < 4 ||
      req.body.subarray(0, 2).toString() !== "PK"
    )
      falhar("Envie uma planilha .xlsx com até 5 MB.");
    let abas;
    try {
      abas = await lerExcel(req.body);
    } catch (erro) {
      falhar("Não foi possível analisar o Excel. " + erro.message);
    }
    const identificadas = identificarAbasDeVinculos(abas, nome).filter(
      (a) => a.compativel,
    );
    if (!identificadas.length)
      falhar("Não foi encontrada uma aba com coluna de UC.");
    const pedida = String(req.query.aba ?? "");
    const escolhida = pedida
      ? identificadas.find((a) => a.nome === pedida)
      : (identificadas.find(
          (a) => a.nome.toLowerCase() === "consulta" && a.coluna_usina !== null,
        ) ??
        identificadas.find((a) => a.coluna_usina !== null) ??
        identificadas[0]);
    if (!escolhida) falhar("A aba escolhida não tem coluna de UC.");
    const extraida = extrairVinculosDaAba(abas, escolhida.nome, nome);
    if (!extraida.linhas.length) falhar("A aba escolhida não contém UCs.");
    const banco = obterBanco();
    banco
      .prepare(
        "UPDATE usinas_importacoes_vinculos SET status='Expirada',linhas='[]',previa=NULL WHERE status='Pendente' AND expira_em<?",
      )
      .run(Date.now());
    const id = randomUUID();
    banco
      .prepare(
        "INSERT INTO usinas_importacoes_vinculos(id,responsavel_id,nome,hash,aba,linhas,expira_em) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        id,
        req.administrador.id,
        nome,
        createHash("sha256").update(req.body).digest("hex"),
        escolhida.nome,
        JSON.stringify(extraida.linhas),
        Date.now() + 3600000,
      );
    res
      .status(201)
      .set("Cache-Control", "no-store")
      .json({
        id,
        aba: escolhida.nome,
        abas: identificadas.map(({ nome, cabecalho, coluna_usina }) => ({
          nome,
          cabecalho,
          tem_coluna_usina: coluna_usina !== null,
        })),
        linhas: extraida.linhas.length,
        nomes: resumirNomes(extraida.linhas, banco),
        erros: extraida.linhas.filter((l) => l.erro).length,
        amostra: extraida.linhas
          .slice(0, 20)
          .map(({ linha, uc, uc_antiga, usina, erro }) => ({
            linha,
            uc,
            uc_antiga,
            usina,
            erro,
          })),
      });
  },
);

export function prepararPrevia(s, escolhas, banco) {
  if (!escolhas || typeof escolhas !== "object" || Array.isArray(escolhas))
    falhar("Confira a associação de cada nome de usina.");
  const linhas = JSON.parse(s.linhas);
  const nomes = resumirNomes(linhas, banco);
  const mapa = new Map();
  for (const item of nomes) {
    const escolha = escolhas[item.chave];
    if (
      escolha === "ignorar" ||
      escolha === undefined ||
      escolha === null ||
      escolha === ""
    ) {
      mapa.set(item.chave, { tipo: "ignorar" });
      continue;
    }
    if (escolha === "criar" || escolha === "criar_distinta") {
      if (item.chave === "ecosol")
        falhar("Ecosol não é uma usina. Confira a usina real dessas UCs.", 409);
      if (item.usina_id_sugerida || item.ambigua)
        falhar(
          `A usina ${item.nome} já existe ou tem cadastro ambíguo. Selecione o registro correto.`,
          409,
        );
      if (item.semelhante_gdii && escolha !== "criar_distinta")
        falhar(
          `O nome ${item.nome} se parece com uma usina GDII. Confirme que é uma usina distinta antes de cadastrá-la.`,
          409,
        );
      mapa.set(item.chave, {
        tipo: "criar",
        nome: item.nome,
        modalidade: item.modalidade_sugerida,
      });
      continue;
    }
    const id = Number(escolha);
    const usina =
      Number.isSafeInteger(id) && id > 0
        ? banco.prepare("SELECT id,nome,versao FROM usinas WHERE id=?").get(id)
        : null;
    if (!usina) falhar(`Escolha uma usina válida para ${item.nome}.`);
    if (chaveUsina(usina.nome) === "ecosol")
      falhar("Ecosol não é uma usina. Confira a usina real dessas UCs.", 409);
    mapa.set(item.chave, {
      tipo: "existente",
      id,
      nome: usina.nome,
      versao: usina.versao,
      modalidade:
        modalidadeVigenteDaUsina(banco, id, inicio)?.modalidade ?? null,
    });
  }
  const ucs = banco
    .prepare(
      `SELECT u.id,u.uc,u.uc_antiga,u.usina_id,u.versao,
      COALESCE(c.name,p.nome,u.nome) AS cliente_nome
     FROM faturamento_unidades u
     LEFT JOIN customers c ON c.id=u.cliente_id
     LEFT JOIN faturamento_clientes_provisorios p ON p.id=u.cliente_provisorio_id`,
    )
    .all();
  const porUc = new Map(ucs.map((u) => [u.uc, u]));
  const porAntiga = new Map();
  for (const u of ucs)
    if (u.uc_antiga) {
      if (!porAntiga.has(u.uc_antiga)) porAntiga.set(u.uc_antiga, []);
      porAntiga.get(u.uc_antiga).push(u);
    }
  const resultados = linhas.map((linha) => {
    const base = {
      linha: linha.linha,
      uc: linha.uc,
      uc_antiga: linha.uc_antiga,
      usina: linha.usina,
      cliente: linha.cliente,
      acao: "pendente",
      motivo: "",
      versao: null,
      unidade_id: null,
      destino: null,
    };
    if (linha.erro) return { ...base, acao: "erro", motivo: linha.erro };
    const destino = mapa.get(chaveUsina(linha.usina));
    if (!destino || destino.tipo === "ignorar")
      return { ...base, motivo: "Usina não selecionada para importação." };
    base.destino = destino;
    const unidade = porUc.get(linha.uc);
    if (!unidade && porAntiga.has(linha.uc))
      return {
        ...base,
        acao: "conferencia",
        motivo:
          "A UC atual aparece como UC antiga de outro cadastro. Confira a numeração.",
      };
    if (!unidade && linha.uc_antiga && porUc.has(linha.uc_antiga))
      return {
        ...base,
        acao: "conferencia",
        motivo:
          "A UC antiga já está cadastrada como UC atual. Confira a renumeração antes de criar outro cadastro.",
      };
    if (
      linha.uc_antiga &&
      porUc.has(linha.uc_antiga) &&
      porUc.get(linha.uc_antiga)?.id !== unidade?.id
    )
      return {
        ...base,
        acao: "conferencia",
        motivo: "A UC antiga é a UC atual de outro cadastro.",
      };
    if (
      linha.uc_antiga &&
      porAntiga.get(linha.uc_antiga)?.some((item) => item.id !== unidade?.id)
    )
      return {
        ...base,
        acao: "conferencia",
        motivo: "A UC antiga já pertence a outro cadastro.",
      };
    if (!unidade) {
      if (!linha.cliente)
        return {
          ...base,
          motivo:
            "Nome do cliente ausente; não é possível criar a UC provisória.",
        };
      return {
        ...base,
        acao: "criar_uc",
        motivo: "Novo cadastro provisório, sem acesso ao portal nem cálculo.",
      };
    }
    base.versao = unidade.versao;
    base.unidade_id = unidade.id;
    if (
      !linha.cliente ||
      chaveUsina(linha.cliente) !== chaveUsina(unidade.cliente_nome)
    )
      return {
        ...base,
        acao: "conferencia",
        motivo: `Cliente da planilha não corresponde ao cadastro (${unidade.cliente_nome}). Confira a identidade.`,
      };
    if (
      linha.uc_antiga &&
      unidade.uc_antiga &&
      unidade.uc_antiga !== linha.uc_antiga
    )
      return {
        ...base,
        acao: "conferencia",
        motivo: "UC antiga difere do cadastro existente.",
      };
    if (destino.tipo === "existente" && unidade.usina_id === destino.id)
      return linha.uc_antiga && !unidade.uc_antiga
        ? {
            ...base,
            acao: "atualizar_uc_antiga",
            motivo: "Vínculo correto; a UC antiga será registrada.",
          }
        : {
            ...base,
            acao: "inalterada",
            motivo: "UC já está vinculada a esta usina.",
          };
    if (unidade.usina_id !== null)
      return {
        ...base,
        acao: "conferencia",
        motivo:
          chaveUsina(
            banco
              .prepare("SELECT nome FROM usinas WHERE id=?")
              .get(unidade.usina_id)?.nome,
          ) === "ecosol"
            ? "Vínculo provisório ‘ecosol’: identificar a usina real antes de transferir esta UC."
            : "UC vinculada a outra usina. Não será transferida automaticamente.",
      };
    return {
      ...base,
      acao: "vincular",
      motivo: "UC existente sem usina; vínculo será criado.",
    };
  });
  return {
    linhas: resultados,
    resumo: {
      vincular: resultados.filter((r) => r.acao === "vincular").length,
      criar_uc: resultados.filter((r) => r.acao === "criar_uc").length,
      atualizar_uc_antiga: resultados.filter(
        (r) => r.acao === "atualizar_uc_antiga",
      ).length,
      inalteradas: resultados.filter((r) => r.acao === "inalterada").length,
      conferencia: resultados.filter((r) => r.acao === "conferencia").length,
      pendentes: resultados.filter((r) => ["erro", "pendente"].includes(r.acao))
        .length,
    },
    escolhas,
  };
}

rotasVinculosUsinas.post("/:id/previa", (req, res) => {
  const banco = obterBanco();
  const s = sessao(req, banco);
  if (s.status !== "Pendente") falhar("Esta análise já foi concluída.", 409);
  const previa = prepararPrevia(s, req.body?.escolhas, banco);
  const token = randomUUID();
  banco
    .prepare(
      "UPDATE usinas_importacoes_vinculos SET previa=?,previa_id=? WHERE id=?",
    )
    .run(JSON.stringify(previa), token, s.id);
  res.set("Cache-Control", "no-store").json({ ...previa, previa_id: token });
});

rotasVinculosUsinas.post("/:id/confirmar", (req, res) => {
  const banco = obterBanco();
  banco.exec("BEGIN IMMEDIATE");
  try {
    const s = sessao(req, banco);
    if (s.status === "Concluída") {
      banco.exec("COMMIT");
      return res.json({ quantidade: s.quantidade, ja_concluida: true });
    }
    if (
      !s.previa ||
      s.previa_id !== req.body?.previa_id ||
      req.body?.confirmado !== true
    )
      falhar("Gere e confirme uma prévia atual antes de importar.", 409);
    const salva = JSON.parse(s.previa);
    const atual = prepararPrevia(s, salva.escolhas, banco);
    if (JSON.stringify(atual.linhas) !== JSON.stringify(salva.linhas))
      falhar("Cadastros mudaram desde a prévia. Gere outra prévia.", 409);
    const ativas = atual.linhas.filter((l) =>
      ["vincular", "criar_uc", "atualizar_uc_antiga"].includes(l.acao),
    );
    if (!ativas.length)
      falhar("Não há UCs novas ou vínculos válidos para importar.");
    const novas = new Map();
    for (const linha of ativas) {
      const d = linha.destino;
      if (d.tipo !== "criar" || novas.has(chaveUsina(d.nome))) continue;
      const chave = chaveUsina(d.nome);
      if (
        banco
          .prepare("SELECT nome FROM usinas")
          .all()
          .some((u) => chaveUsina(u.nome) === chave)
      )
        falhar(
          `A usina ${d.nome} foi cadastrada após a prévia. Gere outra prévia.`,
          409,
        );
      const id = Number(
        banco
          .prepare("INSERT INTO usinas(nome,localizacao) VALUES(?,?)")
          .run(d.nome, "A confirmar").lastInsertRowid,
      );
      banco
        .prepare(
          "INSERT INTO usinas_modalidades(usina_id,inicio,modalidade) VALUES(?,?,?)",
        )
        .run(id, inicio, d.modalidade);
      novas.set(chave, id);
      banco
        .prepare(
          "INSERT INTO faturamento_historico(responsavel,administrador_id,acao,dados) VALUES(?,?,?,?)",
        )
        .run(
          req.administrador.nome,
          req.administrador.id,
          "Usina criada por importação de vínculos",
          JSON.stringify({
            usina_id: id,
            nome: d.nome,
            modalidade: d.modalidade,
            inicio,
            arquivo_hash: s.hash,
          }),
        );
    }
    for (const linha of ativas) {
      const d = linha.destino;
      const usinaId = d.tipo === "criar" ? novas.get(chaveUsina(d.nome)) : d.id;
      if (
        !usinaId ||
        !banco.prepare("SELECT id FROM usinas WHERE id=?").get(usinaId)
      )
        falhar("Usina não encontrada. Gere outra prévia.", 409);
      if (!modalidadeVigenteDaUsina(banco, usinaId, inicio))
        falhar(
          "A usina não tem modalidade vigente em outubro/2026. Configure-a antes de importar.",
          409,
        );
      let unidadeId;
      if (linha.acao === "atualizar_uc_antiga") {
        const r = banco
          .prepare(
            "UPDATE faturamento_unidades SET uc_antiga=?,versao=versao+1 WHERE id=? AND usina_id=? AND uc_antiga IS NULL AND versao=?",
          )
          .run(linha.uc_antiga, linha.unidade_id, usinaId, linha.versao);
        if (r.changes !== 1)
          falhar("UC alterada durante a confirmação. Gere outra prévia.", 409);
        unidadeId = linha.unidade_id;
      } else if (linha.acao === "vincular") {
        conferirVinculoComAprovadas(banco, linha.unidade_id, usinaId);
        const r = banco
          .prepare(
            "UPDATE faturamento_unidades SET usina_id=?,uc_antiga=COALESCE(uc_antiga,?),versao=versao+1 WHERE id=? AND usina_id IS NULL AND versao=?",
          )
          .run(
            usinaId,
            linha.uc_antiga || null,
            linha.unidade_id,
            linha.versao,
          );
        if (r.changes !== 1)
          falhar("UC alterada durante a confirmação. Gere outra prévia.", 409);
        unidadeId = linha.unidade_id;
      } else {
        if (
          banco
            .prepare("SELECT 1 FROM faturamento_unidades WHERE uc=?")
            .get(linha.uc)
        )
          falhar("Uma UC foi criada após a prévia. Gere outra prévia.", 409);
        const chaveOrigem = `planilha-usina:${linha.uc}`;
        let provisoria = banco
          .prepare(
            "SELECT id FROM faturamento_clientes_provisorios WHERE chave_origem=?",
          )
          .get(chaveOrigem);
        if (!provisoria) {
          const id = Number(
            banco
              .prepare(
                "INSERT INTO faturamento_clientes_provisorios(nome,chave_origem,origem) VALUES(?,?,?)",
              )
              .run(linha.cliente, chaveOrigem, "Importação de UC por usina")
              .lastInsertRowid,
          );
          provisoria = { id };
        }
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
              provisoria.id,
            ).lastInsertRowid,
        );
      }
      banco
        .prepare(
          "INSERT INTO faturamento_historico(unidade_id,responsavel,administrador_id,acao,dados) VALUES(?,?,?,?,?)",
        )
        .run(
          unidadeId,
          req.administrador.nome,
          req.administrador.id,
          linha.acao === "vincular"
            ? "UC vinculada à usina por planilha"
            : linha.acao === "atualizar_uc_antiga"
              ? "UC antiga registrada por planilha"
              : "UC provisória criada por planilha de usinas",
          JSON.stringify({
            importacao_id: s.id,
            hash: s.hash,
            aba: s.aba,
            linha: linha.linha,
            uc: linha.uc,
            uc_antiga: linha.uc_antiga,
            usina_id: usinaId,
          }),
        );
    }
    banco
      .prepare(
        "UPDATE usinas_importacoes_vinculos SET status='Concluída',quantidade=?,linhas='[]',previa=NULL WHERE id=?",
      )
      .run(ativas.length, s.id);
    banco.exec("COMMIT");
    res
      .set("Cache-Control", "no-store")
      .json({ quantidade: ativas.length, usinas_criadas: novas.size });
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
});
