import { randomInt, randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import {
  limitarTentativas,
  protegerSenha,
  resumoCriptografico,
  senhaConfere,
} from "../autenticacao.mjs";
import { obterBanco } from "../bancoDeDados.mjs";
import { temPapelCritico } from "./permissoes.mjs";

const validadeRecuperacaoMs = 15 * 60_000;
let transporte;

function falha(mensagem, status = 400) {
  const erro = new Error(mensagem);
  erro.status = status;
  throw erro;
}

function senhaValida(senha) {
  return (
    typeof senha === "string" &&
    senha.length >= 10 &&
    senha.length <= 128 &&
    /[A-Za-z]/.test(senha) &&
    /\d/.test(senha)
  );
}

function proprietarioPrincipal(banco = obterBanco()) {
  return banco
    .prepare(
      `SELECT s.id,s.name,s.email
       FROM equipe_papeis_criticos p
       JOIN staff_users s ON s.id=p.staff_id AND s.access_level=3
       WHERE p.papel='proprietario'
       ORDER BY p.concedido_em,p.staff_id LIMIT 1`,
    )
    .get();
}

function exigirProprietario(administrador) {
  if (!temPapelCritico(administrador?.id, "proprietario"))
    falha(
      "Somente um Proprietário pode usar a confirmação de pagamentos.",
      403,
    );
}

function exigirPrincipal(administrador) {
  exigirProprietario(administrador);
  const principal = proprietarioPrincipal();
  if (!principal || principal.id !== administrador.id)
    falha(
      "Somente o Proprietário 1 pode cadastrar, alterar ou recuperar a senha de confirmação.",
      403,
    );
  return principal;
}

function obterTransporte() {
  if (transporte) return transporte;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD)
    falha("O envio de e-mail ainda não está configurado.", 503);
  transporte = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  return transporte;
}

async function enviarCodigo(email, codigo) {
  const assunto = "Recuperação da senha de confirmação Ecosol";
  const texto = `Sua senha temporária é ${codigo}. Ela expira em 15 minutos e pode ser usada uma única vez. Se você não solicitou a recuperação, não compartilhe esta senha.`;
  if (process.env.NODE_ENV !== "production") {
    obterBanco()
      .prepare("INSERT INTO dev_mail(recipient,subject,url) VALUES(?,?,?)")
      .run(email, assunto, `codigo-temporario:${codigo}`);
    return;
  }
  if (!process.env.SMTP_FROM)
    falha("O remetente de e-mail não está configurado.", 503);
  await obterTransporte().sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: assunto,
    text: texto,
  });
}

export function estadoCredencialConfirmacao(administrador) {
  exigirProprietario(administrador);
  const principal = proprietarioPrincipal();
  const configurada = Boolean(
    obterBanco()
      .prepare("SELECT 1 FROM bancario_credencial_confirmacao WHERE id=1")
      .get(),
  );
  return {
    configurada,
    proprietario_principal: principal?.name ?? null,
    pode_gerenciar: principal?.id === administrador.id,
  };
}

