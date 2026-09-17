import { sessaoAtual } from "./autenticacao.mjs";
import { obterBanco } from "./bancoDeDados.mjs";

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
  return (
    obterBanco()
      .prepare(
        "SELECT id, name AS nome, access_level AS nivel FROM staff_users WHERE id = ?",
      )
      .get(sessao.staff_id) ?? null
  );
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
