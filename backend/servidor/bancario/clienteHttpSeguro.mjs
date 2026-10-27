import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

const cabecalhosProibidos = new Set([
  "authorization",
  "connection",
  "content-length",
  "host",
  "proxy-authorization",
  "transfer-encoding",
]);

export class FalhaHttpSicoob extends Error {
  constructor(codigo, { status = null, retryAfterMs = null } = {}) {
    super("Falha na comunicação segura com o provedor bancário.");
    this.name = "FalhaHttpSicoob";
    this.codigo = codigo;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function numeroInteiro(valor, padrao, minimo, maximo, nome) {
  const numero = valor == null ? padrao : Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo)
    throw new Error(`${nome} fora do intervalo permitido.`);
  return numero;
}

function baseSegura(baseUrl, permitirHttpLocal) {
  const url = new URL(baseUrl);
  const local = new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname);
  if (url.username || url.password || url.hash || url.search)
    throw new Error("A URL base bancária contém componentes não permitidos.");
  if (
    url.protocol !== "https:" &&
    !(permitirHttpLocal && local && url.protocol === "http:")
  )
    throw new Error("A comunicação bancária exige HTTPS.");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function normalizarCabecalhos(cabecalhos = {}, permitirAutorizacaoContrato) {
  const resultado = {};
  for (const [nomeOriginal, valor] of Object.entries(cabecalhos)) {
    const nome = String(nomeOriginal).trim().toLowerCase();
    if (
      !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(nome) ||
      (cabecalhosProibidos.has(nome) &&
        !(permitirAutorizacaoContrato && nome === "authorization"))
    )
      throw new Error("Cabeçalho bancário não permitido.");
    if (typeof valor !== "string" || /[\r\n]/.test(valor))
      throw new Error("Valor de cabeçalho bancário inválido.");
    resultado[nome] = valor;
  }
  return resultado;
}

function prepararCorpo(corpo, limite) {
  if (corpo == null) return null;
  const serializado = Buffer.isBuffer(corpo)
    ? corpo
    : Buffer.from(typeof corpo === "string" ? corpo : JSON.stringify(corpo));
  if (serializado.length > limite)
    throw new FalhaHttpSicoob("SICOOB_REQUISICAO_MUITO_GRANDE");
  return serializado;
}

function retryAfterEmMs(valor) {
  if (!valor) return null;
  if (/^\d+$/.test(valor)) return Number(valor) * 1_000;
  const data = Date.parse(valor);
  return Number.isFinite(data) ? Math.max(0, data - Date.now()) : null;
}

export function criarAgenteMtlsSicoob({
  certificadoPath,
  chavePrivadaPath,
  chavePrivadaSenha,
  pfxPath,
  pfxSenha,
}) {
  const usaPfx = Boolean(pfxPath);
  const usaPem = Boolean(certificadoPath || chavePrivadaPath);
  if (usaPfx === usaPem || (usaPem && (!certificadoPath || !chavePrivadaPath)))
    throw new Error(
      "Configure mTLS com um PFX ou com certificado e chave privada PEM.",
    );
  try {
    return new https.Agent({
      ...(usaPfx
        ? {
            pfx: readFileSync(pfxPath),
            passphrase: pfxSenha || undefined,
          }
        : {
            cert: readFileSync(certificadoPath),
            key: readFileSync(chavePrivadaPath),
            passphrase: chavePrivadaSenha || undefined,
          }),
      keepAlive: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
  } catch {
    throw new Error("Não foi possível carregar o material mTLS configurado.");
  }
}

/** Cliente de origem fixa. Caminhos absolutos e redirecionamentos não são aceitos. */
export function criarClienteHttpSeguro({
  baseUrl,
  timeoutMs = 10_000,
  deadlineTotalMs = timeoutMs,
  limiteRespostaBytes = 1024 * 1024,
  limiteRequisicaoBytes = 256 * 1024,
  agente,
  permitirHttpLocal = false,
  permitirAutorizacaoContrato = false,
} = {}) {
  const base = baseSegura(baseUrl, permitirHttpLocal);
  const timeout = numeroInteiro(timeoutMs, 10_000, 100, 120_000, "Timeout");
  const deadline = numeroInteiro(
    deadlineTotalMs,
    timeout,
    100,
    120_000,
    "Deadline total",
  );
  const limiteResposta = numeroInteiro(
    limiteRespostaBytes,
    1024 * 1024,
    1024,
    5 * 1024 * 1024,
    "Limite de resposta",
  );
  const limiteRequisicao = numeroInteiro(
    limiteRequisicaoBytes,
    256 * 1024,
    1,
    1024 * 1024,
    "Limite de requisição",
  );

  return Object.freeze({
    origem: base.origin,
    async solicitar({
      metodo = "GET",
      caminho,
      cabecalhos,
      corpo,
      accessToken,
      tokenType = "Bearer",
      respostaJson = true,
    }) {
      if (
        typeof caminho !== "string" ||
        !caminho.startsWith("/") ||
        caminho.startsWith("//")
      )
        throw new Error(
          "O caminho bancário deve ser relativo à origem configurada.",
        );
      const destino = new URL(caminho.slice(1), base);
      if (
        destino.origin !== base.origin ||
        !destino.pathname.startsWith(base.pathname)
      )
        throw new Error("O destino bancário não pertence à origem permitida.");
      const verbo = String(metodo).toUpperCase();
      if (!new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]).has(verbo))
        throw new Error("Método HTTP bancário não permitido.");
      const dados = prepararCorpo(corpo, limiteRequisicao);
      const headers = normalizarCabecalhos(
        cabecalhos,
        permitirAutorizacaoContrato,
      );
      if (accessToken) {
        if (
          typeof accessToken !== "string" ||
          !accessToken ||
          /[\r\n]/.test(accessToken)
        )
          throw new Error("Token de acesso inválido.");
        if (!/^[A-Za-z][A-Za-z0-9._~-]*$/.test(tokenType))
          throw new Error("Tipo de token inválido.");
        headers.authorization = `${tokenType} ${accessToken}`;
      }
      if (dados) headers["content-length"] = String(dados.length);
      if (dados && !headers["content-type"])
        headers["content-type"] = "application/json";

      return await new Promise((resolve, reject) => {
        let concluida = false;
        let respostaAtiva = null;
        let temporizadorDeadline = null;
        const transporte = destino.protocol === "https:" ? https : http;
        const limpar = () => {
          if (temporizadorDeadline) clearTimeout(temporizadorDeadline);
          temporizadorDeadline = null;
        };
        let requisicao;
        const falhar = (codigo) => {
          if (concluida) return;
          concluida = true;
          limpar();
          respostaAtiva?.destroy();
          requisicao?.destroy();
          reject(new FalhaHttpSicoob(codigo));
        };
        requisicao = transporte.request(
          destino,
          { method: verbo, headers, agent: agente },
          (resposta) => {
            respostaAtiva = resposta;
            const partes = [];
            let tamanho = 0;
            resposta.on("data", (parte) => {
              if (concluida) return;
              tamanho += parte.length;
              if (tamanho > limiteResposta) {
                falhar("SICOOB_RESPOSTA_MUITO_GRANDE");
                return;
              }
              partes.push(parte);
            });
            resposta.on("end", () => {
              if (concluida) return;
              concluida = true;
              limpar();
              const texto = Buffer.concat(partes).toString("utf8");
              let conteudo = texto;
              if (respostaJson && texto) {
                try {
                  conteudo = JSON.parse(texto);
                } catch {
                  resposta.destroy();
                  requisicao.destroy();
                  reject(new FalhaHttpSicoob("SICOOB_RESPOSTA_JSON_INVALIDA"));
                  return;
                }
              }
              resolve({
                status: resposta.statusCode ?? 0,
                conteudo,
                retryAfterMs: retryAfterEmMs(resposta.headers["retry-after"]),
              });
            });
            resposta.on("aborted", () => falhar("SICOOB_CONEXAO_FALHOU"));
            resposta.on("error", () => falhar("SICOOB_CONEXAO_FALHOU"));
          },
        );
        requisicao.setTimeout(timeout, () => falhar("SICOOB_TIMEOUT"));
        temporizadorDeadline = setTimeout(
          () => falhar("SICOOB_DEADLINE_EXCEDIDO"),
          deadline,
        );
        requisicao.on("error", () => {
          if (concluida) return;
          concluida = true;
          limpar();
          respostaAtiva?.destroy();
          reject(new FalhaHttpSicoob("SICOOB_CONEXAO_FALHOU"));
        });
        if (dados) requisicao.write(dados);
        requisicao.end();
      });
    },
  });
}
