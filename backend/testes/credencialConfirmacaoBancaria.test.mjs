import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-credencial-"));
process.env.NODE_ENV = "test";

const { protegerSenha } = await import("../servidor/autenticacao.mjs");
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const {
  concluirRecuperacaoCredencial,
  conferirCredencialConfirmacao,
  estadoCredencialConfirmacao,
  salvarCredencialConfirmacao,
  solicitarRecuperacaoCredencial,
} = await import("../servidor/bancario/credencialConfirmacao.mjs");

const banco = obterBanco();
const hashLogin = await protegerSenha("Senha de login 2026");
function pessoa(nome) {
  const id = Number(
    banco
      .prepare(
        "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,3)",
      )
      .run(nome, `${nome}@teste.local`, hashLogin).lastInsertRowid,
  );
  banco
    .prepare(
      "INSERT INTO equipe_papeis_criticos(staff_id,papel) VALUES(?,'proprietario')",
    )
    .run(id);
  return { id, nome };
}

const principal = pessoa("principal");
const segundo = pessoa("segundo");
const senhaInicial = "Financeira segura 2026";
const senhaNova = "Financeira renovada 2027";

await salvarCredencialConfirmacao(principal, "", senhaInicial);
assert.equal(estadoCredencialConfirmacao(principal).configurada, true);
assert.equal(estadoCredencialConfirmacao(segundo).pode_gerenciar, false);
await conferirCredencialConfirmacao(principal, senhaInicial);
await conferirCredencialConfirmacao(segundo, senhaInicial);
await assert.rejects(
  salvarCredencialConfirmacao(segundo, senhaInicial, senhaNova),
  /Proprietário 1/,
);

await solicitarRecuperacaoCredencial(principal);
const mensagem = banco
  .prepare("SELECT url FROM dev_mail ORDER BY id DESC LIMIT 1")
  .get();
const codigo = String(mensagem.url).replace("codigo-temporario:", "");
assert.match(codigo, /^\d{6}$/);
await concluirRecuperacaoCredencial(principal, codigo, senhaNova);
await conferirCredencialConfirmacao(segundo, senhaNova);
await assert.rejects(
  concluirRecuperacaoCredencial(principal, codigo, "Outra senha 2028"),
  /inválida ou expirada/,
);

await assert.rejects(
  solicitarRecuperacaoCredencial(principal, {
    enviar: async () => {
      throw new Error("falha simulada do SMTP");
    },
  }),
  /falha simulada do SMTP/,
);
assert.equal(
  banco
    .prepare(
      "SELECT COUNT(*) AS total FROM bancario_recuperacoes_credencial WHERE usado_em IS NULL",
    )
    .get().total,
  0,
);
assert.equal(
  banco
    .prepare(
      "SELECT COUNT(*) AS total FROM bancario_auditoria_credencial WHERE evento='recuperada'",
    )
    .get().total,
  1,
);

console.log(
  "OK: senha financeira é gerida pelo Proprietário 1, aceita pelos dois Proprietários e recuperada por código temporário de uso único.",
);
banco.close();
