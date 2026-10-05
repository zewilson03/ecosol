import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { obterBanco } from "../bancoDeDados.mjs";
import { sessaoAtual } from "../autenticacao.mjs";
import { identificarAdministrador } from "../permissoesDaEquipe.mjs";
import { chaveDeCriptografia, cifrarRefreshToken } from "./credenciais.mjs";
import { criarClienteGoogle, ESCOPO_GMAIL } from "./google.mjs";
import { criarRepositorioGmail } from "./repositorio.mjs";
import { criarRepositorioOAuthGmail } from "./oauthRepositorio.mjs";

function configuracaoDoAmbiente() {
  return {
    clientId: process.env.GMAIL_OAUTH_CLIENT_ID,
    clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_OAUTH_REDIRECT_URI,
    encryptionKey: process.env.GMAIL_TOKEN_ENCRYPTION_KEY,
  };
}

function administradorNomeado(requisicao) {
  const sessao = sessaoAtual(requisicao);
  const administrador = identificarAdministrador(requisicao);
  if (
    !sessao?.id ||
    !sessao.staff_id ||
    !administrador?.id ||
    administrador.nivel < 3
  )
    return null;
  return { sessao, administrador };
}

function idValido(valor) {
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function irParaPainel(resposta, resultado) {
  resposta.set("Cache-Control", "no-store");
  resposta.set("Referrer-Policy", "no-referrer");
  return resposta.redirect(303, `/admin/gmail?oauth=${resultado}`);
}

export function criarRotasGmail({
  banco = obterBanco,
  configuracao = configuracaoDoAmbiente,
  clienteGoogle = criarClienteGoogle,
  agora = Date.now,
} = {}) {
  const rotas = Router();
  rotas.use("/api/admin/gmail", (requisicao, resposta, proximo) => {
    if (
      requisicao.originalUrl.split("?", 1)[0] ===
      "/api/admin/gmail/oauth/retorno"
    )
      return proximo();
    const acesso = administradorNomeado(requisicao);
    if (!acesso)
      return resposta
        .status(403)
        .json({ erro: "Acesso de administrador avançado necessário." });
    requisicao.acessoGmail = acesso;
    proximo();
  });

  rotas.get("/api/admin/gmail/contas", (_requisicao, resposta) => {
    const cfg = configuracao();
    let configurado = false;
    try {
      chaveDeCriptografia(cfg.encryptionKey);
      clienteGoogle(cfg);
      configurado = true;
    } catch {
      /* configuração ausente não revela segredo */
    }
    resposta.set("Cache-Control", "no-store");
    resposta.json({
      contas: criarRepositorioOAuthGmail(banco()).listarPublico(),
      configurado,
    });
  });

  rotas.post("/api/admin/gmail/contas", (requisicao, resposta) => {
    try {
      const conta = criarRepositorioGmail(banco()).cadastrarConta({
        email: requisicao.body?.email,
        dataInicio: requisicao.body?.dataInicio,
      });
      resposta.status(201).json({
        id: conta.id,
        email: conta.email,
        data_inicio: conta.data_inicio,
        status_autorizacao: conta.status_autorizacao,
        pausada: conta.pausada,
      });
    } catch (erro) {
      const entradaInvalida =
        /^(E-mail inválido|Data inicial inválida|Data inicial já configurada)/.test(
          erro?.message ?? "",
        );
      resposta.status(entradaInvalida ? 400 : 503).json({
        erro: entradaInvalida
          ? "Confira o e-mail e a data inicial; uma conta existente mantém sua data original."
          : "Não foi possível salvar a conta Gmail. Tente novamente.",
      });
    }
  });

  rotas.post("/api/admin/gmail/contas/:id/conectar", (requisicao, resposta) => {
    const contaId = idValido(requisicao.params.id);
    if (!contaId) return resposta.status(400).json({ erro: "Conta inválida." });
    try {
      const cfg = configuracao();
      chaveDeCriptografia(cfg.encryptionKey);
      const google = clienteGoogle(cfg);
      const repo = criarRepositorioGmail(banco());
      const conta = repo.obterConta(contaId);
      const state = randomBytes(32).toString("base64url");
      const verificador = randomBytes(32).toString("base64url");
      const desafio = createHash("sha256")
        .update(verificador)
        .digest("base64url");
      const url = google.urlDeAutorizacao({
        state,
        desafio,
        email: conta.email,
      });
      criarRepositorioOAuthGmail(banco()).iniciar({
        contaId,
        sessaoId: requisicao.acessoGmail.sessao.id,
        state,
        verificador,
        agora: agora(),
      });
      resposta.set("Cache-Control", "no-store");
      resposta.json({ url });
    } catch (erro) {
      const ausente = erro?.message === "Conta Gmail inexistente.";
      resposta.status(ausente ? 404 : 503).json({
        erro: ausente
          ? "Conta Gmail inexistente."
          : "Não foi possível iniciar a conexão Gmail. Confira a configuração do Google Cloud.",
      });
    }
  });

  rotas.post("/api/admin/gmail/contas/:id/pausa", (requisicao, resposta) => {
    const contaId = idValido(requisicao.params.id);
    if (!contaId || typeof requisicao.body?.pausada !== "boolean")
      return resposta.status(400).json({ erro: "Pausa inválida." });
    try {
      const conta = criarRepositorioOAuthGmail(banco()).registrarPausa({
        contaId,
        pausada: requisicao.body.pausada,
        administradorId: requisicao.acessoGmail.administrador.id,
        agora: agora(),
      });
      if (!conta)
        return resposta.status(404).json({ erro: "Conta inexistente." });
      resposta.json({
        id: conta.id,
        pausada: conta.pausada,
        status_autorizacao: conta.status_autorizacao,
      });
    } catch (erro) {
      const semAutorizacao =
        erro?.message === "Conta Gmail ainda não autorizada.";
      resposta.status(semAutorizacao ? 409 : 503).json({
        erro: semAutorizacao
          ? "A conta precisa estar conectada antes de ser retomada."
          : "Não foi possível alterar a pausa da conta. Tente novamente.",
      });
    }
  });

  rotas.get("/api/admin/gmail/oauth/retorno", async (requisicao, resposta) => {
    resposta.set("Cache-Control", "no-store");
    resposta.set("Referrer-Policy", "no-referrer");
    const acesso = administradorNomeado(requisicao);
    if (!acesso) return irParaPainel(resposta, "expirada");
    const { state, code, error } = requisicao.query;
    if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state))
      return irParaPainel(resposta, "falha");
    let repo;
    let tentativa;
    try {
      repo = criarRepositorioOAuthGmail(banco());
      tentativa = repo.reivindicar({
        state,
        sessaoId: acesso.sessao.id,
        agora: agora(),
      });
    } catch {
      return irParaPainel(resposta, "falha");
    }
    if (!tentativa) return irParaPainel(resposta, "falha");
    if (error === "access_denied") {
      try {
        repo.descartar(tentativa.state_hash);
      } catch {
        /* tentativa expira */
      }
      return irParaPainel(resposta, "recusada");
    }
    if (
      typeof code !== "string" ||
      !code ||
      code.length > 4096 ||
      error !== undefined
    ) {
      try {
        repo.descartar(tentativa.state_hash);
      } catch {
        /* tentativa expira */
      }
      return irParaPainel(resposta, "falha");
    }
    try {
      const cfg = configuracao();
      const chave = chaveDeCriptografia(cfg.encryptionKey);
      const google = clienteGoogle(cfg);
      const tokens = await google.trocarCodigo({
        code,
        verificador: tentativa.verificador_pkce,
      });
      if (
        !String(tokens.escopo ?? "")
          .split(/\s+/)
          .includes(ESCOPO_GMAIL)
      )
        throw new Error("Escopo Gmail insuficiente.");
      const email = await google.obterPerfil(tokens.accessToken);
      const conta = criarRepositorioGmail(banco()).obterConta(
        tentativa.conta_id,
      );
      if (email !== conta.email)
        throw new Error("Conta Google diferente da configurada.");
      const acessoAtual = administradorNomeado(requisicao);
      if (!acessoAtual || acessoAtual.sessao.id !== acesso.sessao.id) {
        try {
          repo.descartar(tentativa.state_hash);
        } catch {
          /* tentativa expira */
        }
        return irParaPainel(resposta, "expirada");
      }
      const tokenCifrado = cifrarRefreshToken(
        tokens.refreshToken,
        conta.id,
        chave,
      );
      const concluiu = repo.concluir({
        tentativa,
        email,
        escopo: tokens.escopo,
        tokenCifrado,
        administradorId: acessoAtual.administrador.id,
        agora: agora(),
      });
      return irParaPainel(resposta, concluiu ? "conectada" : "falha");
    } catch {
      try {
        repo.descartar(tentativa.state_hash);
      } catch {
        /* tentativa expira */
      }
      return irParaPainel(resposta, "falha");
    }
  });

  return rotas;
}

export const rotasGmail = criarRotasGmail();
