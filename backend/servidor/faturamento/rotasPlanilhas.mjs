import express, { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { obterBanco } from "../bancoDeDados.mjs";
import { exigirNivel } from "../permissoesDaEquipe.mjs";
import { falhar, texto } from "./regras.mjs";
import { chaveUsina } from "./vinculosUsinas.mjs";
import { listarPlanilhas, lerPlanilhaLocal } from "./catalogoPlanilhas.mjs";
import {
  camposImportacao,
  lerExcel,
  resumirAbas,
  prepararImportacao,
  criarModelo,
  exportarCalculos,
  analisarEstruturaMensal,
} from "./planilhas.mjs";

export const rotasPlanilhas = Router();
rotasPlanilhas.get("/pasta", exigirNivel(2), async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store").json(await listarPlanilhas());
  } catch {
    falhar(
      "Não foi possível acessar a pasta de planilhas no computador do servidor. Confira a configuração ECOSOL_PLANILHAS_DIR.",
    );
  }
});
rotasPlanilhas.post("/consultar-local", exigirNivel(2), async (req, res) => {
  try {
    const fonte = await lerPlanilhaLocal(req.body.arquivo);
    const abas = await lerExcel(fonte.buffer);
    res.set("Cache-Control", "no-store").json({
      arquivo: fonte.arquivo,
      usina: fonte.usina,
      hash: fonte.hash,
      abas: resumirAbas(abas),
      estrutura: analisarEstruturaMensal(abas),
    });
  } catch (e) {
    falhar("Não foi possível consultar a planilha. " + e.message);
  }
});
rotasPlanilhas.get("/pasta/diagnostico", exigirNivel(2), async (_req, res) => {
  try {
    const arquivos = await listarPlanilhas();
    const itens = [];
    const ocorrencias = new Map();
    for (const item of arquivos) {
      try {
        const fonte = await lerPlanilhaLocal(item.arquivo);
        const estrutura = analisarEstruturaMensal(await lerExcel(fonte.buffer));
        const resumo = {
          arquivo: item.arquivo,
          usina: item.usina,
          ...estrutura,
        };
        itens.push(resumo);
        for (const uc of estrutura.ucs ?? []) {
          if (!ocorrencias.has(uc)) ocorrencias.set(uc, []);
          ocorrencias.get(uc).push(item.usina);
        }
      } catch (e) {
        itens.push({
          arquivo: item.arquivo,
          usina: item.usina,
          compativel: false,
          motivo: "Não foi possível ler esta planilha.",
          problemas: [e.message],
          ucs: [],
        });
      }
    }
    const duplicadas = [...ocorrencias.entries()]
      .filter(([, usinas]) => new Set(usinas).size > 1)
      .map(([uc, usinas]) => ({ uc, usinas: [...new Set(usinas)] }));
    res.set("Cache-Control", "no-store").json({
      total: itens.length,
      prontas: itens.filter((i) => i.compativel).length,
      problemas: itens.filter((i) => !i.compativel).length,
      duplicadas,
      itens: itens.map(({ ucs: _ucs, ...item }) => item),
    });
  } catch (e) {
    falhar("Não foi possível validar a pasta de planilhas. " + e.message);
  }
});
const mime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function baixar(res, nome, buffer) {
  res
    .set({
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    })
    .send(buffer);
}
function usina(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1)
    falhar("Selecione a usina desta planilha.");
  const u = obterBanco().prepare("SELECT * FROM usinas WHERE id=?").get(numero);
  if (!u) falhar("Usina não encontrada.");
  if (chaveUsina(u.nome) === "ecosol")
    falhar(
      "Ecosol é um vínculo provisório. Identifique a usina real antes de importar planilhas.",
      409,
    );
  return u;
}
function sessao(req) {
  const s = obterBanco()
    .prepare("SELECT * FROM faturamento_importacoes WHERE id=?")
    .get(String(req.params.id));
  if (!s || s.responsavel_id !== req.administrador.id)
    falhar("Importação não encontrada para este acesso.", 404);
  if (s.status !== "Concluída" && s.expira_em < Date.now())
    falhar("A prévia expirou. Envie a planilha novamente.", 410);
  return s;
}

