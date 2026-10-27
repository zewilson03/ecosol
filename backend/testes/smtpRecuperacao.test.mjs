import assert from "node:assert/strict";
import { obterConfiguracaoSmtp } from "../servidor/email/smtpSeguro.mjs";

const base = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "587",
  SMTP_USER: "conta@teste.local",
  SMTP_PASSWORD: "segredo-local",
  SMTP_FROM: "Ecosol <conta@teste.local>",
};

const inicioTls = obterConfiguracaoSmtp(base);
assert.equal(inicioTls.secure, false);
assert.equal(inicioTls.requireTLS, true);
assert.equal(inicioTls.tls.minVersion, "TLSv1.2");
assert.equal(inicioTls.auth.user, base.SMTP_USER);

const tlsDireto = obterConfiguracaoSmtp({ ...base, SMTP_PORT: "465" });
assert.equal(tlsDireto.secure, true);
assert.equal(tlsDireto.requireTLS, false);

assert.throws(
  () => obterConfiguracaoSmtp({ ...base, SMTP_PASSWORD: "" }),
  (erro) => erro.codigo === "SMTP_INDISPONIVEL" && erro.status === 503,
);
assert.throws(
  () => obterConfiguracaoSmtp({ ...base, SMTP_PORT: "70000" }),
  /porta SMTP/,
);
assert.throws(
  () =>
    obterConfiguracaoSmtp({ ...base, SMTP_HOST: "https:\/\/smtp.gmail.com" }),
  /servidor SMTP/,
);

console.log("OK: SMTP exige configuração completa, TLS e limites de conexão.");
