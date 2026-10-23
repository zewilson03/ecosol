import { Router } from "express";
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
  return origemConfiavel(req) ? next() : res.sendStatus(403);
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

rotasOperacoesBancarias.use((erro, _req, res, next) => {
  if (!erro?.status) return next(erro);
  const codigo = String(erro.codigo ?? "");
  res.status(erro.status).json({
    erro: erro.message,
    ...(/^[A-Z0-9_]{1,80}$/.test(codigo) ? { codigo } : {}),
  });
});
