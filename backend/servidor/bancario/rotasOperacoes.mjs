import { Router } from "express";
import { createHash } from "node:crypto";
import {
  confirmarIdentidadeBancaria,
  exigirConfirmacaoBancaria,
  origemConfiavel,
} from "./confirmacaoSensivel.mjs";
import {
  concluirRecuperacaoCredencial,
  estadoCredencialConfirmacao,
  salvarCredencialConfirmacao,
  solicitarRecuperacaoCredencial,
} from "./credencialConfirmacao.mjs";
import {
  exigirPapelBancario,
  exigirUmDosPapeisBancarios,
  temPapelBancario,
  temPapelCritico,
} from "./permissoes.mjs";
import {
  aprovarOperacao,
  criarOperacaoDeCobranca,
  enfileirarOperacao,
  liberarNovaEmissaoAposFalha,
  listarOperacoes,
  obterOperacao,
} from "./operacoes.mjs";
import {
  alterarEstadoDoExecutor,
  estadoDoExecutor,
} from "./controleExecutor.mjs";
import { avaliarProntidaoSicoob } from "./prontidaoSicoob.mjs";
import { obterObservabilidadeBancaria } from "./observabilidadeBancaria.mjs";
import { executarConciliacaoManual } from "./conciliacaoManual.mjs";
import { obterBanco } from "../bancoDeDados.mjs";
import { gerarPdfBoletoEcosol } from "./pdfBoletoEcosol.mjs";

export const rotasOperacoesBancarias = Router();

rotasOperacoesBancarias.get(
  "/api/admin/bancario/credencial-confirmacao",
  exigirProprietario,
  (req, res) => res.json(estadoCredencialConfirmacao(req.administrador)),
);
rotasOperacoesBancarias.put(
  "/api/admin/bancario/credencial-confirmacao",
  exigirProprietario,
  exigirOrigemConfiavel,
  async (req, res) =>
    res.json(
      await salvarCredencialConfirmacao(
        req.administrador,
        req.body?.senha_atual,
        req.body?.nova_senha,
      ),
    ),
);
rotasOperacoesBancarias.post(
  "/api/admin/bancario/credencial-confirmacao/recuperar",
  exigirProprietario,
  exigirOrigemConfiavel,
  async (req, res) =>
    res.json(await solicitarRecuperacaoCredencial(req.administrador)),
);
rotasOperacoesBancarias.post(
  "/api/admin/bancario/credencial-confirmacao/redefinir",
  exigirProprietario,
  exigirOrigemConfiavel,
  async (req, res) =>
    res.json(
      await concluirRecuperacaoCredencial(
        req.administrador,
        req.body?.codigo,
        req.body?.nova_senha,
      ),
    ),
);

rotasOperacoesBancarias.post(
  "/api/admin/bancario/confirmar-identidade",
  confirmarIdentidadeBancaria,
);
function exigirContaNominalDaEquipe(req, res, next) {
  if (!req.administrador?.id)
    return res.status(403).json({ erro: "Use uma conta nominal da equipe." });
  next();
}

function exigirOrigemConfiavel(req, res, next) {
  if (origemConfiavel(req)) return next();
  const origem = req.headers.origin;
  const site = req.headers["sec-fetch-site"];
  const esperada = new URL(
    process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  );
  const coincide = (valor) => {
    try {
      return Boolean(valor && new URL(valor).origin === esperada.origin);
    } catch {
      return false;
    }
  };
  console.warn(
    JSON.stringify({
      evento: "origem_bancaria_rejeitada",
      request_id: req.idRequisicao ?? null,
      origem: origem === undefined ? "ausente" : origem === "null" ? "opaca" : "informada",
      site: ["same-origin", "same-site", "cross-site", "none"].includes(site)
        ? site
        : "ausente",
      referencia: req.headers.referer ? "informada" : "ausente",
      origem_compativel: coincide(origem),
      host_compativel:
        req.headers.host?.toLowerCase() === esperada.host.toLowerCase(),
      referencia_compativel: coincide(req.headers.referer),
    }),
  );
  return res.status(403).json({
    erro: "Requisição recusada por origem não confiável. Confira o endereço de acesso e consulte o diagnóstico no terminal do servidor.",
    codigo: "ORIGEM_NAO_CONFIAVEL",
  });
}

function exigirProprietario(req, res, next) {
  if (!temPapelCritico(req.administrador?.id, "proprietario"))
    return res
      .status(403)
      .json({ erro: "Somente o Proprietário pode aprovar pagamentos." });
  next();
}

function podeConsultarTodasAsOperacoes(administradorId) {
  return [
    "consulta_auditoria",
    "operador_financeiro",
    "aprovador_financeiro",
  ].some((papel) => temPapelBancario(administradorId, papel));
}

rotasOperacoesBancarias.get(
  "/api/admin/bancario/estado",
  exigirContaNominalDaEquipe,
  (_req, res) => {
    const { ambiente, modo_configurado, pausado } = estadoDoExecutor();
    res.set("Cache-Control", "no-store").json({
      ambiente,
      modo_configurado,
      pausado,
    });
  },
);

rotasOperacoesBancarias.get(
  "/api/admin/bancario/executor",
  exigirPapelBancario("administrador_integracao"),
  (_req, res) => res.json(estadoDoExecutor()),
);

