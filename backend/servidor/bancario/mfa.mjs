import { randomBytes } from "node:crypto";
import { obterBanco } from "../bancoDeDados.mjs";
import {
  limitarTentativas,
  resumoCriptografico,
  senhaConfere,
  sessaoAtual,
} from "../autenticacao.mjs";
import {
  cifrarSegredoTotp,
  decifrarSegredoTotp,
  gerarSegredoTotp,
  verificarTotp,
} from "./totp.mjs";
import {
  recuperacaoAprovada,
  registrarEventoRecuperacao,
} from "./recuperacaoMfa.mjs";

const prazoAtivacaoMs = 10 * 60_000;

function identificacao(req) {
  const sessao = sessaoAtual(req);
  return sessao?.role === "staff" && sessao.staff_id === req.administrador?.id
    ? sessao
    : null;
}

function falha(res, status, mensagem) {
  return res.status(status).json({ erro: mensagem });
}

export function estadoMfa(req, res) {
  const sessao = identificacao(req);
  if (!sessao) return falha(res, 403, "Use uma conta nominal da equipe.");
  const banco = obterBanco();
  const registro = banco
    .prepare(
      `SELECT segredo_cifrado IS NOT NULL AS ativo,
              pendente_ate,pendente_sessao_id
       FROM bancario_mfa_equipe WHERE staff_id=?`,
    )
    .get(sessao.staff_id);
  return res.json({
    ativo: Boolean(registro?.ativo),
    pendente: Boolean(
      registro?.pendente_ate > Date.now() &&
      registro.pendente_sessao_id === sessao.id,
    ),
    codigos_recuperacao_restantes: banco
      .prepare(
        "SELECT COUNT(*) AS total FROM bancario_mfa_recuperacao WHERE staff_id=? AND usado_em IS NULL",
      )
      .get(sessao.staff_id).total,
  });
}

export function mfaAtivo(staffId) {
  return Boolean(
    obterBanco()
      .prepare(
        "SELECT 1 FROM bancario_mfa_equipe WHERE staff_id=? AND segredo_cifrado IS NOT NULL",
      )
      .get(staffId),
  );
}

export function identificadorMfa(staffId) {
  const cifrado = obterBanco()
    .prepare("SELECT segredo_cifrado FROM bancario_mfa_equipe WHERE staff_id=?")
    .get(staffId)?.segredo_cifrado;
  return cifrado ? resumoCriptografico(cifrado) : null;
}

