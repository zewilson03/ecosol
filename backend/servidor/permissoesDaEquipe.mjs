import { sessaoAtual } from "./autenticacao.mjs";
import { obterBanco } from "./bancoDeDados.mjs";
import { temPapelCritico } from "./bancario/permissoes.mjs";

export function identificarAdministrador(requisicao) {
  const sessao = sessaoAtual(requisicao);
  if (sessao?.role !== "staff") return null;
  if (!sessao.staff_id) {
    const existeAdministrador = obterBanco()
      .prepare("SELECT 1 FROM staff_users LIMIT 1")
      .get();
    return existeAdministrador
      ? null
      : { id: null, nome: "Acesso inicial", nivel: 3 };
  }
  const administrador = obterBanco()
    .prepare(
      "SELECT id, name AS nome, access_level AS nivel FROM staff_users WHERE id = ?",
    )
    .get(sessao.staff_id);
  if (!administrador) return null;
  if (temPapelCritico(sessao.staff_id, "guardiao_recuperacao"))
    return { ...administrador, nivel: 0, guardiao_recuperacao: true };
  return {
    ...administrador,
    proprietario: temPapelCritico(sessao.staff_id, "proprietario"),
  };
}

export function exigirNivel(nivelMinimo) {
  return (requisicao, resposta, proximo) => {
    const administrador = identificarAdministrador(requisicao);
    if (!administrador)
      return resposta
        .status(401)
        .json({ erro: "Entre com uma conta da equipe." });
    if (administrador.nivel < nivelMinimo) {
      return resposta
        .status(403)
        .json({ erro: "Seu nível não permite esta operação." });
    }
    requisicao.administrador = administrador;
    proximo();
  };
}
