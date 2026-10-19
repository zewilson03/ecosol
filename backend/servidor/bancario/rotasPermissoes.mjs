import { Router } from "express";
import { obterBanco } from "../bancoDeDados.mjs";
import { exigirConfirmacaoBancaria } from "./confirmacaoSensivel.mjs";
import {
  nomesDosPapeisBancarios,
  papelBancarioValido,
  temPapelBancario,
} from "./permissoes.mjs";

export const rotasPermissoesBancarias = Router();
rotasPermissoesBancarias.use(
  "/api/admin/bancario/permissoes",
  (req, res, next) => {
    if (["PUT", "PATCH", "DELETE", "POST"].includes(req.method))
      return exigirConfirmacaoBancaria(req, res, next);
    next();
  },
);

function podeGerenciar(req) {
  if (!req.administrador?.id || req.administrador.nivel !== 3) return false;
  const existeGestor = obterBanco()
    .prepare(
      "SELECT 1 FROM bancario_papeis_equipe WHERE papel='administrador_integracao' LIMIT 1",
    )
    .get();
  return (
    !existeGestor ||
    temPapelBancario(req.administrador.id, "administrador_integracao")
  );
}

export function nivelMinimoDoPapel(papel) {
  return ["aprovador_financeiro", "administrador_integracao"].includes(papel)
    ? 3
    : papel === "operador_financeiro"
      ? 2
      : 1;
}

rotasPermissoesBancarias.get("/api/admin/bancario/permissoes", (req, res) => {
  if (req.administrador.nivel !== 3)
    return res.status(403).json({ erro: "Acesso restrito ao nível 3." });
  const banco = obterBanco();
  res.json({
    pode_gerenciar: podeGerenciar(req),
    papeis: Object.entries(nomesDosPapeisBancarios).map(([id, nome]) => ({
      id,
      nome,
    })),
    pessoas: banco
      .prepare(
        `SELECT s.id,s.name,s.email,s.access_level,
             COALESCE(group_concat(p.papel, ','),'') AS papeis
           FROM staff_users s
           LEFT JOIN bancario_papeis_equipe p ON p.staff_id=s.id
           GROUP BY s.id ORDER BY s.name,s.id`,
      )
      .all()
      .map((pessoa) => ({
        ...pessoa,
        papeis: pessoa.papeis ? pessoa.papeis.split(",").sort() : [],
      })),
  });
});

rotasPermissoesBancarias.put(
  "/api/admin/bancario/permissoes/:staffId/:papel",
  (req, res) => {
    const staffId = Number(req.params.staffId);
    const papel = String(req.params.papel);
    if (!podeGerenciar(req))
      return res.status(403).json({
        erro: "Sua conta não pode gerenciar permissões bancárias.",
      });
    if (
      !Number.isSafeInteger(staffId) ||
      staffId <= 0 ||
      !papelBancarioValido(papel)
    )
      return res.status(400).json({ erro: "Permissão bancária inválida." });
    if (staffId === req.administrador.id)
      return res.status(400).json({
        erro: "Outro administrador deve alterar suas permissões bancárias.",
      });
    const banco = obterBanco();
    const pessoa = banco
      .prepare("SELECT access_level FROM staff_users WHERE id=?")
      .get(staffId);
    if (!pessoa)
      return res.status(404).json({ erro: "Pessoa da equipe não encontrada." });
    if (pessoa.access_level < nivelMinimoDoPapel(papel))
      return res.status(400).json({
        erro: `Este papel exige nível ${nivelMinimoDoPapel(papel)} ou superior.`,
      });
    banco.exec("BEGIN IMMEDIATE");
    try {
      const gravacao = banco
        .prepare(
          "INSERT OR IGNORE INTO bancario_papeis_equipe(staff_id,papel,concedido_por) VALUES (?,?,?)",
        )
        .run(staffId, papel, req.administrador.id);
      if (gravacao.changes)
        banco
          .prepare(
            "INSERT INTO bancario_auditoria_permissoes(staff_id,papel,acao,responsavel_id,responsavel_nome) VALUES (?,?,?,?,?)",
          )
          .run(
            staffId,
            papel,
            "concedido",
            req.administrador.id,
            req.administrador.nome,
          );
      banco.exec("COMMIT");
      res.json({ sucesso: true, alterado: gravacao.changes === 1 });
    } catch (erro) {
      banco.exec("ROLLBACK");
      throw erro;
    }
  },
);

rotasPermissoesBancarias.delete(
  "/api/admin/bancario/permissoes/:staffId/:papel",
  (req, res) => {
    const staffId = Number(req.params.staffId);
    const papel = String(req.params.papel);
    if (!podeGerenciar(req))
      return res.status(403).json({
        erro: "Sua conta não pode gerenciar permissões bancárias.",
      });
    if (
      !Number.isSafeInteger(staffId) ||
      staffId <= 0 ||
      !papelBancarioValido(papel)
    )
      return res.status(400).json({ erro: "Permissão bancária inválida." });
    if (staffId === req.administrador.id)
      return res.status(400).json({
        erro: "Outro administrador deve alterar suas permissões bancárias.",
      });
    const banco = obterBanco();
    if (papel === "administrador_integracao") {
      const total = banco
        .prepare(
          "SELECT COUNT(*) AS n FROM bancario_papeis_equipe WHERE papel=?",
        )
        .get(papel).n;
      if (total <= 1 && temPapelBancario(staffId, papel))
        return res.status(409).json({
          erro: "Mantenha pelo menos um administrador da integração.",
        });
    }
    banco.exec("BEGIN IMMEDIATE");
    try {
      const exclusao = banco
        .prepare(
          "DELETE FROM bancario_papeis_equipe WHERE staff_id=? AND papel=?",
        )
        .run(staffId, papel);
      if (exclusao.changes)
        banco
          .prepare(
            "INSERT INTO bancario_auditoria_permissoes(staff_id,papel,acao,responsavel_id,responsavel_nome) VALUES (?,?,?,?,?)",
          )
          .run(
            staffId,
            papel,
            "revogado",
            req.administrador.id,
            req.administrador.nome,
          );
      banco.exec("COMMIT");
      res.json({ sucesso: true, alterado: exclusao.changes === 1 });
    } catch (erro) {
      banco.exec("ROLLBACK");
      throw erro;
    }
  },
);
