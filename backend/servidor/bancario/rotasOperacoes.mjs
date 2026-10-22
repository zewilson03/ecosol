import { Router } from "express";
import {
  confirmarIdentidadeBancaria,
  exigirConfirmacaoBancaria,
  origemConfiavel,
} from "./confirmacaoSensivel.mjs";
import {
  ativarMfa,
  estadoMfa,
  iniciarMfa,
  iniciarMfaAposRecuperacao,
  substituirMfa,
} from "./mfa.mjs";
import {
  aprovarRecuperacaoMfa,
  listarRecuperacoesMfa,
  minhaRecuperacaoMfa,
  solicitarRecuperacaoMfa,
} from "./recuperacaoMfa.mjs";
import {
  exigirPapelBancario,
  exigirUmDosPapeisBancarios,
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

rotasOperacoesBancarias.get("/api/admin/bancario/mfa", estadoMfa);
rotasOperacoesBancarias.post(
  "/api/admin/bancario/mfa/iniciar",
  (req, res, next) => (origemConfiavel(req) ? next() : res.sendStatus(403)),
  iniciarMfa,
);
rotasOperacoesBancarias.post(
  "/api/admin/bancario/mfa/ativar",
  (req, res, next) => (origemConfiavel(req) ? next() : res.sendStatus(403)),
  ativarMfa,
);
rotasOperacoesBancarias.post(
  "/api/admin/bancario/mfa/substituir",
  (req, res, next) => (origemConfiavel(req) ? next() : res.sendStatus(403)),
  substituirMfa,
);
rotasOperacoesBancarias.get(
  "/api/admin/bancario/mfa/recuperacao/minha",
  minhaRecuperacaoMfa,
);

rotasOperacoesBancarias.post(
  "/api/admin/bancario/mfa/recuperacao/solicitar",
  (req, res, next) => (origemConfiavel(req) ? next() : res.sendStatus(403)),
  solicitarRecuperacaoMfa,
);
rotasOperacoesBancarias.post(
  "/api/admin/bancario/mfa/recuperacao/:id/iniciar",
  (req, res, next) => (origemConfiavel(req) ? next() : res.sendStatus(403)),
  iniciarMfaAposRecuperacao,
);
rotasOperacoesBancarias.get(
  "/api/admin/bancario/mfa/recuperacoes",
  listarRecuperacoesMfa,
);
rotasOperacoesBancarias.post(
  "/api/admin/bancario/mfa/recuperacoes/:id/aprovar",
  exigirConfirmacaoBancaria,
  aprovarRecuperacaoMfa,
);

rotasOperacoesBancarias.post(
  "/api/admin/bancario/confirmar-identidade",
  confirmarIdentidadeBancaria,
);
rotasOperacoesBancarias.use("/api/admin/bancario", (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method))
    return exigirConfirmacaoBancaria(req, res, next);
  next();
});

const podeConsultar = exigirUmDosPapeisBancarios(
  "consulta_auditoria",
  "operador_financeiro",
  "aprovador_financeiro",
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
  (req, res) =>
    res.json(alterarEstadoDoExecutor(req.body.pausado, req.administrador)),
);

rotasOperacoesBancarias.get(
  "/api/admin/bancario/operacoes",
  podeConsultar,
  (_req, res) => res.json(listarOperacoes()),
);

rotasOperacoesBancarias.get(
  "/api/admin/bancario/operacoes/:id",
  podeConsultar,
  (req, res) => res.json(obterOperacao(String(req.params.id))),
);

rotasOperacoesBancarias.post(
  "/api/admin/bancario/operacoes/:id/conciliar",
  exigirPapelBancario("administrador_integracao"),
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
  exigirPapelBancario("operador_financeiro"),
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
  exigirPapelBancario("aprovador_financeiro"),
  (req, res) =>
    res.json(
      aprovarOperacao(
        String(req.params.id),
        req.administrador,
        req.body?.confirmacao_autoaprovacao === true,
      ),
    ),
);

rotasOperacoesBancarias.post(
  "/api/admin/bancario/operacoes/:id/enfileirar",
  exigirPapelBancario("operador_financeiro"),
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
