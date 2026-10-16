import { Router } from "express";
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

export const rotasOperacoesBancarias = Router();

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
    res.json(aprovarOperacao(String(req.params.id), req.administrador)),
);

rotasOperacoesBancarias.post(
  "/api/admin/bancario/operacoes/:id/enfileirar",
  exigirPapelBancario("operador_financeiro"),
  (req, res) =>
    res.json(enfileirarOperacao(String(req.params.id), req.administrador)),
);

rotasOperacoesBancarias.use((erro, _req, res, next) => {
  if (!erro?.status) return next(erro);
  res.status(erro.status).json({ erro: erro.message });
});
