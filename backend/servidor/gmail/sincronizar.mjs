import { obterBanco } from "../bancoDeDados.mjs";
import { chaveDeCriptografia, decifrarRefreshToken } from "./credenciais.mjs";
import {
  criarClienteGoogle,
  ErroGoogleGmail,
  instanteInicial,
} from "./google.mjs";
import { criarRepositorioGmail } from "./repositorio.mjs";
import { PdfGmailInvalido, receberAnexoGmail } from "./receberAnexo.mjs";
import { candidatoFaturaPeloNome } from "./identificacaoPrevia.mjs";

const LIMITE_PDF = 10 * 1024 * 1024;
const LIMITE_PARTES = 200;
const LIMITE_PROFUNDIDADE = 12;
const PAGINAS_POR_EXECUCAO = 20;
const MENSAGENS_POR_EXECUCAO = 100;
const ANEXOS_POR_EXECUCAO = 25;

function configuracao() {
  return {
    clientId: process.env.GMAIL_OAUTH_CLIENT_ID,
    clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_OAUTH_REDIRECT_URI,
    encryptionKey: process.env.GMAIL_TOKEN_ENCRYPTION_KEY,
  };
}

function codigoSeguro(erro) {
  if (erro instanceof PdfGmailInvalido) return erro.codigo;
  if (erro instanceof ErroGoogleGmail) return `google_${erro.categoria}`;
  return "falha_interna";
}

function exigeReconexao(erro) {
  return (
    erro instanceof ErroGoogleGmail &&
    (erro.categoria === "autorizacao" || erro.categoria === "permissao")
  );
}

function temporario(erro) {
  if (/^SQLITE_(BUSY|LOCKED|IOERR)/.test(String(erro?.code ?? ""))) return true;
  if (!(erro instanceof ErroGoogleGmail)) return false;
  return ["timeout", "rede", "limite", "indisponivel"].includes(erro.categoria);
}

function clienteComRenovacao(cliente, refreshToken, agora) {
  let token = null;
  let expiraEm = 0;
  async function renovar() {
    const resposta = await cliente.renovarAcesso({ refreshToken });
    token = resposta.accessToken;
    expiraEm = agora() + Math.max(1, (resposta.expiresIn ?? 3600) - 60) * 1000;
  }
  async function chamar(nome, parametros) {
    if (!token || agora() >= expiraEm) await renovar();
    const executar = () =>
      nome === "obterPerfilCompleto"
        ? cliente[nome](token)
        : cliente[nome]({ ...parametros, accessToken: token });
    try {
      return await executar();
    } catch (erro) {
      if (!(erro instanceof ErroGoogleGmail) || erro.status !== 401) throw erro;
      await renovar();
      return executar();
    }
  }
  return {
    obterPerfilCompleto: () => chamar("obterPerfilCompleto"),
    listarMensagens: (opcoes) => chamar("listarMensagens", opcoes),
    listarHistorico: (opcoes) => chamar("listarHistorico", opcoes),
    obterMensagem: (opcoes) => chamar("obterMensagem", opcoes),
    obterAnexo: (opcoes) => chamar("obterAnexo", opcoes),
  };
}

function proximaTentativa(item, agora) {
  const minutos = Math.min(5 * 2 ** Math.min(item.tentativas - 1, 8), 24 * 60);
  return agora + minutos * 60_000;
}

function partePdf(parte) {
  const nome = typeof parte.filename === "string" ? parte.filename : "";
  const mime =
    typeof parte.mimeType === "string" ? parte.mimeType.toLowerCase() : "";
  return mime === "application/pdf" || /\.pdf$/i.test(nome);
}

function nomeSeguro(nome, caminho) {
  const limpo = String(nome || `anexo-${caminho}.pdf`)
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .trim();
  return (limpo || `anexo-${caminho}.pdf`).slice(0, 255);
}

