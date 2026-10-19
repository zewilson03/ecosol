import { randomUUID } from "node:crypto";
import { obterBanco } from "../bancoDeDados.mjs";
import {
  limitarTentativas,
  resumoCriptografico,
  senhaConfere,
  sessaoAtual,
} from "../autenticacao.mjs";
import { temPapelCritico } from "./permissoes.mjs";

const prazoPedidoMs = 24 * 60 * 60_000;

function falha(res, status, mensagem) {
  return res.status(status).json({ erro: mensagem });
}

function sessaoNominal(req) {
  const sessao = sessaoAtual(req);
  return sessao?.role === "staff" && sessao.staff_id === req.administrador?.id
    ? sessao
    : null;
}

function transacao(banco, acao) {
  banco.exec("BEGIN IMMEDIATE");
  try {
    const resultado = acao();
    banco.exec("COMMIT");
    return resultado;
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

export function registrarEventoRecuperacao(banco, pedidoId, atorId, evento) {
  banco
    .prepare(
      `INSERT INTO bancario_mfa_auditoria_recuperacao
       (pedido_id,ator_id,evento,criado_em) VALUES(?,?,?,?)`,
    )
    .run(pedidoId, atorId, evento, Date.now());
}

export function recuperacaoAprovada(banco, pedidoId, staffId) {
  const pedido = banco
    .prepare(
      `SELECT r.*,s.password_hash FROM bancario_mfa_pedidos_recuperacao r
       JOIN staff_users s ON s.id=r.staff_id WHERE r.id=? AND r.staff_id=?`,
    )
    .get(pedidoId, staffId);
  if (
    !pedido ||
    pedido.estado !== "aprovado" ||
    pedido.expira_em <= Date.now() ||
    pedido.senha_hash !== pedido.password_hash ||
    Number(temPapelCritico(staffId, "proprietario")) !== pedido.exige_guardiao
  )
    return false;
  const aprovacoes = banco
    .prepare(
      `SELECT a.aprovador_id,a.papel,a.autenticador_id,
              m.segredo_cifrado,s.access_level,p.papel AS papel_atual
       FROM bancario_mfa_aprovacoes_recuperacao a
       LEFT JOIN equipe_papeis_criticos p ON p.staff_id=a.aprovador_id
       LEFT JOIN bancario_mfa_equipe m ON m.staff_id=a.aprovador_id
       LEFT JOIN staff_users s ON s.id=a.aprovador_id
       WHERE a.pedido_id=?`,
    )
    .all(pedidoId);
  const validas = aprovacoes.filter(
    (aprovacao) =>
      aprovacao.aprovador_id !== staffId &&
      aprovacao.papel === aprovacao.papel_atual &&
      (aprovacao.papel !== "proprietario" || aprovacao.access_level === 3) &&
      aprovacao.segredo_cifrado &&
      resumoCriptografico(aprovacao.segredo_cifrado) ===
        aprovacao.autenticador_id,
  );
  return pedido.exige_guardiao
    ? validas.some((item) => item.papel === "proprietario") &&
        validas.some((item) => item.papel === "guardiao_recuperacao")
    : validas.filter((item) => item.papel === "proprietario").length >= 2;
}

export async function solicitarRecuperacaoMfa(req, res) {
  const sessao = sessaoNominal(req);
  if (!sessao) return falha(res, 403, "Use uma conta nominal da equipe.");
  const senha = req.body?.senha;
  if (typeof senha !== "string" || !senha || senha.length > 128)
    return falha(res, 400, "Informe sua senha atual.");
  if (limitarTentativas(`bancario-mfa-recuperar:${sessao.staff_id}`, 5))
    return falha(res, 429, "Muitas tentativas. Aguarde 15 minutos.");
  const banco = obterBanco();
  const pessoa = banco
    .prepare("SELECT password_hash FROM staff_users WHERE id=?")
    .get(sessao.staff_id);
  if (!pessoa || !(await senhaConfere(senha, pessoa.password_hash)))
    return falha(res, 401, "Senha incorreta.");
  if (
    !banco
      .prepare(
        "SELECT 1 FROM bancario_mfa_equipe WHERE staff_id=? AND segredo_cifrado IS NOT NULL",
      )
      .get(sessao.staff_id)
  )
    return falha(res, 409, "Esta conta ainda não possui MFA ativo.");
  const agora = Date.now();
  const resultado = transacao(banco, () => {
    if (
      banco
        .prepare("SELECT password_hash FROM staff_users WHERE id=?")
        .get(sessao.staff_id)?.password_hash !== pessoa.password_hash
    )
      return { status: 409, erro: "Senha alterada. Solicite novamente." };
    banco
      .prepare(
        `UPDATE bancario_mfa_pedidos_recuperacao SET estado='expirado'
         WHERE staff_id=? AND estado IN ('pendente','aprovado') AND expira_em<=?`,
      )
      .run(sessao.staff_id, agora);
    const existente = banco
      .prepare(
        `SELECT id,estado,expira_em FROM bancario_mfa_pedidos_recuperacao
         WHERE staff_id=? AND estado IN ('pendente','aprovado')`,
      )
      .get(sessao.staff_id);
    if (existente) return { status: 200, dados: existente };
    const id = randomUUID();
    const expiraEm = agora + prazoPedidoMs;
    banco
      .prepare(
        `INSERT INTO bancario_mfa_pedidos_recuperacao
         (id,staff_id,senha_hash,exige_guardiao,estado,solicitado_em,expira_em)
         VALUES(?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        sessao.staff_id,
        pessoa.password_hash,
        Number(temPapelCritico(sessao.staff_id, "proprietario")),
        "pendente",
        agora,
        expiraEm,
      );
    registrarEventoRecuperacao(banco, id, sessao.staff_id, "solicitado");
    return {
      status: 201,
      dados: { id, estado: "pendente", expira_em: expiraEm },
    };
  });
  if (resultado.erro) return falha(res, resultado.status, resultado.erro);
  return res.status(resultado.status).json(resultado.dados);
}

export function listarRecuperacoesMfa(req, res) {
  const sessao = sessaoNominal(req);
  if (!sessao) return falha(res, 403, "Use uma conta nominal da equipe.");
  const proprietario = temPapelCritico(sessao.staff_id, "proprietario");
  const guardiao = temPapelCritico(sessao.staff_id, "guardiao_recuperacao");
  if (!proprietario && !guardiao)
    return falha(
      res,
      403,
      "Acesso restrito aos responsáveis pela recuperação.",
    );
  return res.json(
    obterBanco()
      .prepare(
        `SELECT r.id,r.staff_id,s.name AS pessoa,r.estado,r.exige_guardiao,
                r.solicitado_em,r.expira_em,
                (SELECT COUNT(*) FROM bancario_mfa_aprovacoes_recuperacao a
                 WHERE a.pedido_id=r.id) AS total_aprovacoes
         FROM bancario_mfa_pedidos_recuperacao r
         JOIN staff_users s ON s.id=r.staff_id
         WHERE r.estado IN ('pendente','aprovado') AND r.expira_em>?
           AND r.staff_id<>? AND (?=1 OR r.exige_guardiao=1)
         ORDER BY r.solicitado_em DESC`,
      )
      .all(Date.now(), sessao.staff_id, Number(proprietario)),
  );
}

export function minhaRecuperacaoMfa(req, res) {
  const sessao = sessaoNominal(req);
  if (!sessao) return falha(res, 403, "Use uma conta nominal da equipe.");
  const pedido = obterBanco()
    .prepare(
      `SELECT id,estado,solicitado_em,expira_em FROM bancario_mfa_pedidos_recuperacao
       WHERE staff_id=? AND estado IN ('pendente','aprovado') AND expira_em>?
       ORDER BY solicitado_em DESC LIMIT 1`,
    )
    .get(sessao.staff_id, Date.now());
  return res.json({ pedido: pedido ?? null });
}

export function aprovarRecuperacaoMfa(req, res) {
  const sessao = sessaoNominal(req);
  if (!sessao) return falha(res, 403, "Use uma conta nominal da equipe.");
  if (req.body?.identidade_conferida_presencialmente !== true)
    return falha(res, 400, "Confirme a verificação presencial da identidade.");
  const papel = temPapelCritico(sessao.staff_id, "proprietario")
    ? "proprietario"
    : temPapelCritico(sessao.staff_id, "guardiao_recuperacao")
      ? "guardiao_recuperacao"
      : null;
  if (!papel) return falha(res, 403, "Você não pode aprovar recuperações.");
  const pedidoId = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/.test(pedidoId))
    return falha(res, 400, "Pedido de recuperação inválido.");
  const banco = obterBanco();
  const resultado = transacao(banco, () => {
    const pedido = banco
      .prepare(
        `SELECT r.*,s.password_hash FROM bancario_mfa_pedidos_recuperacao r
         JOIN staff_users s ON s.id=r.staff_id WHERE r.id=?`,
      )
      .get(pedidoId);
    if (!pedido) return { status: 404, erro: "Pedido não encontrado." };
    if (
      pedido.estado !== "pendente" ||
      pedido.expira_em <= Date.now() ||
      pedido.senha_hash !== pedido.password_hash ||
      Number(temPapelCritico(pedido.staff_id, "proprietario")) !==
        pedido.exige_guardiao
    )
      return { status: 409, erro: "Pedido expirado ou alterado." };
    if (pedido.staff_id === sessao.staff_id)
      return { status: 403, erro: "Você não pode aprovar sua recuperação." };
    if (papel === "guardiao_recuperacao" && !pedido.exige_guardiao)
      return {
        status: 403,
        erro: "Guardião só aprova recuperação do Proprietário.",
      };
    const mfa = banco
      .prepare(
        "SELECT segredo_cifrado FROM bancario_mfa_equipe WHERE staff_id=?",
      )
      .get(sessao.staff_id)?.segredo_cifrado;
    if (!mfa)
      return { status: 409, erro: "Ative seu próprio MFA antes de aprovar." };
    const gravacao = banco
      .prepare(
        `INSERT OR IGNORE INTO bancario_mfa_aprovacoes_recuperacao
         (pedido_id,aprovador_id,papel,autenticador_id,confirmado_em)
         VALUES(?,?,?,?,?)`,
      )
      .run(
        pedidoId,
        sessao.staff_id,
        papel,
        resumoCriptografico(mfa),
        Date.now(),
      );
    if (gravacao.changes)
      registrarEventoRecuperacao(banco, pedidoId, sessao.staff_id, "aprovado");
    const aprovacoes = banco
      .prepare(
        `SELECT papel,COUNT(*) AS total FROM bancario_mfa_aprovacoes_recuperacao
         WHERE pedido_id=? GROUP BY papel`,
      )
      .all(pedidoId);
    const donos =
      aprovacoes.find((item) => item.papel === "proprietario")?.total ?? 0;
    const guardioes =
      aprovacoes.find((item) => item.papel === "guardiao_recuperacao")?.total ??
      0;
    const pronta = pedido.exige_guardiao
      ? donos >= 1 && guardioes >= 1
      : donos >= 2;
    if (pronta) {
      banco
        .prepare(
          "UPDATE bancario_mfa_pedidos_recuperacao SET estado='aprovado' WHERE id=? AND estado='pendente'",
        )
        .run(pedidoId);
      registrarEventoRecuperacao(banco, pedidoId, sessao.staff_id, "pronto");
    }
    return {
      status: 200,
      dados: { id: pedidoId, estado: pronta ? "aprovado" : "pendente" },
    };
  });
  if (resultado.erro) return falha(res, resultado.status, resultado.erro);
  return res.status(resultado.status).json(resultado.dados);
}
