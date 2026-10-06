export const ESCOPO_GMAIL = "https://www.googleapis.com/auth/gmail.readonly";
const AUTORIZACAO = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const PERFIL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TEMPO_LIMITE_MS = 10000;

export class ErroGoogleGmail extends Error {
  constructor(categoria, status = null) {
    super(`Falha na API Gmail (${categoria}).`);
    this.name = "ErroGoogleGmail";
    this.categoria = categoria;
    this.status = status;
  }
}

function objeto(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

function texto(valor, nome, limite = 2048) {
  if (
    typeof valor !== "string" ||
    !valor ||
    valor.length > limite ||
    /[\u0000-\u001f\u007f]/.test(valor)
  )
    throw new TypeError(`${nome} inválido.`);
  return valor;
}

function paginaValida(pagina) {
  return pagina === undefined || pagina === null || pagina === ""
    ? null
    : texto(pagina, "Página");
}

function tamanhoValido(tamanho) {
  if (!Number.isInteger(tamanho) || tamanho < 1 || tamanho > 500)
    throw new TypeError("Tamanho da página inválido.");
  return tamanho;
}

export function instanteInicial(dataInicial) {
  if (
    typeof dataInicial !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dataInicial)
  )
    throw new TypeError("Data inicial inválida.");
  const [ano, mes, dia] = dataInicial.split("-").map(Number);
  const verificada = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    verificada.getUTCFullYear() !== ano ||
    verificada.getUTCMonth() !== mes - 1 ||
    verificada.getUTCDate() !== dia
  )
    throw new TypeError("Data inicial inválida.");
  // Gmail interpreta datas textuais em PST. O epoch evita essa ambiguidade.
  const meioDiaUtc = Date.UTC(ano, mes - 1, dia, 12);
  const zona = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    timeZoneName: "shortOffset",
  })
    .formatToParts(meioDiaUtc)
    .find((parte) => parte.type === "timeZoneName")?.value;
  const correspondencia = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zona ?? "");
  if (!correspondencia) throw new Error("Fuso horário indisponível.");
  const minutos =
    (Number(correspondencia[2]) * 60 + Number(correspondencia[3] ?? 0)) *
    (correspondencia[1] === "+" ? 1 : -1);
  return Math.floor((Date.UTC(ano, mes - 1, dia) - minutos * 60000) / 1000);
}

function categoriaHttp(status, operacao) {
  if (status === 400 && operacao === "token") return "autorizacao";
  if (status === 401) return "autorizacao";
  if (status === 403) return "permissao";
  if (status === 429) return "limite";
  if (status === 404 && operacao === "historico") return "historico_expirado";
  if (status === 404) return "nao_encontrado";
  if (status >= 500) return "indisponivel";
  return "resposta_http";
}

async function categoriaErroHttp(resposta, operacao) {
  if (resposta.status !== 403) return categoriaHttp(resposta.status, operacao);
  try {
    if (Number(resposta.headers?.get?.("content-length") ?? 0) > 64 * 1024)
      return "permissao";
    const leitor = resposta.body?.getReader?.();
    if (!leitor) return "permissao";
    const partes = [];
    let tamanho = 0;
    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;
      tamanho += value.length;
      if (tamanho > 64 * 1024) {
        await leitor.cancel();
        return "permissao";
      }
      partes.push(value);
    }
    const corpo = Buffer.concat(partes).toString("utf8");
    const detalhes = JSON.parse(corpo);
    const motivos = detalhes?.error?.errors?.map((item) => item?.reason) ?? [];
    if (
      motivos.some((motivo) =>
        [
          "rateLimitExceeded",
          "userRateLimitExceeded",
          "quotaExceeded",
          "dailyLimitExceeded",
        ].includes(motivo),
      )
    )
      return "limite";
  } catch {
    // Sem motivo reconhecido, um 403 não deve entrar em retry indefinido.
  }
  return "permissao";
}

