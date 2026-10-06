import express, { Router } from "express";
import { obterBanco } from "../bancoDeDados.mjs";
import { exigirNivel } from "../permissoesDaEquipe.mjs";
import { receberPdf } from "./receberPdf.mjs";
import { registrarHistorico } from "./registros.mjs";
import { rotasPlanilhas } from "./rotasPlanilhas.mjs";
import {
  calcularCobranca,
  competencia,
  dataValida,
  falhar,
  normalizarUc,
  texto,
  validarContrato,
  validarUnidade,
} from "./regras.mjs";

export const rotasFaturamento = Router();
const router = Router();
rotasFaturamento.use("/api/admin/faturamento", exigirNivel(1), router);
const APROVADA = "Aprovada — aguardando emissão";
const colunas =
  "id, hash, nome, lote, extracao, dados, memoria, unidade_id, competencia, status, classificacao, versao, criado_em, atualizado_em";

function id(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1)
    falhar("Identificador inválido.");
  return numero;
}
function documento(numero) {
  const d = obterBanco()
    .prepare(
      `SELECT ${colunas} FROM faturamento_documentos WHERE id=? AND classificacao='fatura'`,
    )
    .get(id(numero));
  if (!d) falhar("Fatura não encontrada.", 404);
  return {
    ...d,
    dados: JSON.parse(d.dados),
    extracao: JSON.parse(d.extracao),
    memoria: d.memoria ? JSON.parse(d.memoria) : null,
  };
}
function documentoCompleto(numero) {
  const d = documento(numero);
  const banco = obterBanco();
  return {
    ...d,
    texto: banco
      .prepare("SELECT texto FROM faturamento_documentos WHERE id=?")
      .get(d.id).texto,
    historico: banco
      .prepare(
        "SELECT acao,responsavel,criado_em FROM faturamento_historico WHERE documento_id=? ORDER BY id DESC",
      )
      .all(d.id),
  };
}
function conferirVersao(d, body) {
  if (d.versao !== Number(body.versao))
    falhar(
      "Este registro foi alterado. Abra-o novamente antes de continuar.",
      409,
    );
  if (d.status === APROVADA)
    falhar(
      "Cobrança aprovada: o histórico está protegido contra alterações.",
      409,
    );
}
function historico(req, acao, dados, documentoId = null, unidadeId = null) {
  registrarHistorico({
    responsavel: req.administrador.nome,
    administradorId: req.administrador.id,
    acao,
    dados,
    documentoId,
    unidadeId,
  });
}
function transacao(fn) {
  const banco = obterBanco();
  banco.exec("BEGIN IMMEDIATE");
  try {
    const resultado = fn();
    banco.exec("COMMIT");
    return resultado;
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}
function listarUnidades() {
  const banco = obterBanco();
  return banco
    .prepare(
      "SELECT u.*, s.nome AS usina_nome FROM faturamento_unidades u LEFT JOIN usinas s ON s.id=u.usina_id ORDER BY u.nome, u.uc",
    )
    .all()
    .map((u) => ({
      ...u,
      contratos: banco
        .prepare(
          "SELECT * FROM faturamento_contratos WHERE unidade_id=? ORDER BY inicio DESC",
        )
        .all(u.id),
    }));
}

router.get("/unidades", (_req, res) => res.json(listarUnidades()));
function conferirUsina(numero) {
  if (
    numero !== null &&
    !obterBanco().prepare("SELECT id FROM usinas WHERE id=?").get(numero)
  )
    falhar("Usina não encontrada.");
}
router.post("/usinas", exigirNivel(3), (req, res) => {
  const nome = texto(req.body.nome, "o nome da usina", 120),
    localizacao = texto(req.body.localizacao, "a localização", 160);
  const numero = transacao(() => {
    const banco = obterBanco();
    if (
      banco
        .prepare(
          "SELECT id FROM usinas WHERE lower(nome)=lower(?) AND lower(localizacao)=lower(?)",
        )
        .get(nome, localizacao)
    )
      falhar("Esta usina já está cadastrada.", 409);
    const numero = Number(
      banco
        .prepare(
          "INSERT INTO usinas(nome,localizacao,status) VALUES(?,?,'Cadastro inicial')",
        )
        .run(nome, localizacao).lastInsertRowid,
    );
    historico(req, "Cadastro de usina", { id: numero, nome, localizacao });
    return numero;
  });
  res.status(201).json({ id: numero });
});
router.post("/unidades", exigirNivel(2), (req, res) => {
  const u = validarUnidade(req.body),
    c = validarContrato(req.body);
  const numero = transacao(() => {
    const banco = obterBanco();
    conferirUsina(u.usina_id);
    const numero = Number(
      banco
        .prepare(
          "INSERT INTO faturamento_unidades (uc,nome,documento,email,dia_vencimento,usina_id) VALUES (?,?,?,?,?,?)",
        )
        .run(u.uc, u.nome, u.documento, u.email, u.dia_vencimento, u.usina_id)
        .lastInsertRowid,
    );
    banco
      .prepare(
        "INSERT INTO faturamento_contratos (unidade_id,modalidade,desconto,inicio) VALUES (?,?,?,?)",
      )
      .run(numero, c.modalidade, c.desconto, c.inicio);
    historico(
      req,
      "Cadastro de unidade e contrato",
      { unidade: u, contrato: c },
      null,
      numero,
    );
    return numero;
  });
  res.status(201).json({ id: numero });
});
router.patch("/unidades/:id", exigirNivel(2), (req, res) => {
  const numero = id(req.params.id),
    u = validarUnidade(req.body);
  transacao(() => {
    const banco = obterBanco();
    conferirUsina(u.usina_id);
    const anterior = banco
      .prepare("SELECT * FROM faturamento_unidades WHERE id=?")
      .get(numero);
    if (!anterior) falhar("Unidade não encontrada.", 404);
    if (anterior.versao !== Number(req.body.versao))
      falhar("Cadastro alterado. Atualize a lista.", 409);
    if (anterior.uc !== u.uc)
      falhar("O número da UC não pode ser alterado. Cadastre outra unidade.");
    banco
      .prepare(
        "UPDATE faturamento_unidades SET nome=?,documento=?,email=?,dia_vencimento=?,usina_id=?,versao=versao+1 WHERE id=?",
      )
      .run(u.nome, u.documento, u.email, u.dia_vencimento, u.usina_id, numero);
    historico(
      req,
      "Atualização cadastral",
      { anterior, novo: u },
      null,
      numero,
    );
  });
  res.json({ sucesso: true });
});
router.post("/unidades/:id/contratos", exigirNivel(3), (req, res) => {
  const numero = id(req.params.id),
    c = validarContrato(req.body);
  transacao(() => {
    const banco = obterBanco();
    if (
      !banco
        .prepare("SELECT id FROM faturamento_unidades WHERE id=?")
        .get(numero)
    )
      falhar("Unidade não encontrada.", 404);
    if (
      banco
        .prepare(
          "SELECT id FROM faturamento_documentos WHERE unidade_id=? AND competencia>=? AND status=?",
        )
        .get(numero, c.inicio, APROVADA)
    )
      falhar(
        "A vigência alcança uma cobrança aprovada. Use uma competência posterior.",
        409,
      );
    banco
      .prepare(
        "INSERT INTO faturamento_contratos (unidade_id,modalidade,desconto,inicio) VALUES (?,?,?,?)",
      )
      .run(numero, c.modalidade, c.desconto, c.inicio);
    historico(req, "Nova vigência contratual", c, null, numero);
  });
  res.status(201).json({ sucesso: true });
});

router.get("/documentos", (_req, res) => {
  res.json(
    obterBanco()
      .prepare(
        "SELECT id FROM faturamento_documentos WHERE classificacao='fatura' ORDER BY id DESC",
      )
      .all()
      .map((r) => documento(r.id)),
  );
});
router.get("/recebimentos", (_req, res) => {
  res.json(
    obterBanco()
      .prepare(
        `SELECT r.*,d.status AS estado_documento,d.dados,d.memoria
         FROM faturamento_recebimentos_pdf r
         LEFT JOIN faturamento_documentos d ON d.id=r.documento_id
         WHERE r.documento_id IS NULL OR d.classificacao='fatura'
         ORDER BY r.id DESC`,
      )
      .all()
      .map((r) => ({
        ...r,
        dados: r.dados ? JSON.parse(r.dados) : null,
        memoria: r.memoria ? JSON.parse(r.memoria) : null,
      })),
  );
});
router.get("/documentos/:id", (req, res) => {
  res.json(documentoCompleto(req.params.id));
});
router.get("/documentos/:id/pdf", (req, res) => {
  const d = documento(req.params.id);
  const arquivo = obterBanco()
    .prepare("SELECT pdf FROM faturamento_documentos WHERE id=?")
    .get(d.id);
  res
    .set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="fatura-${d.id}.pdf"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    })
    .send(Buffer.from(arquivo.pdf));
});

