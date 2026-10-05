import { createHash } from "node:crypto";

function transacao(banco, operacao) {
  banco.exec("BEGIN IMMEDIATE");
  try {
    const resultado = operacao();
    banco.exec("COMMIT");
    return resultado;
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

const hash = (state) => createHash("sha256").update(state).digest("hex");

export function criarRepositorioOAuthGmail(banco) {
  return {
    iniciar({ contaId, sessaoId, state, verificador, agora }) {
      return transacao(banco, () => {
        if (
          !banco.prepare("SELECT 1 FROM gmail_contas WHERE id=?").get(contaId)
        )
          return false;
        banco
          .prepare(
            "DELETE FROM gmail_oauth_tentativas WHERE expira_em<=? OR conta_id=?",
          )
          .run(agora, contaId);
        banco
          .prepare(
            `INSERT INTO gmail_oauth_tentativas
          (state_hash,conta_id,sessao_id,verificador_pkce,expira_em,criado_em)
          VALUES (?,?,?,?,?,?)`,
          )
          .run(
            hash(state),
            contaId,
            sessaoId,
            verificador,
            agora + 10 * 60_000,
            agora,
          );
        return true;
      });
    },

    reivindicar({ state, sessaoId, agora }) {
      return transacao(banco, () => {
        const chave = hash(state);
        const tentativa = banco
          .prepare(
            `SELECT * FROM gmail_oauth_tentativas
          WHERE state_hash=? AND sessao_id=? AND expira_em>? AND consumido_em IS NULL`,
          )
          .get(chave, sessaoId, agora);
        if (!tentativa) return null;
        banco
          .prepare(
            "UPDATE gmail_oauth_tentativas SET consumido_em=? WHERE state_hash=? AND consumido_em IS NULL",
          )
          .run(agora, chave);
        return { ...tentativa, state_hash: chave };
      });
    },

    descartar(stateHash) {
      banco
        .prepare("DELETE FROM gmail_oauth_tentativas WHERE state_hash=?")
        .run(stateHash);
    },

    concluir({
      tentativa,
      email,
      escopo,
      tokenCifrado,
      administradorId,
      agora,
    }) {
      return transacao(banco, () => {
        const atual = banco
          .prepare(
            `SELECT 1 FROM gmail_oauth_tentativas
          WHERE state_hash=? AND conta_id=? AND consumido_em IS NOT NULL`,
          )
          .get(tentativa.state_hash, tentativa.conta_id);
        if (!atual) return false;
        banco
          .prepare(
            `INSERT INTO gmail_credenciais
          (conta_id,refresh_token_cifrado,email_verificado,escopo,autorizado_em,autorizado_por)
          VALUES (?,?,?,?,?,?) ON CONFLICT(conta_id) DO UPDATE SET
          refresh_token_cifrado=excluded.refresh_token_cifrado,
          email_verificado=excluded.email_verificado,escopo=excluded.escopo,
          autorizado_em=excluded.autorizado_em,autorizado_por=excluded.autorizado_por`,
          )
          .run(
            tentativa.conta_id,
            tokenCifrado,
            email,
            escopo,
            agora,
            administradorId,
          );
        banco
          .prepare(
            `UPDATE gmail_contas SET status_autorizacao='conectada',
          pausada=1, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(tentativa.conta_id);
        for (const tabela of ["gmail_mensagens", "gmail_anexos"])
          banco
            .prepare(
              `UPDATE ${tabela} SET estado='pendente', lease_token=NULL,
            lease_ate=NULL, atualizado_em=CURRENT_TIMESTAMP
            WHERE conta_id=? AND estado='em_processamento'`,
            )
            .run(tentativa.conta_id);
        banco
          .prepare(
            `INSERT INTO gmail_auditoria
          (conta_id,administrador_id,acao,criado_em) VALUES (?,?,'conectou',?)`,
          )
          .run(tentativa.conta_id, administradorId, agora);
        banco
          .prepare("DELETE FROM gmail_oauth_tentativas WHERE state_hash=?")
          .run(tentativa.state_hash);
        return true;
      });
    },

    registrarPausa({ contaId, administradorId, pausada, agora }) {
      return transacao(banco, () => {
        const anterior = banco
          .prepare("SELECT * FROM gmail_contas WHERE id=?")
          .get(contaId);
        if (!anterior) return null;
        if (!pausada && anterior.status_autorizacao !== "conectada")
          throw new Error("Conta Gmail ainda não autorizada.");
        banco
          .prepare(
            `UPDATE gmail_contas SET pausada=?,
          atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(pausada ? 1 : 0, contaId);
        if (pausada) {
          for (const tabela of ["gmail_mensagens", "gmail_anexos"])
            banco
              .prepare(
                `UPDATE ${tabela} SET estado='pendente', lease_token=NULL,
              lease_ate=NULL, atualizado_em=CURRENT_TIMESTAMP
              WHERE conta_id=? AND estado='em_processamento'`,
              )
              .run(contaId);
        }
        if (Boolean(anterior.pausada) !== pausada)
          banco
            .prepare(
              `INSERT INTO gmail_auditoria
            (conta_id,administrador_id,acao,criado_em) VALUES (?,?,?,?)`,
            )
            .run(
              contaId,
              administradorId,
              pausada ? "pausou" : "retomou",
              agora,
            );
        return banco
          .prepare("SELECT * FROM gmail_contas WHERE id=?")
          .get(contaId);
      });
    },

    listarPublico() {
      return banco
        .prepare(
          `SELECT c.id,c.email,c.data_inicio,c.status_autorizacao,c.pausada,
        g.email_verificado AS identidade_verificada,g.autorizado_em
        FROM gmail_contas c LEFT JOIN gmail_credenciais g ON g.conta_id=c.id
        ORDER BY c.id`,
        )
        .all();
    },
  };
}