rotasPlanilhas.get("/modelo", (_req, res, next) => {
  criarModelo()
    .then((b) => baixar(res, "modelo-cadastros-ecosol.xlsx", b))
    .catch(next);
});
rotasPlanilhas.get("/calculos", async (req, res) => {
  const usinaId = req.query.usina_id ? usina(req.query.usina_id).id : null;
  const todos = obterBanco()
    .prepare(
      "SELECT id,lote,status,memoria FROM faturamento_documentos WHERE classificacao='fatura' AND memoria IS NOT NULL ORDER BY competencia,id",
    )
    .all();
  const filtrados =
    usinaId === null
      ? todos
      : todos.filter((r) => JSON.parse(r.memoria).unidade.usina_id === usinaId);
  baixar(res, "conferencia-ecosol.xlsx", await exportarCalculos(filtrados));
});
function guardarAnalise(req, u, nome, buffer, abas) {
  const banco = obterBanco(),
    numero = randomUUID();
  banco
    .prepare(
      "UPDATE faturamento_importacoes SET abas='[]',previa=NULL,status='Expirada' WHERE status='Pendente' AND expira_em<?",
    )
    .run(Date.now());
  banco
    .prepare(
      "INSERT INTO faturamento_importacoes(id,responsavel_id,nome,hash,usina_id,abas,expira_em) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      numero,
      req.administrador.id,
      nome,
      createHash("sha256").update(buffer).digest("hex"),
      u.id,
      JSON.stringify(abas),
      Date.now() + 3600000,
    );
  return {
    id: numero,
    nome,
    usina: u.nome,
    abas: resumirAbas(abas),
    campos: camposImportacao,
    estrutura: analisarEstruturaMensal(abas),
  };
}
rotasPlanilhas.post("/analisar-local", exigirNivel(2), async (req, res) => {
  const u = usina(req.body.usina_id);
  let fonte, abas;
  try {
    fonte = await lerPlanilhaLocal(req.body.arquivo);
    abas = await lerExcel(fonte.buffer);
  } catch (e) {
    falhar("Não foi possível analisar a planilha. " + e.message);
  }
  res
    .status(201)
    .json(guardarAnalise(req, u, fonte.arquivo, fonte.buffer, abas));
});
rotasPlanilhas.post(
  "/analisar",
  exigirNivel(2),
  express.raw({ type: mime, limit: "5mb" }),
  async (req, res) => {
    const u = usina(req.query.usina_id),
      nome = texto(req.query.nome, "o nome do arquivo", 200);
    if (
      !/\.xlsx$/i.test(nome) ||
      !Buffer.isBuffer(req.body) ||
      req.body.length < 4 ||
      req.body.subarray(0, 2).toString() !== "PK"
    )
      falhar("Envie um arquivo .xlsx com até 5 MB.");
    let abas;
    try {
      abas = await lerExcel(req.body);
    } catch (e) {
      falhar("Não foi possível analisar o Excel. " + e.message);
    }
    if (!abas.length) falhar("A planilha não possui abas.");
    res.status(201).json(guardarAnalise(req, u, nome, req.body, abas));
  },
);
rotasPlanilhas.post("/:id/previa", exigirNivel(2), (req, res) => {
  const s = sessao(req);
  if (s.status !== "Pendente") falhar("Esta importação já foi concluída.", 409);
  const previa = prepararImportacao(
    JSON.parse(s.abas),
    { ...req.body, usina_id: s.usina_id },
    obterBanco(),
  );
  const token = randomUUID();
  obterBanco()
    .prepare(
      "UPDATE faturamento_importacoes SET previa=?,previa_id=? WHERE id=?",
    )
    .run(JSON.stringify(previa), token, s.id);
  res.json({ ...previa, previa_id: token });
});
rotasPlanilhas.post("/:id/confirmar", exigirNivel(2), (req, res) => {
  const banco = obterBanco();
  banco.exec("BEGIN IMMEDIATE");
  try {
    const s = sessao(req);
    if (s.status === "Concluída") {
      banco.exec("COMMIT");
      return res.json({ quantidade: s.quantidade, ja_concluida: true });
    }
    if (
      !s.previa ||
      s.previa_id !== req.body.previa_id ||
      req.body.confirmado !== true
    )
      falhar("Gere e confirme a prévia atual antes de importar.", 409);
    usina(s.usina_id);
    const previa = JSON.parse(s.previa),
      validas = previa.linhas.filter((l) => l.status === "Válida");
    if (!validas.length)
      falhar("Não há novos cadastros válidos para importar.");
    for (const l of validas) {
      const u = l.unidade,
        c = l.contrato;
      const modalidadeUsina = banco
        .prepare(
          "SELECT modalidade FROM usinas_modalidades WHERE usina_id=? AND inicio<=? ORDER BY inicio DESC LIMIT 1",
        )
        .get(u.usina_id, c.inicio)?.modalidade;
      const primeiraVigencia = banco
        .prepare(
          "SELECT MIN(inicio) AS inicio FROM usinas_modalidades WHERE usina_id=?",
        )
        .get(u.usina_id)?.inicio;
      if (
        (modalidadeUsina && c.modalidade !== modalidadeUsina) ||
        (!modalidadeUsina &&
          (!primeiraVigencia || c.inicio >= primeiraVigencia))
      )
        falhar(
          "A modalidade da usina mudou desde a prévia. Gere uma nova prévia antes de importar.",
          409,
        );
      if (
        banco
          .prepare("SELECT id FROM faturamento_unidades WHERE uc=?")
          .get(u.uc)
      )
        falhar(
          "Uma UC foi cadastrada após a prévia. Gere uma nova prévia antes de importar.",
          409,
        );
      const numero = Number(
        banco
          .prepare(
            "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento,usina_id) VALUES(?,?,?,?,?,?)",
          )
          .run(u.uc, u.nome, u.documento, u.email, u.dia_vencimento, u.usina_id)
          .lastInsertRowid,
      );
      banco
        .prepare(
          "INSERT INTO faturamento_contratos(unidade_id,modalidade,desconto,inicio) VALUES(?,?,?,?)",
        )
        .run(numero, c.modalidade, c.desconto, c.inicio);
      banco
        .prepare(
          "INSERT INTO faturamento_historico(unidade_id,responsavel,administrador_id,acao,dados) VALUES(?,?,?,?,?)",
        )
        .run(
          numero,
          req.administrador.nome,
          req.administrador.id,
          "Importação Excel por usina",
          JSON.stringify({
            importacao_id: s.id,
            arquivo: s.nome,
            hash: s.hash,
            linha: l.linha,
            aba: previa.aba,
            cabecalho: previa.cabecalho,
            complementos_no_sistema: l.complementos ?? {},
            unidade: u,
            contrato: c,
          }),
        );
    }
    banco
      .prepare(
        "UPDATE faturamento_importacoes SET status='Concluída',quantidade=?,abas='[]',previa=NULL WHERE id=?",
      )
      .run(validas.length, s.id);
    banco.exec("COMMIT");
    res.json({ quantidade: validas.length });
  } catch (e) {
    banco.exec("ROLLBACK");
    throw e;
  }
});
