import "../servidor/configuracao.mjs";
import process from "node:process";
import { criarTransporteSmtpSeguro } from "../servidor/email/smtpSeguro.mjs";

async function executar() {
  const destino = String(
    process.argv.find((item) => item.startsWith("--destino="))?.slice(10) ?? "",
  ).trim();
  const confirmarEnvio = process.argv.includes("--confirmar-envio=TESTE-SMTP");
  const { configuracao, transporte } = criarTransporteSmtpSeguro();

  try {
    await transporte.verify();
    console.log("Conexão SMTP, autenticação e TLS validados.");

    if (destino || confirmarEnvio) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destino) || !confirmarEnvio)
        throw new Error(
          "Para enviar o diagnóstico, informe --destino=email e --confirmar-envio=TESTE-SMTP.",
        );
      await transporte.sendMail({
        from: configuracao.remetente,
        to: destino,
        subject: "Teste de recuperação financeira Ecosol",
        text: "O canal de recuperação da senha financeira foi validado. Esta mensagem não contém senha nem código de acesso.",
      });
      console.log("Mensagem de diagnóstico entregue ao servidor SMTP.");
    }
  } finally {
    transporte.close();
  }
}

executar().catch((erro) => {
  console.error(
    `Falha na verificação SMTP: ${erro?.message ?? "erro desconhecido"}`,
  );
  process.exitCode = 1;
});
