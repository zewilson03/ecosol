import nodemailer from "nodemailer";

function falhar(mensagem) {
  const erro = new Error(mensagem);
  erro.status = 503;
  erro.codigo = "SMTP_INDISPONIVEL";
  throw erro;
}

export function obterConfiguracaoSmtp(variaveis = process.env) {
  const host = String(variaveis.SMTP_HOST ?? "").trim();
  const portaTexto = String(variaveis.SMTP_PORT ?? "").trim();
  const usuario = String(variaveis.SMTP_USER ?? "").trim();
  const senha = String(variaveis.SMTP_PASSWORD ?? "");
  const remetente = String(variaveis.SMTP_FROM ?? "").trim();
  if (!host || !portaTexto || !usuario || !senha || !remetente)
    falhar("O envio de e-mail ainda não está configurado.");

  const porta = Number(portaTexto);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65_535)
    falhar("A porta SMTP configurada é inválida.");
  if (/[:/\\\s]/.test(host)) falhar("O servidor SMTP configurado é inválido.");

  const seguroDesdeConexao = porta === 465;
  return Object.freeze({
    host,
    port: porta,
    secure: seguroDesdeConexao,
    requireTLS: !seguroDesdeConexao,
    auth: Object.freeze({ user: usuario, pass: senha }),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: Object.freeze({ minVersion: "TLSv1.2", servername: host }),
    remetente,
  });
}

export function criarTransporteSmtpSeguro(variaveis = process.env) {
  const configuracao = obterConfiguracaoSmtp(variaveis);
  const { remetente: _remetente, ...opcoes } = configuracao;
  return {
    configuracao,
    transporte: nodemailer.createTransport(opcoes),
  };
}
