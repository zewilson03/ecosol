import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { obterBanco } from "../bancoDeDados.mjs";
import { sessaoAtual } from "../autenticacao.mjs";
import { identificarAdministrador } from "../permissoesDaEquipe.mjs";
import { chaveDeCriptografia, cifrarRefreshToken } from "./credenciais.mjs";
import { criarClienteGoogle, ESCOPO_GMAIL } from "./google.mjs";
import { criarRepositorioGmail } from "./repositorio.mjs";
import { criarRepositorioOAuthGmail } from "./oauthRepositorio.mjs";
import { criarSincronizadorGmail } from "./sincronizar.mjs";
import {
  classificarDocumentoGmail,
  listarTriagemGmail,
  obterPdfTriagemGmail,
} from "./triagem.mjs";

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
  sincronizador = criarSincronizadorGmail(),
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

  rotas.get("/api/admin/gmail/contas/:id/progresso", (requisicao, resposta) => {
    const contaId = idValido(requisicao.params.id);
    if (!contaId) return resposta.status(400).json({ erro: "Conta inválida." });
    try {
      const repo = criarRepositorioGmail(banco());
      const progresso = repo.obterProgresso(contaId);
      resposta.set("Cache-Control", "no-store");
      return resposta.json({
        fase: progresso.fase,
        ultimaPaginaEm: progresso.ultima_pagina_em,
        ultimaConclusaoEm: progresso.ultima_conclusao_em,
        ultimaExecucaoEm: progresso.ultima_execucao_em,
        ultimoErroCodigo: progresso.ultimo_erro_codigo,
        emAndamento: sincronizador.emAndamento(contaId),
        mensagens: repo.contarEstadosMensagens(contaId),
        anexos: repo.contarEstados(contaId),
      });
    } catch {
      return resposta.status(404).json({ erro: "Conta inexistente." });
    }
  });

  rotas.post(
    "/api/admin/gmail/contas/:id/sincronizar",
    (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      if (!contaId)
        return resposta.status(400).json({ erro: "Conta inválida." });
      let conta;
      try {
        conta = criarRepositorioGmail(banco()).obterConta(contaId);
      } catch {
        return resposta.status(404).json({ erro: "Conta inexistente." });
      }
      if (conta.status_autorizacao !== "conectada" || conta.pausada)
        return resposta
          .status(409)
          .json({ erro: "Reative a conta antes de sincronizar." });
      if (sincronizador.emAndamento(contaId))
        return resposta
          .status(409)
          .json({ erro: "Sincronização já em andamento." });
      void sincronizador.sincronizar(contaId).catch(() => {
        // O código sanitizado da falha é gravado no progresso para consulta.
      });
      return resposta.status(202).json({ iniciada: true });
    },
  );

  rotas.get(
    "/api/admin/gmail/contas/:id/pendencias",
    (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      if (!contaId)
        return resposta.status(400).json({ erro: "Conta inválida." });
      try {
        const repo = criarRepositorioGmail(banco());
        repo.obterConta(contaId);
        const carregar = (tabela, aposParam, incluirParam) => {
          if (incluirParam === "0") return { itens: [], proximo: null };
          if (incluirParam !== undefined && incluirParam !== "1")
            throw new Error("Consulta inválida.");
          const apos = aposParam === undefined ? 0 : Number(aposParam);
          if (!Number.isSafeInteger(apos) || apos < 0)
            throw new Error("Consulta inválida.");
          const itens = banco()
            .prepare(
              `SELECT id,estado,erro_codigo${tabela === "gmail_anexos" ? ",nome" : ""}
               FROM ${tabela} WHERE conta_id=? AND id>?
                 AND estado IN ('pendente_manual','falha_temporaria')
               ORDER BY id LIMIT 51`,
            )
            .all(contaId, apos);
          const mais = itens.length > 50;
          const pagina = itens.slice(0, 50);
          return { itens: pagina, proximo: mais ? pagina.at(-1).id : null };
        };
        const mensagens = carregar(
          "gmail_mensagens",
          requisicao.query.aposMensagem,
          requisicao.query.incluirMensagem,
        );
        const anexos = carregar(
          "gmail_anexos",
          requisicao.query.aposAnexo,
          requisicao.query.incluirAnexo,
        );
        resposta.set("Cache-Control", "no-store");
        return resposta.json({
          mensagens: mensagens.itens.map((item) => ({
            id: item.id,
            estado: item.estado,
            erroCodigo: item.erro_codigo,
          })),
          anexos: anexos.itens.map((item) => ({
            id: item.id,
            nome: item.nome,
            estado: item.estado,
            erroCodigo: item.erro_codigo,
          })),
          proximaMensagem: mensagens.proximo,
          proximoAnexo: anexos.proximo,
        });
      } catch (erro) {
        return resposta
          .status(erro.message === "Consulta inválida." ? 400 : 404)
          .json({
            erro:
              erro.message === "Consulta inválida."
                ? erro.message
                : "Conta inexistente.",
          });
      }
    },
  );

  rotas.get("/api/admin/gmail/contas/:id/triagem", (requisicao, resposta) => {
    const contaId = idValido(requisicao.params.id);
    const antes = requisicao.query.antes;
    const antesId = antes === undefined ? null : idValido(antes);
    if (!contaId || (antes !== undefined && !antesId))
      return resposta.status(400).json({ erro: "Consulta inválida." });
    try {
      criarRepositorioGmail(banco()).obterConta(contaId);
      resposta.set("Cache-Control", "no-store");
      return resposta.json(listarTriagemGmail(banco(), contaId, antesId));
    } catch {
      return resposta.status(404).json({ erro: "Conta inexistente." });
    }
  });

  rotas.get(
    "/api/admin/gmail/contas/:id/triagem/:documentoId/pdf",
    (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      const documentoId = idValido(requisicao.params.documentoId);
      if (!contaId || !documentoId)
        return resposta.status(400).json({ erro: "Documento inválido." });
      const pdf = obterPdfTriagemGmail(banco(), contaId, documentoId);
      if (!pdf)
        return resposta.status(404).json({ erro: "Documento inexistente." });
      return resposta
        .set({
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="triagem-${documentoId}.pdf"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        })
        .send(Buffer.from(pdf));
    },
  );

  rotas.post(
    "/api/admin/gmail/contas/:id/triagem/:documentoId/classificacao",
    (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      const documentoId = idValido(requisicao.params.documentoId);
      if (!contaId || !documentoId)
        return resposta.status(400).json({ erro: "Documento inválido." });
      try {
        const resultado = classificarDocumentoGmail({
          banco: banco(),
          contaId,
          documentoId,
          versao: requisicao.body?.versao,
          destino: requisicao.body?.destino,
          administrador: requisicao.acessoGmail.administrador,
        });
        resposta.set("Cache-Control", "no-store");
        return resposta.json(resultado);
      } catch (erro) {
        if (["versao_invalida", "destino_invalido"].includes(erro.message))
          return resposta.status(400).json({ erro: "Classificação inválida." });
        if (erro.message === "documento_indisponivel")
          return resposta.status(404).json({ erro: "Documento inexistente." });
        if (
          [
            "versao_obsoleta",
            "classificacao_inalterada",
            "estado_financeiro_incompativel",
          ].includes(erro.message)
        )
          return resposta
            .status(409)
            .json({ erro: "Documento alterado; atualize a triagem." });
        return resposta.status(500).json({ erro: "Falha na classificação." });
      }
    },
  );

  for (const tipo of ["mensagens", "anexos"]) {
    rotas.post(
      `/api/admin/gmail/contas/:id/${tipo}/:itemId/tentar-novamente`,
      (requisicao, resposta) => {
        const contaId = idValido(requisicao.params.id);
        const itemId = idValido(requisicao.params.itemId);
        if (!contaId || !itemId)
          return resposta.status(400).json({ erro: "Item inválido." });
        try {
          const db = banco();
          const tabela =
            tipo === "mensagens" ? "gmail_mensagens" : "gmail_anexos";
          const item = db
            .prepare(`SELECT conta_id FROM ${tabela} WHERE id=?`)
            .get(itemId);
          if (!item || item.conta_id !== contaId)
            return resposta.status(404).json({ erro: "Item inexistente." });
          const repo = criarRepositorioGmail(db);
          if (tipo === "mensagens") repo.reagendarMensagem(itemId);
          else repo.reagendarAnexo(itemId);
          return resposta.json({ reagendado: true });
        } catch {
          return resposta
            .status(409)
            .json({ erro: "O item não admite nova tentativa." });
        }
      },
    );
  }

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

export const sincronizadorGmail = criarSincronizadorGmail();
export const rotasGmail = criarRotasGmail({
  sincronizador: sincronizadorGmail,
});
