import { randomBytes, timingSafeEqual } from "node:crypto";
import { obterBanco } from "../bancoDeDados.mjs";
import {
  limitarTentativas,
  resumoCriptografico,
  senhaConfere,
  sessaoAtual,
} from "../autenticacao.mjs";

const validadeMs = 5 * 60_000;
const confirmacoes = new Map();

export function origemConfiavel(req) {
  try {
    const enderecoEsperado = new URL(
      process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
    );
    if (
      process.env.NODE_ENV === "production" &&
      enderecoEsperado.protocol !== "https:"
    )
      return false;
    if (req.headers["sec-fetch-site"] === "cross-site") return false;
    if (req.headers.origin && req.headers.origin !== "null")
      return new URL(req.headers.origin).origin === enderecoEsperado.origin;
    // Alguns navegadores omitem Origin/Fetch Metadata nas chamadas locais.
    // Nessa situação, Host e Referer devem apontar para a origem configurada.
    if (req.headers.host?.toLowerCase() !== enderecoEsperado.host.toLowerCase())
      return false;
    if (req.headers["sec-fetch-site"] === "same-origin") return true;
    return Boolean(
      req.headers.referer &&
      new URL(req.headers.referer).origin === enderecoEsperado.origin,
    );
  } catch {
    return false;
  }
}

function chaveDaSessao(req) {
  const sessao = sessaoAtual(req);
  return sessao?.role === "staff" && sessao.staff_id
    ? { sessao, chave: sessao.id }
    : null;
}

export async function confirmarIdentidadeBancaria(req, res) {
  if (!origemConfiavel(req)) return res.sendStatus(403);
  const atual = chaveDaSessao(req);
  if (!atual || atual.sessao.staff_id !== req.administrador?.id)
    return res.status(403).json({ erro: "Use uma conta nominal da equipe." });

  const senha = req.body?.senha;
  if (typeof senha !== "string" || senha.length < 1 || senha.length > 128)
    return res.status(400).json({ erro: "Informe sua senha atual." });
  const chaveLimite = `bancario-reauth:${atual.sessao.staff_id}`;
  if (limitarTentativas(chaveLimite, 5))
    return res
      .status(429)
      .json({ erro: "Muitas tentativas. Aguarde 15 minutos." });
  const pessoa = obterBanco()
    .prepare("SELECT password_hash FROM staff_users WHERE id=?")
    .get(atual.sessao.staff_id);
  if (!pessoa || !(await senhaConfere(senha, pessoa.password_hash)))
    return res.status(401).json({ erro: "Senha incorreta." });

  obterBanco()
    .prepare("DELETE FROM login_attempts WHERE key=?")
    .run(chaveLimite);
  const prova = randomBytes(32).toString("hex");
  const agora = Date.now();
  const expiraEm = agora + validadeMs;
  for (const [id, registro] of confirmacoes)
    if (registro.expiraEm <= agora) confirmacoes.delete(id);
  confirmacoes.set(atual.chave, {
    hash: resumoCriptografico(prova),
    expiraEm,
    senhaHash: pessoa.password_hash,
  });
  return res.json({ prova, expira_em: expiraEm });
}

export function exigirConfirmacaoBancaria(req, res, next) {
  if (!origemConfiavel(req)) return res.sendStatus(403);
  const atual = chaveDaSessao(req);
  const prova = req.headers["x-ecosol-confirmacao-bancaria"];
  const registro = atual && confirmacoes.get(atual.chave);
  if (!atual || !registro || registro.expiraEm <= Date.now()) {
    if (atual) confirmacoes.delete(atual.chave);
    return res
      .status(403)
      .json({ erro: "Confirme sua senha para esta ação bancária." });
  }
  const hashAtual = obterBanco()
    .prepare("SELECT password_hash FROM staff_users WHERE id=?")
    .get(atual.sessao.staff_id)?.password_hash;
  if (hashAtual !== registro.senhaHash) {
    confirmacoes.delete(atual.chave);
    return res.status(403).json({ erro: "Confirme novamente sua senha." });
  }
  if (typeof prova !== "string" || !/^[a-f0-9]{64}$/.test(prova))
    return res.status(403).json({ erro: "Confirmação bancária ausente." });
  const recebida = Buffer.from(resumoCriptografico(prova), "hex");
  const esperada = Buffer.from(registro.hash, "hex");
  if (!timingSafeEqual(recebida, esperada))
    return res.status(403).json({ erro: "Confirmação bancária inválida." });
  next();
}