router.post(
  "/documentos",
  exigirNivel(2),
  express.raw({ type: "application/pdf", limit: "10mb" }),
  async (req, res) => {
    const resultado = await receberPdf({
      arquivo: req.body,
      nome: req.query.nome,
      lote: req.query.lote,
      ator: req.administrador,
      origem: "manual",
    });
    if (resultado.tipo === "duplicado")
      falhar("Este PDF já foi importado. Consulte a lista de faturas.", 409);
    res.status(201).json(documento(resultado.documentoId));
  },
);

const campos = [
  "uc",
  "competencia",
  "injecao",
  "unitario",
  "bandeira",
  "total_equatorial",
  "ajuste_gdii",
  "vencimento_equatorial",
  "vencimento_ecosol",
  "origem_tarifa",
  "referencia_id",
];
router.patch("/documentos/:id", exigirNivel(2), (req, res) => {
  const numero = id(req.params.id);
  transacao(() => {
    const d = documento(numero);
    conferirVersao(d, req.body);
    const dados = {};
    for (const campo of campos) {
      dados[campo] = String(req.body.dados?.[campo] ?? "").trim();
      if (dados[campo].length > 80) falhar("Campo acima do limite permitido.");
    }
    obterBanco()
      .prepare(
        "UPDATE faturamento_documentos SET dados=?,memoria=NULL,unidade_id=NULL,competencia=NULL,status='Pendente de revisão',versao=versao+1,atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(JSON.stringify(dados), numero);
    historico(
      req,
      "Conferência salva",
      { anterior: d.dados, novo: dados },
      numero,
    );
  });
  res.json(documentoCompleto(numero));
});

function montarCalculo(d) {
  const banco = obterBanco(),
    dados = d.dados;
  const uc = normalizarUc(dados.uc),
    mes = competencia(dados.competencia);
  const unidade = banco
    .prepare(
      "SELECT u.*, s.nome AS usina_nome FROM faturamento_unidades u LEFT JOIN usinas s ON s.id=u.usina_id WHERE u.uc=?",
    )
    .get(uc);
  if (!unidade)
    falhar("Cadastre esta unidade em Clientes → Unidades e contratos.");
  const contrato = banco
    .prepare(
      "SELECT * FROM faturamento_contratos WHERE unidade_id=? AND inicio<=? ORDER BY inicio DESC LIMIT 1",
    )
    .get(unidade.id, mes);
  if (!contrato) falhar("Não há contrato vigente para esta competência.");
  const vencimento_equatorial = dataValida(dados.vencimento_equatorial);
  const vencimento_ecosol = dataValida(dados.vencimento_ecosol);
  if (vencimento_ecosol.slice(0, 7) < mes)
    falhar("O vencimento Ecosol não pode anteceder a competência.");
  let unitario = dados.unitario,
    bandeira = dados.bandeira,
    fonte = { tipo: "propria", documento_id: d.id };
  if (dados.origem_tarifa === "referencia") {
    const referencia = documento(dados.referencia_id);
    if (
      referencia.id === d.id ||
      referencia.lote !== d.lote ||
      referencia.status !== APROVADA ||
      referencia.memoria?.contrato.modalidade !== "GDI"
    )
      falhar("Selecione uma GDI aprovada do mesmo lote como referência.");
    unitario = referencia.memoria.entradas.unitario;
    bandeira = referencia.memoria.entradas.bandeira;
    fonte = {
      tipo: "referencia",
      documento_id: referencia.id,
      lote: referencia.lote,
      versao: referencia.versao,
    };
  } else if (dados.origem_tarifa !== "propria")
    falhar("Selecione a origem da tarifa.");
  const resultado = calcularCobranca({
    ...dados,
    unitario,
    bandeira,
    desconto: contrato.desconto,
    modalidade: contrato.modalidade,
  });
  return {
    ...resultado,
    unidade,
    contrato,
    competencia: mes,
    vencimento_equatorial,
    vencimento_ecosol,
    fonte,
  };
}

router.post("/documentos/:id/calcular", exigirNivel(2), (req, res) => {
  const numero = id(req.params.id);
  transacao(() => {
    const d = documento(numero);
    conferirVersao(d, req.body);
    if (req.body.conferido !== true)
      falhar("Confirme a conferência dos dados com o PDF.");
    const memoria = montarCalculo(d);
    obterBanco()
      .prepare(
        "UPDATE faturamento_documentos SET memoria=?,unidade_id=?,competencia=?,status='Calculada',versao=versao+1,atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(
        JSON.stringify(memoria),
        memoria.unidade.id,
        memoria.competencia,
        numero,
      );
    historico(req, "Cálculo conferido", memoria, numero, memoria.unidade.id);
  });
  res.json(documentoCompleto(numero));
});

router.post("/documentos/:id/aprovar", exigirNivel(3), (req, res) => {
  const numero = id(req.params.id);
  transacao(() => {
    const d = documento(numero);
    conferirVersao(d, req.body);
    if (d.status !== "Calculada" || !d.memoria)
      falhar("Calcule e confira a cobrança antes de aprovar.");
    const atual = montarCalculo(d);
    if (JSON.stringify(atual) !== JSON.stringify(d.memoria))
      falhar(
        "Cadastro ou contrato alterado. Calcule novamente antes de aprovar.",
        409,
      );
    obterBanco()
      .prepare(
        "UPDATE faturamento_documentos SET status=?,versao=versao+1,atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(APROVADA, numero);
    historico(
      req,
      "Aprovação interna — sem emissão",
      d.memoria,
      numero,
      d.unidade_id,
    );
  });
  res.json(documentoCompleto(numero));
});

router.use("/planilhas", rotasPlanilhas);
router.use((erro, _req, res, _next) => {
  if (/UNIQUE constraint failed/.test(erro.message))
    return res.status(409).json({
      erro: "Registro duplicado: verifique o PDF, a UC, a vigência ou a cobrança da mesma unidade e competência.",
    });
  if (erro.type === "entity.too.large")
    return res.status(413).json({
      erro: "O arquivo excede o tamanho permitido (PDF: 10 MB; Excel: 5 MB).",
    });
  if (erro.status && erro.status < 500)
    return res.status(erro.status).json({ erro: erro.message });
  console.error(
    "Falha no módulo de faturamento:",
    erro.name,
    erro.code ?? "interno",
  );
  res
    .status(500)
    .json({ erro: "Não foi possível concluir a operação de faturamento." });
});