async function requisitarJson(fetchImpl, url, opcoes, operacao) {
  let resposta;
  try {
    resposta = await fetchImpl(url, {
      ...opcoes,
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (erro) {
    throw new ErroGoogleGmail(
      erro?.name === "TimeoutError" || erro?.name === "AbortError"
        ? "timeout"
        : "rede",
    );
  }
  if (!resposta.ok)
    throw new ErroGoogleGmail(
      await categoriaErroHttp(resposta, operacao),
      resposta.status,
    );
  try {
    const limite =
      operacao === "mensagem"
        ? 32 * 1024 * 1024
        : operacao === "anexo"
          ? 15 * 1024 * 1024
          : operacao === "historico" || operacao === "mensagens"
            ? 8 * 1024 * 1024
            : 64 * 1024;
    const tamanhoDeclarado = Number(
      resposta.headers?.get?.("content-length") ?? 0,
    );
    if (tamanhoDeclarado > limite) throw new Error();
    let dados;
    if (resposta.body?.getReader) {
      const leitor = resposta.body.getReader();
      const partes = [];
      let tamanho = 0;
      while (true) {
        const { done, value } = await leitor.read();
        if (done) break;
        tamanho += value.length;
        if (tamanho > limite) {
          await leitor.cancel();
          throw new Error();
        }
        partes.push(value);
      }
      dados = JSON.parse(Buffer.concat(partes).toString("utf8"));
    } else {
      // Compatibilidade com respostas simuladas nos testes de contrato.
      dados = await resposta.json();
    }
    if (!objeto(dados)) throw new Error();
    return dados;
  } catch {
    throw new ErroGoogleGmail("resposta_invalida", resposta.status);
  }
}

function tokenAcesso(accessToken) {
  return {
    Authorization: `Bearer ${texto(accessToken, "Token de acesso", 8192)}`,
  };
}

function urlApi(caminho, parametros = {}) {
  const url = new URL(`${API}/${caminho}`);
  for (const [chave, valor] of Object.entries(parametros))
    if (valor !== null && valor !== undefined)
      url.searchParams.set(chave, String(valor));
  return url.toString();
}

function validarConfiguracao({ clientId, clientSecret, redirectUri }) {
  if (!clientId || !clientSecret || !redirectUri)
    throw new Error("Integração Gmail ainda não configurada.");
  const uri = new URL(redirectUri);
  if (
    uri.pathname !== "/api/admin/gmail/oauth/retorno" ||
    uri.search ||
    uri.hash
  )
    throw new Error("URL de retorno Gmail inválida.");
  if (
    uri.protocol !== "https:" &&
    !(
      uri.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(uri.hostname)
    )
  )
    throw new Error("URL de retorno Gmail insegura.");
}

export function criarClienteGoogle(configuracao, fetchImpl = fetch) {
  validarConfiguracao(configuracao);
  const { clientId, clientSecret, redirectUri } = configuracao;
  return {
    urlDeAutorizacao({ state, desafio, email }) {
      const url = new URL(AUTORIZACAO);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: ESCOPO_GMAIL,
        access_type: "offline",
        prompt: "consent",
        state,
        code_challenge: desafio,
        code_challenge_method: "S256",
        login_hint: email,
      }).toString();
      return url.toString();
    },

    async trocarCodigo({ code, verificador }) {
      const resposta = await fetchImpl(TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: verificador,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resposta.ok) throw new Error("Falha na autorização Google.");
      const dados = await resposta.json();
      if (
        typeof dados.access_token !== "string" ||
        typeof dados.refresh_token !== "string" ||
        dados.token_type?.toLowerCase() !== "bearer" ||
        !String(dados.scope ?? "")
          .split(/\s+/)
          .includes(ESCOPO_GMAIL)
      )
        throw new Error("Autorização Google incompleta.");
      return {
        accessToken: dados.access_token,
        refreshToken: dados.refresh_token,
        escopo: dados.scope,
      };
    },

    async obterPerfil(accessToken) {
      const resposta = await fetchImpl(PERFIL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!resposta.ok) throw new Error("Identidade Gmail não verificada.");
      const dados = await resposta.json();
      if (typeof dados.emailAddress !== "string" || !dados.emailAddress.trim())
        throw new Error("Identidade Gmail não verificada.");
      return dados.emailAddress.trim().toLowerCase();
    },

    async renovarAcesso({ refreshToken }) {
      const dados = await requisitarJson(
        fetchImpl,
        TOKEN,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: texto(refreshToken, "Token de atualização", 8192),
            grant_type: "refresh_token",
          }),
        },
        "token",
      );
      if (
        typeof dados.access_token !== "string" ||
        !dados.access_token ||
        String(dados.token_type ?? "").toLowerCase() !== "bearer" ||
        !Number.isInteger(dados.expires_in) ||
        dados.expires_in <= 0
      )
        throw new ErroGoogleGmail("resposta_invalida", 200);
      return { accessToken: dados.access_token, expiresIn: dados.expires_in };
    },

    async obterPerfilCompleto(accessToken) {
      const dados = await requisitarJson(
        fetchImpl,
        PERFIL,
        {
          headers: tokenAcesso(accessToken),
        },
        "perfil",
      );
      if (
        typeof dados.emailAddress !== "string" ||
        !dados.emailAddress.trim() ||
        typeof dados.historyId !== "string" ||
        !/^\d+$/.test(dados.historyId)
      )
        throw new ErroGoogleGmail("resposta_invalida", 200);
      return {
        email: dados.emailAddress.trim().toLowerCase(),
        historyId: dados.historyId,
      };
    },

    async listarMensagens({
      accessToken,
      dataInicial,
      pagina,
      tamanhoPagina = 100,
    }) {
      const url = urlApi("messages", {
        q: `after:${instanteInicial(dataInicial) - 1}`,
        pageToken: paginaValida(pagina),
        maxResults: tamanhoValido(tamanhoPagina),
        includeSpamTrash: false,
      });
      const dados = await requisitarJson(
        fetchImpl,
        url,
        {
          headers: tokenAcesso(accessToken),
        },
        "mensagens",
      );
      if (
        dados.messages !== undefined &&
        (!Array.isArray(dados.messages) ||
          dados.messages.some(
            (mensagem) =>
              !objeto(mensagem) ||
              typeof mensagem.id !== "string" ||
              !mensagem.id,
          ))
      )
        throw new ErroGoogleGmail("resposta_invalida", 200);
      if (
        dados.nextPageToken !== undefined &&
        typeof dados.nextPageToken !== "string"
      )
        throw new ErroGoogleGmail("resposta_invalida", 200);
      return {
        mensagens: (dados.messages ?? []).map(({ id }) => ({ id })),
        proximaPagina: dados.nextPageToken ?? null,
      };
    },

    async listarHistorico({
      accessToken,
      historyId,
      pagina,
      tamanhoPagina = 100,
    }) {
      if (typeof historyId !== "string" || !/^\d+$/.test(historyId))
        throw new TypeError("ID do histórico inválido.");
      const url = urlApi("history", {
        startHistoryId: historyId,
        historyTypes: "messageAdded",
        pageToken: paginaValida(pagina),
        maxResults: tamanhoValido(tamanhoPagina),
      });
      const dados = await requisitarJson(
        fetchImpl,
        url,
        {
          headers: tokenAcesso(accessToken),
        },
        "historico",
      );
      if (
        typeof dados.historyId !== "string" ||
        !/^\d+$/.test(dados.historyId) ||
        (dados.history !== undefined && !Array.isArray(dados.history)) ||
        (dados.nextPageToken !== undefined &&
          typeof dados.nextPageToken !== "string")
      )
        throw new ErroGoogleGmail("resposta_invalida", 200);
      const ids = [];
      for (const item of dados.history ?? []) {
        if (
          !objeto(item) ||
          (item.messagesAdded !== undefined &&
            !Array.isArray(item.messagesAdded))
        )
          throw new ErroGoogleGmail("resposta_invalida", 200);
        for (const adicao of item.messagesAdded ?? []) {
          if (
            !objeto(adicao) ||
            !objeto(adicao.message) ||
            typeof adicao.message.id !== "string" ||
            !adicao.message.id
          )
            throw new ErroGoogleGmail("resposta_invalida", 200);
          ids.push(adicao.message.id);
        }
      }
      return {
        mensagens: [...new Set(ids)].map((id) => ({ id })),
        historyId: dados.historyId,
        proximaPagina: dados.nextPageToken ?? null,
      };
    },

    async obterMensagem({ accessToken, id }) {
      const dados = await requisitarJson(
        fetchImpl,
        urlApi(`messages/${encodeURIComponent(texto(id, "ID da mensagem"))}`, {
          format: "full",
        }),
        { headers: tokenAcesso(accessToken) },
        "mensagem",
      );
      if (
        dados.id !== id ||
        !objeto(dados.payload) ||
        typeof dados.internalDate !== "string" ||
        !/^\d+$/.test(dados.internalDate)
      )
        throw new ErroGoogleGmail("resposta_invalida", 200);
      return dados;
    },

    async obterAnexo({ accessToken, mensagemId, anexoId }) {
      const dados = await requisitarJson(
        fetchImpl,
        urlApi(
          `messages/${encodeURIComponent(texto(mensagemId, "ID da mensagem"))}/attachments/${encodeURIComponent(texto(anexoId, "ID do anexo"))}`,
        ),
        { headers: tokenAcesso(accessToken) },
        "anexo",
      );
      if (
        !Number.isSafeInteger(dados.size) ||
        dados.size < 0 ||
        typeof dados.data !== "string" ||
        !/^[A-Za-z0-9_-]*={0,2}$/.test(dados.data)
      )
        throw new ErroGoogleGmail("resposta_invalida", 200);
      return { size: dados.size, data: dados.data };
    },
  };
}