export function partesPdf(payload) {
  const anexos = [];
  let visitadas = 0;
  function visitar(parte, caminho, profundidade) {
    if (!parte || typeof parte !== "object" || Array.isArray(parte))
      throw new Error("Estrutura MIME inválida.");
    if (++visitadas > LIMITE_PARTES || profundidade > LIMITE_PROFUNDIDADE)
      throw new Error("Estrutura MIME excede o limite.");
    if (partePdf(parte)) {
      const tamanho = parte.body?.size;
      anexos.push({
        partPath: caminho,
        attachmentId: parte.body?.attachmentId ?? null,
        nome: nomeSeguro(parte.filename, caminho),
        mimeType: String(parte.mimeType || "application/pdf").slice(0, 127),
        tamanho: Number.isSafeInteger(tamanho) && tamanho >= 0 ? tamanho : null,
        dadosInline: parte.body?.data ?? null,
      });
    }
    if (parte.parts !== undefined && !Array.isArray(parte.parts))
      throw new Error("Estrutura MIME inválida.");
    for (const [indice, filho] of (parte.parts ?? []).entries())
      visitar(filho, `${caminho}.${indice}`, profundidade + 1);
  }
  visitar(payload, "0", 0);
  return anexos;
}

function decodificarBase64Url(dados, tamanho) {
  if (
    !Number.isSafeInteger(tamanho) ||
    tamanho < 0 ||
    tamanho > LIMITE_PDF ||
    typeof dados !== "string" ||
    dados.length > Math.ceil(LIMITE_PDF / 3) * 4 + 8 ||
    !/^[A-Za-z0-9_-]*={0,2}$/.test(dados)
  )
    throw new PdfGmailInvalido("pdf_limite_ou_formato");
  const arquivo = Buffer.from(dados, "base64url");
  if (arquivo.length !== tamanho)
    throw new PdfGmailInvalido("pdf_tamanho_divergente");
  return arquivo;
}