export async function iniciarMfa(req, res) {
  const sessao = identificacao(req);
  if (!sessao) return falha(res, 403, "Use uma conta nominal da equipe.");
  const senha = req.body?.senha;
  if (typeof senha !== "string" || !senha || senha.length > 128)
    return falha(res, 400, "Informe sua senha atual.");
  const banco = obterBanco();
  const jaAtivo = banco
    .prepare(
      "SELECT 1 FROM bancario_mfa_equipe WHERE staff_id=? AND segredo_cifrado IS NOT NULL",
    )
    .get(sessao.staff_id);
  if (jaAtivo) return falha(res, 409, "MFA já está ativo nesta conta.");
  const chaveLimite = `bancario-mfa-inicio:${sessao.staff_id}`;
  if (limitarTentativas(chaveLimite, 5))
    return falha(res, 429, "Muitas tentativas. Aguarde 15 minutos.");
  const pessoa = banco
    .prepare("SELECT email,password_hash FROM staff_users WHERE id=?")
    .get(sessao.staff_id);
  if (!pessoa || !(await senhaConfere(senha, pessoa.password_hash)))
    return falha(res, 401, "Senha incorreta.");

  const segredo = gerarSegredoTotp();
  let cifrado;
  try {
    cifrado = cifrarSegredoTotp(segredo, sessao.staff_id);
  } catch {
    return falha(res, 503, "A configuração do MFA no servidor está pendente.");
  }
  const expiraEm = Date.now() + prazoAtivacaoMs;
  banco.exec("BEGIN IMMEDIATE");
  try {
    if (
      banco
        .prepare("SELECT password_hash FROM staff_users WHERE id=?")
        .get(sessao.staff_id)?.password_hash !== pessoa.password_hash
    ) {
      banco.exec("ROLLBACK");
      return falha(res, 409, "Senha alterada. Inicie novamente.");
    }
    // O segundo teste evita substituir um MFA ativado em outra sessão.
    if (
      banco
        .prepare(
          "SELECT 1 FROM bancario_mfa_equipe WHERE staff_id=? AND segredo_cifrado IS NOT NULL",
        )
        .get(sessao.staff_id)
    ) {
      banco.exec("ROLLBACK");
      return falha(res, 409, "MFA já está ativo nesta conta.");
    }
    banco
      .prepare(
        `INSERT INTO bancario_mfa_equipe(staff_id,pendente_cifrado,pendente_ate,pendente_sessao_id)
         VALUES(?,?,?,?)
         ON CONFLICT(staff_id) DO UPDATE SET
           pendente_cifrado=excluded.pendente_cifrado,
           pendente_ate=excluded.pendente_ate,
           pendente_sessao_id=excluded.pendente_sessao_id`,
      )
      .run(sessao.staff_id, cifrado, expiraEm, sessao.id);
    banco
      .prepare(
        "INSERT INTO bancario_mfa_auditoria(staff_id,evento) VALUES(?,'inicio')",
      )
      .run(sessao.staff_id);
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
  banco.prepare("DELETE FROM login_attempts WHERE key=?").run(chaveLimite);
  const conta = encodeURIComponent(pessoa.email);
  const url = `otpauth://totp/Ecosol:${conta}?secret=${segredo}&issuer=Ecosol&algorithm=SHA1&digits=6&period=30`;
  return res.json({ segredo, url, expira_em: expiraEm });
}

export async function substituirMfa(req, res) {
  const sessao = identificacao(req);
  if (!sessao) return falha(res, 403, "Use uma conta nominal da equipe.");
  const { senha, codigo_recuperacao: codigo } = req.body ?? {};
  if (
    typeof senha !== "string" ||
    !senha ||
    senha.length > 128 ||
    typeof codigo !== "string" ||
    !/^[A-F0-9]{20}$/.test(codigo)
  )
    return falha(
      res,
      400,
      "Informe a senha e um código de recuperação válido.",
    );
  const chaveLimite = `bancario-mfa-substituir:${sessao.staff_id}`;
  if (limitarTentativas(chaveLimite, 5))
    return falha(res, 429, "Muitas tentativas. Aguarde 15 minutos.");
  const banco = obterBanco();
  const pessoa = banco
    .prepare("SELECT email,password_hash FROM staff_users WHERE id=?")
    .get(sessao.staff_id);
  if (!pessoa || !(await senhaConfere(senha, pessoa.password_hash)))
    return falha(res, 401, "Credenciais incorretas.");
  const segredo = gerarSegredoTotp();
  let cifrado;
  try {
    cifrado = cifrarSegredoTotp(segredo, sessao.staff_id);
  } catch {
    return falha(res, 503, "A configuração do MFA no servidor está pendente.");
  }
  const hash = resumoCriptografico(`ecosol:mfa:${sessao.staff_id}:${codigo}`);
  const expiraEm = Date.now() + prazoAtivacaoMs;
  banco.exec("BEGIN IMMEDIATE");
  try {
    if (
      banco
        .prepare("SELECT password_hash FROM staff_users WHERE id=?")
        .get(sessao.staff_id)?.password_hash !== pessoa.password_hash
    ) {
      banco.exec("ROLLBACK");
      return falha(res, 409, "Senha alterada. Inicie novamente.");
    }
    const ativo = banco
      .prepare(
        "SELECT 1 FROM bancario_mfa_equipe WHERE staff_id=? AND segredo_cifrado IS NOT NULL",
      )
      .get(sessao.staff_id);
    const disponivel = banco
      .prepare(
        "SELECT 1 FROM bancario_mfa_recuperacao WHERE staff_id=? AND codigo_hash=? AND usado_em IS NULL",
      )
      .get(sessao.staff_id, hash);
    if (!ativo || !disponivel) {
      banco.exec("ROLLBACK");
      return falha(res, 401, "Credenciais incorretas.");
    }
    banco
      .prepare(
        `UPDATE bancario_mfa_equipe SET
           pendente_cifrado=?,pendente_ate=?,pendente_sessao_id=?,
           pendente_recuperacao_hash=?,pendente_recuperacao_id=NULL
         WHERE staff_id=?`,
      )
      .run(cifrado, expiraEm, sessao.id, hash, sessao.staff_id);
    banco
      .prepare(
        "INSERT INTO bancario_mfa_auditoria(staff_id,evento) VALUES(?,'substituicao_iniciada')",
      )
      .run(sessao.staff_id);
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
  banco.prepare("DELETE FROM login_attempts WHERE key=?").run(chaveLimite);
  const conta = encodeURIComponent(pessoa.email);
  return res.json({
    segredo,
    url: `otpauth://totp/Ecosol:${conta}?secret=${segredo}&issuer=Ecosol&algorithm=SHA1&digits=6&period=30`,
    expira_em: expiraEm,
  });
}

export async function iniciarMfaAposRecuperacao(req, res) {
  const sessao = identificacao(req);
  if (!sessao) return falha(res, 403, "Use uma conta nominal da equipe.");
  const senha = req.body?.senha;
  const pedidoId = req.params.id;
  if (
    typeof senha !== "string" ||
    !senha ||
    senha.length > 128 ||
    typeof pedidoId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(pedidoId)
  )
    return falha(res, 400, "Informe senha e pedido de recuperação válido.");
  const chaveLimite = `bancario-mfa-recuperacao-iniciar:${sessao.staff_id}`;
  if (limitarTentativas(chaveLimite, 5))
    return falha(res, 429, "Muitas tentativas. Aguarde 15 minutos.");
  const banco = obterBanco();
  const pessoa = banco
    .prepare("SELECT email,password_hash FROM staff_users WHERE id=?")
    .get(sessao.staff_id);
  if (!pessoa || !(await senhaConfere(senha, pessoa.password_hash)))
    return falha(res, 401, "Senha incorreta.");
  const segredo = gerarSegredoTotp();
  let cifrado;
  try {
    cifrado = cifrarSegredoTotp(segredo, sessao.staff_id);
  } catch {
    return falha(res, 503, "A configuração do MFA no servidor está pendente.");
  }
  banco.exec("BEGIN IMMEDIATE");
  try {
    if (!recuperacaoAprovada(banco, pedidoId, sessao.staff_id)) {
      banco.exec("ROLLBACK");
      return falha(
        res,
        409,
        "A recuperação não possui duas aprovações válidas.",
      );
    }
    banco
      .prepare(
        `UPDATE bancario_mfa_equipe SET pendente_cifrado=?,pendente_ate=?,
           pendente_sessao_id=?,pendente_recuperacao_hash=NULL,
           pendente_recuperacao_id=?
         WHERE staff_id=? AND segredo_cifrado IS NOT NULL`,
      )
      .run(
        cifrado,
        Math.min(
          Date.now() + prazoAtivacaoMs,
          banco
            .prepare(
              "SELECT expira_em FROM bancario_mfa_pedidos_recuperacao WHERE id=?",
            )
            .get(pedidoId).expira_em,
        ),
        sessao.id,
        pedidoId,
        sessao.staff_id,
      );
    registrarEventoRecuperacao(
      banco,
      pedidoId,
      sessao.staff_id,
      "cadastro_iniciado",
    );
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
  banco.prepare("DELETE FROM login_attempts WHERE key=?").run(chaveLimite);
  const conta = encodeURIComponent(pessoa.email);
  return res.json({
    segredo,
    url: `otpauth://totp/Ecosol:${conta}?secret=${segredo}&issuer=Ecosol&algorithm=SHA1&digits=6&period=30`,
  });
}

export function ativarMfa(req, res) {
  const sessao = identificacao(req);
  if (!sessao) return falha(res, 403, "Use uma conta nominal da equipe.");
  const codigo = req.body?.codigo;
  if (typeof codigo !== "string" || !/^\d{6}$/.test(codigo))
    return falha(res, 400, "Informe o código de seis dígitos.");
  const chaveLimite = `bancario-mfa-ativar:${sessao.staff_id}`;
  if (limitarTentativas(chaveLimite, 5))
    return falha(res, 429, "Muitas tentativas. Aguarde 15 minutos.");
  const banco = obterBanco();
  banco.exec("BEGIN IMMEDIATE");
  try {
    const registro = banco
      .prepare("SELECT * FROM bancario_mfa_equipe WHERE staff_id=?")
      .get(sessao.staff_id);
    if (
      !registro ||
      !registro.pendente_cifrado ||
      registro.pendente_ate <= Date.now() ||
      registro.pendente_sessao_id !== sessao.id ||
      Boolean(registro.segredo_cifrado) !==
        (Boolean(registro.pendente_recuperacao_hash) !==
          Boolean(registro.pendente_recuperacao_id))
    ) {
      banco.exec("ROLLBACK");
      return falha(res, 409, "Inicie novamente o cadastro do MFA.");
    }
    const segredo = decifrarSegredoTotp(
      registro.pendente_cifrado,
      sessao.staff_id,
    );
    const contador = verificarTotp(segredo, codigo);
    if (contador === null) {
      banco.exec("ROLLBACK");
      return falha(res, 400, "Código incorreto ou expirado.");
    }
    const codigos = Array.from({ length: 10 }, () =>
      randomBytes(10).toString("hex").toUpperCase(),
    );
    const substituicao = Boolean(registro.segredo_cifrado);
    if (substituicao) {
      if (registro.pendente_recuperacao_hash) {
        const usado = banco
          .prepare(
            "UPDATE bancario_mfa_recuperacao SET usado_em=CURRENT_TIMESTAMP WHERE staff_id=? AND codigo_hash=? AND usado_em IS NULL",
          )
          .run(sessao.staff_id, registro.pendente_recuperacao_hash);
        if (usado.changes !== 1) {
          banco.exec("ROLLBACK");
          return falha(
            res,
            409,
            "Código de recuperação já utilizado. Reinicie a troca.",
          );
        }
      } else if (registro.pendente_recuperacao_id) {
        if (
          !recuperacaoAprovada(
            banco,
            registro.pendente_recuperacao_id,
            sessao.staff_id,
          )
        ) {
          banco.exec("ROLLBACK");
          return falha(res, 409, "A recuperação perdeu validade.");
        }
        banco
          .prepare(
            `UPDATE bancario_mfa_pedidos_recuperacao
             SET estado='consumido',consumido_em=?
             WHERE id=? AND estado='aprovado'`,
          )
          .run(Date.now(), registro.pendente_recuperacao_id);
        registrarEventoRecuperacao(
          banco,
          registro.pendente_recuperacao_id,
          sessao.staff_id,
          "concluido",
        );
      }
      banco
        .prepare("DELETE FROM bancario_mfa_recuperacao WHERE staff_id=?")
        .run(sessao.staff_id);
    }
    banco
      .prepare(
        `UPDATE bancario_mfa_equipe SET
           segredo_cifrado=pendente_cifrado,pendente_cifrado=NULL,
           pendente_ate=NULL,pendente_sessao_id=NULL,pendente_recuperacao_hash=NULL,
           pendente_recuperacao_id=NULL,
           ultimo_contador=?,ativado_em=CURRENT_TIMESTAMP
         WHERE staff_id=?`,
      )
      .run(contador, sessao.staff_id);
    const inserir = banco.prepare(
      "INSERT INTO bancario_mfa_recuperacao(staff_id,codigo_hash) VALUES(?,?)",
    );
    for (const item of codigos)
      inserir.run(
        sessao.staff_id,
        resumoCriptografico(`ecosol:mfa:${sessao.staff_id}:${item}`),
      );
    banco
      .prepare(
        "INSERT INTO bancario_mfa_auditoria(staff_id,evento) VALUES(?,?)",
      )
      .run(sessao.staff_id, substituicao ? "substituicao" : "ativacao");
    banco.exec("COMMIT");
    banco.prepare("DELETE FROM login_attempts WHERE key=?").run(chaveLimite);
    return res.json({ ativo: true, codigos_recuperacao: codigos });
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

export function consumirSegundoFator(staffId, codigo) {
  if (typeof codigo !== "string") return false;
  const banco = obterBanco();
  banco.exec("BEGIN IMMEDIATE");
  try {
    const registro = banco
      .prepare(
        "SELECT segredo_cifrado,ultimo_contador FROM bancario_mfa_equipe WHERE staff_id=?",
      )
      .get(staffId);
    if (!registro?.segredo_cifrado) {
      banco.exec("ROLLBACK");
      return false;
    }
    let evento;
    if (/^\d{6}$/.test(codigo)) {
      const segredo = decifrarSegredoTotp(registro.segredo_cifrado, staffId);
      const contador = verificarTotp(segredo, codigo, registro.ultimo_contador);
      if (contador !== null) {
        const alteracao = banco
          .prepare(
            "UPDATE bancario_mfa_equipe SET ultimo_contador=? WHERE staff_id=? AND ultimo_contador<?",
          )
          .run(contador, staffId, contador);
        if (alteracao.changes === 1) evento = "confirmacao_totp";
      }
    } else if (/^[A-F0-9]{20}$/.test(codigo)) {
      const hash = resumoCriptografico(`ecosol:mfa:${staffId}:${codigo}`);
      const alteracao = banco
        .prepare(
          "UPDATE bancario_mfa_recuperacao SET usado_em=CURRENT_TIMESTAMP WHERE staff_id=? AND codigo_hash=? AND usado_em IS NULL",
        )
        .run(staffId, hash);
      if (alteracao.changes === 1) evento = "recuperacao";
    }
    if (!evento) {
      banco.exec("ROLLBACK");
      return false;
    }
    banco
      .prepare(
        "INSERT INTO bancario_mfa_auditoria(staff_id,evento) VALUES(?,?)",
      )
      .run(staffId, evento);
    banco.exec("COMMIT");
    return true;
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}
