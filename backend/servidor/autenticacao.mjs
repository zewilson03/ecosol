import {
  createHash,
  randomBytes,
  scrypt as scryptOriginal,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { obterBanco } from "./bancoDeDados.mjs";

const scrypt = promisify(scryptOriginal);
const nomeDoCookie = "ecosol_session";
const umaSemana = 7 * 24 * 60 * 60 * 1000;
const parametrosDaSenha = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
};
const formatoAtual = /^scrypt\$v2\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
const formatoAntigo = /^([a-f0-9]{32}):([a-f0-9]{128})$/;

export function resumoCriptografico(valor) {
  return createHash("sha256").update(valor).digest("hex");
}

export function criarToken() {
  return randomBytes(32).toString("hex");
}

export async function protegerSenha(senha) {
  const sal = randomBytes(16);
  const chave = await scrypt(senha, sal, 64, parametrosDaSenha);
  return `scrypt$v2$${sal.toString("hex")}$${chave.toString("hex")}`;
}

export async function senhaConfere(senha, senhaProtegida) {
  const valor = String(senhaProtegida ?? "");
  const atual = formatoAtual.exec(valor);
  const antigo = atual ? null : formatoAntigo.exec(valor);
  if (!atual && !antigo) return false;

  const sal = atual ? Buffer.from(atual[1], "hex") : antigo[1];
  const hash = atual ? atual[2] : antigo[2];
  const calculado = atual
    ? await scrypt(senha, sal, 64, parametrosDaSenha)
    : await scrypt(senha, sal, 64);
  return timingSafeEqual(calculado, Buffer.from(hash, "hex"));
}

export function hashPrecisaAtualizar(senhaProtegida) {
  return formatoAntigo.test(String(senhaProtegida ?? ""));
}

export function sessaoAtual(requisicao) {
  const cookie = requisicao.headers.cookie
    ?.split(";")
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith(`${nomeDoCookie}=`));
  const token = cookie?.slice(nomeDoCookie.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;

  return (
    obterBanco()
      .prepare(
        "SELECT customer_id, staff_id, role FROM sessions WHERE token_hash = ? AND expires_at > ?",
      )
      .get(resumoCriptografico(token), Date.now()) ?? null
  );
}

export function iniciarSessao(resposta, perfil, identificador = null) {
  const token = criarToken();
  const validade = Date.now() + umaSemana;
  obterBanco()
    .prepare(
      "INSERT INTO sessions (customer_id, staff_id, token_hash, role, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      perfil === "customer" ? identificador : null,
      perfil === "staff" ? identificador : null,
      resumoCriptografico(token),
      perfil,
      validade,
    );

  const seguro = process.env.NODE_ENV === "production" ? "; Secure" : "";
  resposta.setHeader(
    "Set-Cookie",
    `${nomeDoCookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${seguro}`,
  );
}

export function encerrarSessao(requisicao, resposta) {
  const cookie = requisicao.headers.cookie
    ?.split(";")
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith(`${nomeDoCookie}=`));
  const token = cookie?.slice(nomeDoCookie.length + 1);
  if (token) {
    obterBanco()
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(resumoCriptografico(token));
  }
  resposta.setHeader(
    "Set-Cookie",
    `${nomeDoCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

export function limitarTentativas(chave, limite = 8) {
  const banco = obterBanco();
  const agora = Date.now();
  const registro = banco
    .prepare("SELECT attempts, reset_at FROM login_attempts WHERE key = ?")
    .get(chave);

  if (!registro || registro.reset_at < agora) {
    banco
      .prepare(
        "INSERT INTO login_attempts (key, attempts, reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = 1, reset_at = excluded.reset_at",
      )
      .run(chave, agora + 15 * 60 * 1000);
    return false;
  }

  banco
    .prepare("UPDATE login_attempts SET attempts = attempts + 1 WHERE key = ?")
    .run(chave);
  return registro.attempts >= limite;
}
