import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Router } from "express";
import { obterBanco } from "../bancoDeDados.mjs";
import { sessaoAtual } from "../autenticacao.mjs";
import { identificarAdministrador } from "../permissoesDaEquipe.mjs";
import { chaveDeCriptografia, cifrarRefreshToken } from "./credenciais.mjs";
import { criarClienteGoogle, ESCOPO_GMAIL } from "./google.mjs";
import { criarRepositorioGmail } from "./repositorio.mjs";
import { criarRepositorioOAuthGmail } from "./oauthRepositorio.mjs";
import {
  atalhoDiarioOitoHoras,
  criarSincronizadorGmail,
  validarPeriodoRecebimento,
} from "./sincronizar.mjs";
import {
  classificarDocumentoGmail,
  classificarDocumentosGmail,
  excluirDocumentosGmail,
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

function mesDoVencimento(vencimento, competencia) {
  const meses = [
    "JAN",
    "FEV",
    "MAR",
    "ABR",
    "MAI",
    "JUN",
    "JUL",
    "AGO",
    "SET",
    "OUT",
    "NOV",
    "DEZ",
  ];
  const data = String(vencimento ?? "");
  const encontrado = /^(20\d{2})-(0[1-9]|1[0-2])-\d{2}$/.exec(data);
  if (encontrado) return meses[Number(encontrado[2]) - 1];
  const competenciaValida = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(
    String(competencia ?? ""),
  );
  return competenciaValida ? meses[Number(competenciaValida[2]) - 1] : "FAT";
}

const pastaDoProjeto = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const executarArquivo = promisify(execFile);
const documentosDaSimulacaoCentral = new Set([685, 686, 689, 690, 698]);
const codigoFonteCentralPadrao =
  "C:\\Users\\User\\Desktop\\00 - Central de Faturas Ecosol\\_SUPORTE_ORGANIZACAO\\ARQUIVOS_RETIRADOS_DA_RAIZ_20260917\\CODIGO_FONTE_V146";
const planilhasAtualizadasPadrao =
  "G:\\.shortcut-targets-by-id\\1WBX1jPldTDgAie6u0FujV9L6xWIjRtdx\\01 - Usinas Goiás\\00 - Planilhas Atualizadas";

function ultimoJsonDaSaida(saida) {
  for (const linha of String(saida ?? "")
    .split(/\r?\n/)
    .reverse()) {
    if (!linha.trim()) continue;
    try {
      return JSON.parse(linha);
    } catch {
      // O motor Python pode emitir avisos antes do resultado estruturado.
    }
  }
  throw new Error("simulacao_central_sem_resultado");
}

async function executarSimulacaoCentral({ documentos }) {
  const codigoFonte =
    process.env.ECOSOL_CENTRAL_CODIGO_FONTE ?? codigoFonteCentralPadrao;
  const planilhas =
    process.env.ECOSOL_PLANILHAS_ATUALIZADAS ?? planilhasAtualizadasPadrao;
  const { stdout } = await executarArquivo(
    process.env.ECOSOL_PYTHON ?? "python",
    [
      join(pastaDoProjeto, "backend", "scripts", "previaNomeadorCentral.py"),
      "--simular",
      "--banco",
      join(pastaDoProjeto, "backend", "data", "ecosol.db"),
      "--documentos",
      documentos.join(","),
      "--motor",
      join(codigoFonte, "nomeador_engine.py"),
      "--atualizador",
      join(codigoFonte, "atualizador_engine.py"),
      "--pasta-vendas",
      planilhas,
    ],
    { windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
  );
  const resultado = ultimoJsonDaSaida(stdout);
  if (!Array.isArray(resultado?.resultados))
    throw new Error("simulacao_central_invalida");
  return resultado;
}

async function gerarPreviaCentralTemporaria({ documento, simulacao }) {
  const codigoFonte =
    process.env.ECOSOL_CENTRAL_CODIGO_FONTE ?? codigoFonteCentralPadrao;
  const planilhas =
    process.env.ECOSOL_PLANILHAS_ATUALIZADAS ?? planilhasAtualizadasPadrao;
  const pastaTemporaria = await mkdtemp(
    join(tmpdir(), "ecosol-previa-central-"),
  );
  const destino = join(pastaTemporaria, `documento-${documento}.pdf`);
  const limpar = () => rm(pastaTemporaria, { recursive: true, force: true });
  try {
    const { stdout } = await executarArquivo(
      process.env.ECOSOL_PYTHON ?? "python",
      [
        join(pastaDoProjeto, "backend", "scripts", "previaNomeadorCentral.py"),
        "--banco",
        join(pastaDoProjeto, "backend", "data", "ecosol.db"),
        "--documento",
        String(documento),
        "--motor",
        join(codigoFonte, "nomeador_engine.py"),
        "--atualizador",
        join(codigoFonte, "atualizador_engine.py"),
        "--pasta-vendas",
        planilhas,
        "--saida",
        destino,
        "--uc-antiga",
        simulacao.ucAntiga,
        "--cliente",
        simulacao.cliente,
        "--usina",
        simulacao.usina,
      ],
      { windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const resultado = ultimoJsonDaSaida(stdout);
    const arquivo = resolve(resultado?.saida ?? "");
    const nome = resultado?.nomeFinal;
    if (
      !resultado?.boleto?.valorCalculadoCentral ||
      resultado.boleto.valorCalculadoCentral !== simulacao.valorBoleto ||
      typeof nome !== "string" ||
      nome !== basename(arquivo) ||
      !arquivo.startsWith(resolve(pastaTemporaria) + "\\") ||
      !existsSync(arquivo)
    )
      throw new Error("previa_central_diverge_da_simulacao");
    return { arquivo, nome, limpar };
  } catch (erro) {
    await limpar();
    throw erro;
  }
}
function irParaPainel(resposta, resultado) {
  resposta.set("Cache-Control", "no-store");
  resposta.set("Referrer-Policy", "no-referrer");
  return resposta.redirect(303, `/admin/gmail?oauth=${resultado}`);
}

function erroDaTriagem(resposta, erro, acao) {
  if (
    [
      "versao_invalida",
      "destino_invalido",
      "selecao_invalida",
      "confirmacao_invalida",
    ].includes(erro.message)
  )
    return resposta.status(400).json({ erro: "Seleção inválida." });
  if (erro.message === "documento_indisponivel")
    return resposta.status(404).json({ erro: "Documento inexistente." });
  if (erro.message === "documento_compartilhado")
    return resposta.status(409).json({
      erro: "PDF vinculado a outra caixa ou recebimento; a exclusão foi bloqueada.",
    });
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
  if (erro.message === "simulacao_central_revisar")
    return resposta.status(409).json({
      erro: "A simulação da Central exige revisão antes de encaminhar para Faturas.",
    });
  return resposta.status(500).json({ erro: `Falha na ${acao}.` });
}

export function criarRotasGmail({
  banco = obterBanco,
  configuracao = configuracaoDoAmbiente,
  clienteGoogle = criarClienteGoogle,
  agora = Date.now,
  sincronizador = criarSincronizadorGmail(),
  simuladorCentral = executarSimulacaoCentral,
  geradorPreviaCentral = gerarPreviaCentralTemporaria,
  documentosCentral = documentosDaSimulacaoCentral,
} = {}) {
  const rotas = Router();

  async function simularDocumentosDaConta(contaId, ids) {
    const unicos = [...new Set(ids)];
    const marcadores = unicos.map(() => "?").join(",");
    const existentes = banco()
      .prepare(
        `SELECT d.id FROM gmail_anexos a JOIN faturamento_documentos d ON d.id=a.documento_id
         WHERE a.conta_id=? AND a.estado='capturado' AND d.id IN (${marcadores})`,
      )
      .all(contaId, ...unicos)
      .map((item) => item.id);
    if (existentes.length !== unicos.length)
      throw new Error("documento_indisponivel");
    const resultado = await simuladorCentral({ documentos: unicos });
    const resultados = resultado?.resultados;
    if (
      !Array.isArray(resultados) ||
      resultados.length !== unicos.length ||
      unicos.some((id) => !resultados.some((item) => item?.documento === id))
    )
      throw new Error("simulacao_central_invalida");
    return resultados;
  }

  async function exigirSimulacaoAprovavel(contaId, itens, destino) {
    if (destino !== "fatura") return;
    const ids = itens
      .map((item) => idValido(item?.id ?? item))
      .filter((id) => id && documentosCentral.has(id));
    if (!ids.length) return;
    const resultados = await simularDocumentosDaConta(contaId, ids);
    if (resultados.some((item) => item.situacao !== "simulada"))
      throw new Error("simulacao_central_revisar");
  }
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

  rotas.get("/api/admin/gmail/periodo-diario", (_requisicao, resposta) => {
    resposta.set("Cache-Control", "no-store");
    resposta.json(atalhoDiarioOitoHoras(agora()));
  });

  function contaAptaParaCaptura(contaId, resposta) {
    if (!contaId) {
      resposta.status(400).json({ erro: "Conta inválida." });
      return null;
    }
    try {
      const conta = criarRepositorioGmail(banco()).obterConta(contaId);
      if (conta.status_autorizacao !== "conectada" || conta.pausada) {
        resposta
          .status(409)
          .json({ erro: "Reative a conta antes de sincronizar." });
        return null;
      }
      if (sincronizador.emAndamento(contaId)) {
        resposta.status(409).json({ erro: "Sincronização já em andamento." });
        return null;
      }
      return conta;
    } catch {
      resposta.status(404).json({ erro: "Conta inexistente." });
      return null;
    }
  }

  rotas.post(
    "/api/admin/gmail/contas/:id/periodo/previa",
    async (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      if (!contaAptaParaCaptura(contaId, resposta)) return;
      try {
        const previa = await sincronizador.preverPeriodo(
          contaId,
          requisicao.body?.periodo,
        );
        resposta.set("Cache-Control", "no-store");
        return resposta.json(previa);
      } catch (erro) {
        const invalido =
          /Data e hora inválidas|início deve ser anterior|Período de recebimento inválido/.test(
            String(erro?.message),
          );
        return resposta.status(invalido ? 400 : 503).json({
          erro: invalido
            ? String(erro.message)
            : "Não foi possível consultar o Gmail para este período. Verifique a conexão e tente novamente.",
        });
      }
    },
  );

  rotas.post(
    "/api/admin/gmail/contas/:id/periodo/capturar",
    (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      if (!contaAptaParaCaptura(contaId, resposta)) return;
      try {
        validarPeriodoRecebimento(requisicao.body?.periodo);
      } catch (erro) {
        return resposta.status(400).json({ erro: String(erro.message) });
      }
      void sincronizador
        .capturarPeriodo(contaId, requisicao.body?.periodo)
        .catch(() => {
          // A captura explícita não reenvia nem exclui e-mails; a falha fica no progresso.
        });
      return resposta.status(202).json({ iniciada: true });
    },
  );

  rotas.post(
    "/api/admin/gmail/contas/:id/periodo/status",
    (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      if (!contaId)
        return resposta.status(400).json({ erro: "Conta inválida." });
      try {
        const periodo = validarPeriodoRecebimento(requisicao.body?.periodo);
        const captura = criarRepositorioGmail(banco()).obterCapturaPorPeriodo({
          contaId,
          inicio: periodo.inicioLocal,
          fim: periodo.fimLocal,
        });
        return resposta.json({ captura });
      } catch (erro) {
        return resposta.status(400).json({ erro: String(erro.message) });
      }
    },
  );

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

  rotas.post(
    "/api/admin/gmail/contas/:id/anexos/:itemId/autorizar-captura",
    (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      const anexoId = idValido(requisicao.params.itemId);
      if (
        !contaId ||
        !anexoId ||
        requisicao.body?.confirmacao !== "CONFERI_NO_GMAIL"
      )
        return resposta.status(400).json({ erro: "Confirmação inválida." });
      try {
        criarRepositorioGmail(banco()).autorizarCapturaAposRevisao({
          contaId,
          anexoId,
          administradorId: requisicao.acessoGmail.administrador.id,
        });
        resposta.set("Cache-Control", "no-store");
        return resposta.json({ autorizado: true });
      } catch {
        return resposta
          .status(409)
          .json({ erro: "Anexo não está aguardando revisão no Gmail." });
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
    "/api/admin/gmail/contas/:id/triagem/conferencia",
    (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      const ids = String(requisicao.query.documentos ?? "")
        .split(",")
        .map((valor) => idValido(valor.trim()))
        .filter(Boolean);
      if (
        !contaId ||
        !ids.length ||
        ids.length > 50 ||
        new Set(ids).size !== ids.length
      )
        return resposta
          .status(400)
          .json({ erro: "Seleção de documentos inválida." });
      try {
        criarRepositorioGmail(banco()).obterConta(contaId);
        const marcadores = ids.map(() => "?").join(",");
        const itens = banco()
          .prepare(
            `SELECT a.id AS anexo_id,a.message_id,a.criado_em AS recebido_em,
          d.id,d.nome,d.dados,d.extracao,d.versao
          FROM gmail_anexos a JOIN faturamento_documentos d ON d.id=a.documento_id
          WHERE a.conta_id=? AND d.id IN (${marcadores}) AND a.estado='capturado'
          ORDER BY d.id`,
          )
          .all(contaId, ...ids)
          .map((item) => {
            const dados = JSON.parse(item.dados);
            const unidade = banco()
              .prepare(
                `SELECT u.id,u.uc,COALESCE(c.name,o.nome,p.nome) cliente,s.nome usina
            FROM faturamento_unidades u LEFT JOIN customers c ON c.id=u.cliente_id
            LEFT JOIN faturamento_clientes_operacionais o ON o.id=u.cliente_operacional_id
            LEFT JOIN faturamento_clientes_provisorios p ON p.id=u.cliente_provisorio_id
            LEFT JOIN usinas s ON s.id=u.usina_id
            WHERE u.uc=? OR u.id=(SELECT unidade_id FROM faturamento_unidades_aliases WHERE uc=?)`,
              )
              .get(dados.uc, dados.uc);
            const competencia = dados.competencia ?? null;
            const vencimento = dados.vencimento_equatorial ?? null;
            const mes = mesDoVencimento(vencimento, competencia);
            const proposto =
              unidade && competencia
                ? `Fatura EQT - ${mes} - ${unidade.usina ?? "SEM_USINA"} - ${unidade.cliente ?? "SEM_CLIENTE"} - ${dados.uc} - ${unidade.uc}.pdf`
                : null;
            return {
              id: item.id,
              anexoId: item.anexo_id,
              messageId: item.message_id,
              recebidoEm: item.recebido_em,
              nome: item.nome,
              uc: dados.uc ?? null,
              competencia,
              vencimento,
              cliente: unidade?.cliente ?? null,
              usina: unidade?.usina ?? null,
              unidadeId: unidade?.id ?? null,
              nomeProposto: proposto,
              situacao: unidade && competencia ? "vinculo_seguro" : "revisar",
              versao: item.versao,
              // PDFs de demonstração antigos não podem ser fonte financeira.
              // Uma prévia de PDF futura será gerada após a revisão, usando a
              // mesma simulação calculate_boleto exposta nesta tela.
              previaCentralDisponivel: false,
              metodo: "UC extraída do quadro principal",
            };
          });
        resposta.set("Cache-Control", "no-store");
        return resposta.json({
          itens,
          ausentes: ids.filter(
            (valor) => !itens.some((item) => item.id === valor),
          ),
        });
      } catch {
        return resposta.status(404).json({ erro: "Conta inexistente." });
      }
    },
  );

  rotas.get(
    "/api/admin/gmail/contas/:id/triagem/conferencia-central",
    async (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      const ids = String(requisicao.query.documentos ?? "")
        .split(",")
        .map((valor) => idValido(valor.trim()))
        .filter(Boolean);
      if (
        !contaId ||
        !ids.length ||
        ids.length > documentosCentral.size ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !documentosCentral.has(id))
      )
        return resposta
          .status(400)
          .json({ erro: "Seleção de documentos inválida." });
      try {
        criarRepositorioGmail(banco()).obterConta(contaId);
        const itens = await simularDocumentosDaConta(contaId, ids);
        resposta.set("Cache-Control", "no-store");
        return resposta.json({ itens });
      } catch (erro) {
        if (erro.message === "documento_indisponivel")
          return resposta.status(404).json({ erro: "Documento inexistente." });
        return resposta.status(503).json({
          erro: "Não foi possível concluir a simulação da Central. Tente novamente.",
        });
      }
    },
  );

  // A prévia é temporária e deriva do mesmo calculate_boleto usado na revisão.
  rotas.get(
    "/api/admin/gmail/contas/:id/triagem/:documentoId/previa-central",
    async (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      const documentoId = idValido(requisicao.params.documentoId);
      if (!contaId || !documentosCentral.has(documentoId))
        return resposta.status(404).json({ erro: "Prévia indisponível." });
      const existe = banco()
        .prepare(
          `SELECT 1 FROM gmail_anexos
            WHERE conta_id=? AND documento_id=? AND estado='capturado'`,
        )
        .get(contaId, documentoId);
      if (!existe)
        return resposta.status(404).json({ erro: "Prévia indisponível." });
      let previa;
      try {
        const [simulacao] = await simularDocumentosDaConta(contaId, [
          documentoId,
        ]);
        if (simulacao.situacao !== "simulada")
          return resposta.status(409).json({
            erro: "A simulação da Central exige revisão antes de gerar a prévia.",
          });
        previa = await geradorPreviaCentral({
          documento: documentoId,
          simulacao,
        });
        resposta.set({
          "Cache-Control": "no-store",
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(previa.nome)}`,
          "Content-Type": "application/pdf",
          "X-Content-Type-Options": "nosniff",
        });
        return resposta.sendFile(previa.arquivo, async (erro) => {
          await previa.limpar();
          if (erro && !resposta.headersSent)
            resposta.status(500).json({ erro: "Falha ao abrir a prévia." });
        });
      } catch {
        await previa?.limpar();
        return resposta.status(503).json({
          erro: "Não foi possível gerar a prévia atual da Central.",
        });
      }
    },
  );

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
    "/api/admin/gmail/contas/:id/triagem/classificacao-em-lote",
    async (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      if (!contaId)
        return resposta.status(400).json({ erro: "Conta inválida." });
      try {
        await exigirSimulacaoAprovavel(
          contaId,
          requisicao.body?.itens ?? [],
          requisicao.body?.destino,
        );
        const resultado = classificarDocumentosGmail({
          banco: banco(),
          contaId,
          itens: requisicao.body?.itens,
          destino: requisicao.body?.destino,
          administrador: requisicao.acessoGmail.administrador,
        });
        resposta.set("Cache-Control", "no-store");
        return resposta.json(resultado);
      } catch (erro) {
        return erroDaTriagem(resposta, erro, "classificação");
      }
    },
  );

  rotas.post(
    "/api/admin/gmail/contas/:id/triagem/excluir-em-lote",
    (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      if (!contaId)
        return resposta.status(400).json({ erro: "Conta inválida." });
      try {
        const resultado = excluirDocumentosGmail({
          banco: banco(),
          contaId,
          itens: requisicao.body?.itens,
          administrador: requisicao.acessoGmail.administrador,
          confirmacao: requisicao.body?.confirmacao,
        });
        resposta.set("Cache-Control", "no-store");
        return resposta.json(resultado);
      } catch (erro) {
        return erroDaTriagem(resposta, erro, "exclusão");
      }
    },
  );

  rotas.post(
    "/api/admin/gmail/contas/:id/triagem/:documentoId/classificacao",
    async (requisicao, resposta) => {
      const contaId = idValido(requisicao.params.id);
      const documentoId = idValido(requisicao.params.documentoId);
      if (!contaId || !documentoId)
        return resposta.status(400).json({ erro: "Documento inválido." });
      try {
        await exigirSimulacaoAprovavel(
          contaId,
          [documentoId],
          requisicao.body?.destino,
        );
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
        return erroDaTriagem(resposta, erro, "classificação");
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