export function criarSincronizadorGmail({
  banco = obterBanco,
  criarCliente = criarClienteGoogle,
  receber = receberAnexoGmail,
  agora = Date.now,
} = {}) {
  const emAndamento = new Set();
  async function processarMensagens({
    contaId,
    conta,
    cliente,
    accessToken,
    repo,
  }) {
    for (
      let processadas = 0;
      processadas < MENSAGENS_POR_EXECUCAO;
      processadas++
    ) {
      const mensagem = repo.reservarMensagem({ contaId, agora: agora() });
      if (!mensagem) break;
      try {
        const dados = await cliente.obterMensagem({
          accessToken,
          id: mensagem.message_id,
          somenteMetadados: true,
        });
        const anteriorAoInicio =
          BigInt(dados.internalDate) <
          BigInt(instanteInicial(conta.data_inicio)) * 1000n;
        const excluida = (dados.labelIds ?? []).some((id) =>
          ["SPAM", "TRASH", "SENT", "DRAFT"].includes(id),
        );
        const anexos =
          anteriorAoInicio || excluida ? [] : partesPdf(dados.payload);
        const registrou = repo.registrarAnexosDaMensagem({
          mensagemId: mensagem.id,
          leaseToken: mensagem.lease_token,
          anexos: anexos.map((item) => ({
            messageId: mensagem.message_id,
            partPath: item.partPath,
            attachmentId: item.attachmentId,
            nome: item.nome,
            mimeType: item.mimeType,
            revisaoEmail: !candidatoFaturaPeloNome(item.nome),
          })),
          agora: agora(),
        });
        if (!registrou) break;
      } catch (erro) {
        if (exigeReconexao(erro)) throw erro;
        const instante = agora();
        repo.registrarFalhaMensagem({
          mensagemId: mensagem.id,
          leaseToken: mensagem.lease_token,
          codigo: codigoSeguro(erro),
          temporaria: temporario(erro),
          proximaTentativaEm: temporario(erro)
            ? proximaTentativa(mensagem, instante)
            : null,
          agora: instante,
        });
      }
    }
  }

  async function processarAnexos({ contaId, cliente, accessToken, repo, db }) {
    for (
      let processados = 0;
      processados < ANEXOS_POR_EXECUCAO;
      processados++
    ) {
      const anexo = repo.reservarAnexo({ contaId, agora: agora() });
      if (!anexo) break;
      try {
        const mensagem = await cliente.obterMensagem({
          accessToken,
          id: anexo.message_id,
        });
        if (
          (mensagem.labelIds ?? []).some((id) =>
            ["SPAM", "TRASH", "SENT", "DRAFT"].includes(id),
          )
        )
          throw new PdfGmailInvalido("mensagem_excluida");
        const parte = partesPdf(mensagem.payload).find(
          (item) => item.partPath === anexo.part_path,
        );
        if (
          !parte ||
          parte.nome !== anexo.nome ||
          parte.mimeType !== anexo.mime_type
        )
          throw new PdfGmailInvalido("anexo_alterado");
        // O ID de download pode mudar entre duas leituras da mesma mensagem.
        // A parte e o nome identificam o candidato; use o ID da leitura atual.
        if (parte.tamanho === null)
          throw new PdfGmailInvalido("pdf_metadados_invalidos");
        if (parte.tamanho > LIMITE_PDF)
          throw new PdfGmailInvalido("pdf_maior_que_10mb");
        const conteudo = parte.attachmentId
          ? await cliente.obterAnexo({
              accessToken,
              mensagemId: anexo.message_id,
              anexoId: parte.attachmentId,
            })
          : { size: parte.tamanho, data: parte.dadosInline };
        if (conteudo.size !== parte.tamanho)
          throw new PdfGmailInvalido("pdf_tamanho_divergente");
        const arquivo = decodificarBase64Url(conteudo.data, conteudo.size);
        const resultado = await receber({
          anexo,
          arquivo,
          banco: db,
          agora: agora(),
        });
        if (!resultado.confirmado) break;
      } catch (erro) {
        if (exigeReconexao(erro)) throw erro;
        const instante = agora();
        repo.registrarFalhaAnexo({
          anexoId: anexo.id,
          leaseToken: anexo.lease_token,
          codigo: codigoSeguro(erro),
          temporaria: temporario(erro),
          proximaTentativaEm: temporario(erro)
            ? proximaTentativa(anexo, instante)
            : null,
          agora: instante,
        });
      }
    }
  }

  async function descobrir({ conta, cliente, accessToken, repo, perfil }) {
    let progresso = repo.obterProgresso(conta.id);
    let paginas = 0;
    if (progresso.fase === "inicial" && !progresso.marco_history_id)
      progresso = repo.iniciarVarreduraCompleta({
        contaId: conta.id,
        historyId: perfil.historyId,
      });
    if (progresso.fase !== "historico") {
      do {
        let pagina;
        try {
          pagina = await cliente.listarMensagens({
            accessToken,
            dataInicial: conta.data_inicio,
            pagina: progresso.cursor_pagina,
            tamanhoPagina: 100,
          });
        } catch (erro) {
          if (
            progresso.cursor_pagina &&
            erro instanceof ErroGoogleGmail &&
            erro.status === 400
          ) {
            repo.reiniciarVarreduraCompleta({
              contaId: conta.id,
              historyId: perfil.historyId,
            });
            return;
          }
          throw erro;
        }
        progresso = repo.registrarPagina({
          contaId: conta.id,
          versaoEsperada: progresso.versao,
          cursorEsperado: progresso.cursor_pagina,
          proximoCursor: pagina.proximaPagina,
          mensagens: pagina.mensagens.map((m) => m.id),
          agora: agora(),
        }).progresso;
        if (++paginas >= PAGINAS_POR_EXECUCAO) return;
      } while (progresso.fase !== "historico");
    }
    do {
      let pagina;
      try {
        pagina = await cliente.listarHistorico({
          accessToken,
          historyId: progresso.history_id,
          pagina: progresso.cursor_pagina,
          tamanhoPagina: 100,
        });
      } catch (erro) {
        if (
          progresso.cursor_pagina &&
          erro instanceof ErroGoogleGmail &&
          erro.status === 400
        ) {
          repo.reiniciarBuscaHistorica(conta.id);
          return;
        }
        throw erro;
      }
      progresso = repo.registrarPagina({
        contaId: conta.id,
        versaoEsperada: progresso.versao,
        cursorEsperado: progresso.cursor_pagina,
        proximoCursor: pagina.proximaPagina,
        mensagens: pagina.mensagens.map((m) => m.id),
        novoHistoryId: pagina.proximaPagina ? null : pagina.historyId,
        agora: agora(),
      }).progresso;
      if (++paginas >= PAGINAS_POR_EXECUCAO) return;
    } while (progresso.cursor_pagina);
  }

  async function sincronizar(contaId) {
    if (emAndamento.has(contaId)) return { iniciada: false };
    emAndamento.add(contaId);
    try {
      const db = banco();
      db.prepare(
        "UPDATE gmail_sincronizacoes SET ultima_execucao_em=?, ultimo_erro_codigo=NULL WHERE conta_id=?",
      ).run(agora(), contaId);
      const repo = criarRepositorioGmail(db);
      const conta = repo.obterConta(contaId);
      if (conta.status_autorizacao !== "conectada" || conta.pausada)
        throw new Error("Conta Gmail pausada ou sem autorização.");
      const cfg = configuracao();
      const credencial = db
        .prepare(
          "SELECT refresh_token_cifrado,email_verificado FROM gmail_credenciais WHERE conta_id=?",
        )
        .get(contaId);
      if (!credencial || credencial.email_verificado !== conta.email)
        throw new Error("Credencial Gmail indisponível.");
      const refreshToken = decifrarRefreshToken(
        credencial.refresh_token_cifrado,
        contaId,
        chaveDeCriptografia(cfg.encryptionKey),
      );
      const cliente = clienteComRenovacao(
        criarCliente(cfg),
        refreshToken,
        agora,
      );
      const perfil = await cliente.obterPerfilCompleto();
      if (perfil.email !== conta.email) {
        repo.definirAutorizacao({ contaId, estado: "reconectar" });
        throw new Error("Identidade Gmail divergente; reconexão necessária.");
      }
      try {
        await descobrir({ conta, cliente, repo, perfil });
        await processarMensagens({
          contaId,
          conta,
          cliente,
          repo,
        });
        await processarAnexos({ contaId, cliente, repo, db });
      } catch (erro) {
        if (
          erro instanceof ErroGoogleGmail &&
          erro.categoria === "historico_expirado"
        ) {
          repo.iniciarVarreduraCompleta({
            contaId,
            historyId: perfil.historyId,
            ressincronizacao: true,
          });
          return { iniciada: true, ressincronizacao: true };
        }
        throw erro;
      }
      db.prepare(
        "UPDATE gmail_sincronizacoes SET ultimo_erro_codigo=NULL WHERE conta_id=?",
      ).run(contaId);
      return { iniciada: true, concluida: true };
    } catch (erro) {
      if (exigeReconexao(erro))
        criarRepositorioGmail(banco()).definirAutorizacao({
          contaId,
          estado: "reconectar",
        });
      try {
        banco()
          .prepare(
            "UPDATE gmail_sincronizacoes SET ultimo_erro_codigo=? WHERE conta_id=?",
          )
          .run(codigoSeguro(erro), contaId);
      } catch {
        // A falha original é mantida; a próxima execução ainda pode recuperar.
      }
      throw erro;
    } finally {
      emAndamento.delete(contaId);
    }
  }

  return { sincronizar, emAndamento: (contaId) => emAndamento.has(contaId) };
}
