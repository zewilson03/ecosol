import { obterBanco } from "../bancoDeDados.mjs";
import { papeisBancarios } from "./esquema.mjs";

export const nomesDosPapeisBancarios = {
  consulta_auditoria: "Consulta e auditoria",
  operador_financeiro: "Operador financeiro",
  aprovador_financeiro: "Aprovador financeiro",
  administrador_integracao: "Administrador da integração",
};

export function papelBancarioValido(papel) {
  return papeisBancarios.includes(String(papel));
}

export function temPapelCritico(administradorId, papel) {
  if (
    !administradorId ||
    !["proprietario", "guardiao_recuperacao"].includes(papel)
  )
    return false;
  return Boolean(
    obterBanco()
      .prepare(
        `SELECT 1 FROM equipe_papeis_criticos p
         JOIN staff_users s ON s.id=p.staff_id
         WHERE p.staff_id=? AND p.papel=?
           AND (p.papel<>'proprietario' OR s.access_level=3)`,
      )
      .get(administradorId, papel),
  );
}

export function papeisDoAdministrador(administradorId) {
  if (!administradorId) return [];
  if (temPapelCritico(administradorId, "proprietario"))
    return [...papeisBancarios];
  return obterBanco()
    .prepare(
      "SELECT papel FROM bancario_papeis_equipe WHERE staff_id=? ORDER BY papel",
    )
    .all(administradorId)
    .map((item) => item.papel);
}

export function temPapelBancario(administradorId, papel) {
  if (!papelBancarioValido(papel)) return false;
  if (temPapelCritico(administradorId, "proprietario")) return true;
  return Boolean(
    administradorId &&
    obterBanco()
      .prepare(
        "SELECT 1 FROM bancario_papeis_equipe WHERE staff_id=? AND papel=?",
      )
      .get(administradorId, papel),
  );
}

export function exigirPapelBancario(papel) {
  if (!papelBancarioValido(papel)) throw new Error("Papel bancário inválido.");
  return (req, res, next) => {
    if (!req.administrador?.id)
      return res.status(403).json({ erro: "Use uma conta nominal da equipe." });
    if (!temPapelBancario(req.administrador.id, papel))
      return res.status(403).json({
        erro: "Sua conta não possui a permissão bancária necessária.",
      });
    next();
  };
}

export function exigirUmDosPapeisBancarios(...papeis) {
  if (!papeis.length || papeis.some((papel) => !papelBancarioValido(papel)))
    throw new Error("Papéis bancários inválidos.");
  return (req, res, next) => {
    if (!req.administrador?.id)
      return res.status(403).json({ erro: "Use uma conta nominal da equipe." });
    if (!papeis.some((papel) => temPapelBancario(req.administrador.id, papel)))
      return res.status(403).json({
        erro: "Sua conta não possui uma das permissões bancárias necessárias.",
      });
    next();
  };
}