export async function salvarCredencialConfirmacao(
  administrador,
  senhaAtual,
  novaSenha,
) {
  const principal = exigirPrincipal(administrador);
  if (!senhaValida(novaSenha))
    falha("Use uma senha com 10 a 128 caracteres, contendo letras e números.");
  const banco = obterBanco();
  const atual = banco
    .prepare(
      "SELECT senha_hash FROM bancario_credencial_confirmacao WHERE id=1",
    )
    .get();
  if (
    atual &&
    !(await senhaConfere(String(senhaAtual ?? ""), atual.senha_hash))
  )
    falha("A senha de confirmação atual está incorreta.", 401);
  const hash = await protegerSenha(novaSenha);
  banco.exec("BEGIN IMMEDIATE");
  try {
    banco
      .prepare(
        `INSERT INTO bancario_credencial_confirmacao
         (id,proprietario_principal_id,senha_hash) VALUES(1,?,?)
         ON CONFLICT(id) DO UPDATE SET senha_hash=excluded.senha_hash,
           proprietario_principal_id=excluded.proprietario_principal_id,
           versao=versao+1,alterado_em=CURRENT_TIMESTAMP`,
      )
      .run(principal.id, hash);
    banco
      .prepare(
        "INSERT INTO bancario_auditoria_credencial(ator_id,evento) VALUES(?,?)",
      )
      .run(principal.id, atual ? "alterada" : "cadastrada");
    banco
      .prepare(
        "UPDATE bancario_recuperacoes_credencial SET usado_em=? WHERE usado_em IS NULL",
      )
      .run(Date.now());
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
  return { sucesso: true };
}

export async function conferirCredencialConfirmacao(administrador, senha) {
  exigirProprietario(administrador);
  if (typeof senha !== "string" || !senha || senha.length > 128)
    falha("Informe a senha de confirmação.");
  const chave = `bancario-confirmacao-pagamento:${administrador.id}`;
  if (limitarTentativas(chave, 5))
    falha("Muitas tentativas. Aguarde 15 minutos.", 429);
  const registro = obterBanco()
    .prepare(
      "SELECT senha_hash FROM bancario_credencial_confirmacao WHERE id=1",
    )
    .get();
  if (!registro)
    falha("O Proprietário 1 ainda não cadastrou a senha de confirmação.", 409);
  if (!(await senhaConfere(senha, registro.senha_hash)))
    falha("Senha de confirmação incorreta.", 401);
  obterBanco().prepare("DELETE FROM login_attempts WHERE key=?").run(chave);
}

export async function solicitarRecuperacaoCredencial(administrador) {
  const principal = exigirPrincipal(administrador);
  const chave = `bancario-recuperar-confirmacao:${principal.id}`;
  if (limitarTentativas(chave, 3))
    falha("Muitas solicitações. Aguarde 15 minutos.", 429);
  const codigo = String(randomInt(100000, 1000000));
  const agora = Date.now();
  const banco = obterBanco();
  banco.exec("BEGIN IMMEDIATE");
  try {
    banco
      .prepare(
        "UPDATE bancario_recuperacoes_credencial SET usado_em=? WHERE usado_em IS NULL",
      )
      .run(agora);
    banco
      .prepare(
        `INSERT INTO bancario_recuperacoes_credencial
         (id,proprietario_principal_id,codigo_hash,expira_em,solicitado_em)
         VALUES(?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        principal.id,
        resumoCriptografico(codigo),
        agora + validadeRecuperacaoMs,
        agora,
      );
    banco
      .prepare(
        "INSERT INTO bancario_auditoria_credencial(ator_id,evento) VALUES(?,'recuperacao_solicitada')",
      )
      .run(principal.id);
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
  await enviarCodigo(principal.email, codigo);
  return { sucesso: true };
}

export async function concluirRecuperacaoCredencial(
  administrador,
  codigo,
  novaSenha,
) {
  const principal = exigirPrincipal(administrador);
  if (!/^\d{6}$/.test(String(codigo ?? "")))
    falha("Informe a senha temporária de seis dígitos.");
  if (!senhaValida(novaSenha))
    falha("Use uma senha com 10 a 128 caracteres, contendo letras e números.");
  const chave = `bancario-validar-recuperacao:${principal.id}`;
  if (limitarTentativas(chave, 5))
    falha("Muitas tentativas. Aguarde 15 minutos.", 429);
  const banco = obterBanco();
  const pedido = banco
    .prepare(
      `SELECT * FROM bancario_recuperacoes_credencial
       WHERE proprietario_principal_id=? AND usado_em IS NULL AND expira_em>?
       ORDER BY solicitado_em DESC LIMIT 1`,
    )
    .get(principal.id, Date.now());
  if (!pedido || pedido.codigo_hash !== resumoCriptografico(String(codigo)))
    falha("Senha temporária inválida ou expirada.", 401);
  const hash = await protegerSenha(novaSenha);
  banco.exec("BEGIN IMMEDIATE");
  try {
    const consumido = banco
      .prepare(
        "UPDATE bancario_recuperacoes_credencial SET usado_em=? WHERE id=? AND usado_em IS NULL AND expira_em>?",
      )
      .run(Date.now(), pedido.id, Date.now());
    if (consumido.changes !== 1)
      falha("Senha temporária inválida ou expirada.", 409);
    banco
      .prepare(
        `INSERT INTO bancario_credencial_confirmacao
         (id,proprietario_principal_id,senha_hash) VALUES(1,?,?)
         ON CONFLICT(id) DO UPDATE SET senha_hash=excluded.senha_hash,
           proprietario_principal_id=excluded.proprietario_principal_id,
           versao=versao+1,alterado_em=CURRENT_TIMESTAMP`,
      )
      .run(principal.id, hash);
    banco
      .prepare(
        "INSERT INTO bancario_auditoria_credencial(ator_id,evento) VALUES(?,'recuperada')",
      )
      .run(principal.id);
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
  obterBanco()
    .prepare("DELETE FROM login_attempts WHERE key IN (?,?)")
    .run(`bancario-confirmacao-pagamento:${principal.id}`, chave);
  return { sucesso: true };
}