rotasOperacoesBancarias.get(
  "/api/admin/bancario/prontidao",
  exigirPapelBancario("administrador_integracao"),
  (_req, res) =>
    res.set("Cache-Control", "no-store").json(avaliarProntidaoSicoob()),
);

rotasOperacoesBancarias.get(
  "/api/admin/bancario/observabilidade",
  exigirUmDosPapeisBancarios("consulta_auditoria", "administrador_integracao"),
  (req, res) =>
    res.set("Cache-Control", "no-store").json(
      obterObservabilidadeBancaria({
        limite: req.query?.limite === undefined ? 50 : Number(req.query.limite),
      }),
    ),
);

rotasOperacoesBancarias.patch(
  "/api/admin/bancario/executor",
  exigirPapelBancario("administrador_integracao"),
  exigirConfirmacaoBancaria,
  (req, res) =>
    res.json(alterarEstadoDoExecutor(req.body.pausado, req.administrador)),
);

rotasOperacoesBancarias.get(
  "/api/admin/bancario/operacoes",
  exigirContaNominalDaEquipe,
  (req, res) =>
    res.json(
      listarOperacoes(
        req.administrador.id,
        podeConsultarTodasAsOperacoes(req.administrador.id),
      ),
    ),
);

rotasOperacoesBancarias.get(
  "/api/admin/bancario/operacoes/:id",
  exigirContaNominalDaEquipe,
  (req, res) =>
    res.json(
      obterOperacao(
        String(req.params.id),
        req.administrador.id,
        podeConsultarTodasAsOperacoes(req.administrador.id),
      ),
    ),
);

rotasOperacoesBancarias.get(
  "/api/admin/bancario/operacoes/:id/demonstrativo.pdf",
  exigirContaNominalDaEquipe,
  async (req, res) => {
    const operacao = obterOperacao(
      String(req.params.id),
      req.administrador.id,
      podeConsultarTodasAsOperacoes(req.administrador.id),
    );
    if (operacao.tipo !== "cobranca" || !operacao.demonstrativo)
      return res.status(404).json({ erro: "Demonstrativo não encontrado." });
    const final = req.query.final === "1";
    let pdfBanco = null;
    if (final) {
      if (!["registrada", "liquidada"].includes(operacao.estado))
        return res
          .status(409)
          .json({ erro: "O boleto ainda não foi registrado pelo banco." });
      const artefato = obterBanco()
        .prepare(
          "SELECT pdf,pdf_sha256 FROM bancario_artefatos_cobranca WHERE operacao_id=?",
        )
        .get(operacao.id);
      pdfBanco = artefato?.pdf;
      if (!pdfBanco)
        return res.status(409).json({
          erro: "O Sicoob ainda não forneceu o PDF do boleto. Consulte o boleto original no banco.",
        });
      if (
        !artefato.pdf_sha256 ||
        createHash("sha256").update(pdfBanco).digest("hex") !==
          artefato.pdf_sha256
      )
        return res.status(409).json({
          erro: "O PDF bancário não passou na verificação de integridade.",
        });
    }
    const pdf = await gerarPdfBoletoEcosol({
      operacao,
      demonstrativo: operacao.demonstrativo,
      pdfBanco,
    });
    res
      .set({
        "Cache-Control": "no-store",
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="ecosol-${final ? "boleto" : "previa"}-${operacao.id}.pdf"`,
      })
      .send(pdf);
  },
);

rotasOperacoesBancarias.post(
  "/api/admin/bancario/operacoes/:id/conciliar",
  exigirPapelBancario("administrador_integracao"),
  exigirConfirmacaoBancaria,
  async (req, res) =>
    res.json(
      await executarConciliacaoManual({
        operacaoId: String(req.params.id),
        administrador: req.administrador,
      }),
    ),
);

rotasOperacoesBancarias.post(
  "/api/admin/bancario/operacoes/cobrancas",
  exigirContaNominalDaEquipe,
  exigirOrigemConfiavel,
  (req, res) => {
    const resultado = criarOperacaoDeCobranca(
      Number(req.body.documento_id),
      req.administrador,
    );
    res.status(resultado.criada ? 201 : 200).json(resultado);
  },
);

rotasOperacoesBancarias.post(
  "/api/admin/bancario/operacoes/:id/aprovar",
  exigirProprietario,
  exigirOrigemConfiavel,
  async (req, res) =>
    res.json(
      await aprovarOperacao(
        String(req.params.id),
        req.administrador,
        req.body?.senha,
      ),
    ),
);

rotasOperacoesBancarias.post(
  "/api/admin/bancario/operacoes/:id/enfileirar",
  exigirContaNominalDaEquipe,
  exigirOrigemConfiavel,
  (req, res) =>
    res.json(enfileirarOperacao(String(req.params.id), req.administrador)),
);

rotasOperacoesBancarias.post(
  "/api/admin/bancario/operacoes/:id/liberar-nova-emissao",
  exigirContaNominalDaEquipe,
  exigirOrigemConfiavel,
  (req, res) =>
    res.json(
      liberarNovaEmissaoAposFalha(String(req.params.id), req.administrador),
    ),
);

rotasOperacoesBancarias.use((erro, _req, res, next) => {
  if (!erro?.status) return next(erro);
  const codigo = String(erro.codigo ?? "");
  res.status(erro.status).json({
    erro: erro.message,
    ...(/^[A-Z0-9_]{1,80}$/.test(codigo) ? { codigo } : {}),
  });
});
