import "../servidor/configuracao.mjs";
import process from "node:process";
import { obterBanco } from "../servidor/bancoDeDados.mjs";
import { protegerSenha } from "../servidor/autenticacao.mjs";

const email = String(process.argv[2] ?? "").trim().toLowerCase();
const senha = (await new Promise((resolve, reject) => {
  let conteudo = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (parte) => (conteudo += parte));
  process.stdin.on("end", () => resolve(conteudo.replace(/\r?\n$/, "")));
  process.stdin.on("error", reject);
}));

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error("Informe um e-mail válido.");
if (senha.length < 8 || senha.length > 128)
  throw new Error("A senha deve ter entre 8 e 128 caracteres.");

const banco = obterBanco();
try {
  const conta = banco
    .prepare("SELECT id FROM staff_users WHERE lower(email)=?")
    .get(email);
  if (!conta) throw new Error("Conta da equipe não encontrada.");
  const hash = await protegerSenha(senha);
  banco.exec("BEGIN IMMEDIATE");
  try {
    banco
      .prepare("UPDATE staff_users SET password_hash=? WHERE id=?")
      .run(hash, conta.id);
    banco.prepare("DELETE FROM sessions WHERE staff_id=?").run(conta.id);
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
  console.log("Senha atualizada. Sessões antigas encerradas.");
} finally {
  banco.close();
}
