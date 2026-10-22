import { criarAdaptadorSicoob } from "./adaptadorSicoob.mjs";
import {
  criarAgenteMtlsSicoob,
  criarClienteHttpSeguro,
} from "./clienteHttpSeguro.mjs";
import {
  obterConfiguracaoSicoob,
  resumirConfiguracaoSicoob,
} from "./configuracaoSicoob.mjs";
import {
  criarCarregadorTokenOAuth,
  criarGerenciadorOAuth,
} from "./gerenciadorOAuth.mjs";
import { contratoOAuthSicoob } from "./contratoOAuthSicoob.mjs";
import { FalhaHttpSicoob } from "./clienteHttpSeguro.mjs";

/**
 * Compõe a integração sem definir nenhum campo ou endpoint do provedor. Os
 * dois contratos só devem ser implementados a partir da documentação oficial.
 */
export function criarIntegracaoSicoob({
  variaveis = process.env,
  contratoOAuth = contratoOAuthSicoob,
  contratoCobranca,
  relogio,
  permitirHttpLocal = false,
  timeoutMs = 10_000,
} = {}) {
  const configuracao = obterConfiguracaoSicoob({
    variaveis,
    exigirCompleta: true,
  });
  if (
    typeof contratoOAuth?.criarRequisicaoToken !== "function" ||
    typeof contratoOAuth?.interpretarToken !== "function"
  )
    throw new Error(
      "O contrato OAuth oficial do Sicoob ainda não foi configurado.",
    );

  const agente = configuracao.certificadoPath
    ? criarAgenteMtlsSicoob(configuracao)
    : undefined;
  const tokenUrl = new URL(configuracao.oauthTokenUrl);
  const clienteToken = criarClienteHttpSeguro({
    baseUrl: tokenUrl.origin,
    agente,
    permitirHttpLocal,
    // Alguns contratos OAuth usam client authentication no cabeçalho. Essa
    // exceção vale exclusivamente para o endpoint de token, jamais para a API.
    permitirAutorizacaoContrato: true,
    timeoutMs,
  });
  const clienteApi = criarClienteHttpSeguro({
    baseUrl: configuracao.apiBaseUrl,
    agente,
    permitirHttpLocal,
    timeoutMs,
  });
  const carregador = criarCarregadorTokenOAuth({
    clienteHttp: clienteToken,
    contratoOAuth: {
      criarRequisicaoToken() {
        const requisicao = contratoOAuth.criarRequisicaoToken(configuracao);
        return {
          ...requisicao,
          caminho: `${tokenUrl.pathname}${tokenUrl.search}`,
        };
      },
      interpretarToken(resposta) {
        return contratoOAuth.interpretarToken(resposta, configuracao);
      },
    },
  });
  const oauth = criarGerenciadorOAuth({
    obterNovoToken: carregador,
    relogio,
  });
  const adaptador = criarAdaptadorSicoob({
    clienteHttp: clienteApi,
    gerenciadorOAuth: oauth,
    contrato: contratoCobranca,
  });
  const diagnostico = Object.freeze({
    async consultarSaude() {
      const token = await oauth.obter();
      const resposta = await clienteApi.solicitar({
        metodo: "GET",
        caminho: "/health",
        cabecalhos: { accept: "application/json" },
        accessToken: token.accessToken,
        tokenType: token.tokenType,
      });
      if (resposta.status < 200 || resposta.status >= 300)
        throw new FalhaHttpSicoob("SICOOB_HEALTH_RECUSADO", {
          status: resposta.status,
          retryAfterMs: resposta.retryAfterMs,
        });
      if (
        !resposta.conteudo ||
        typeof resposta.conteudo !== "object" ||
        resposta.conteudo.status !== "UP"
      )
        throw new FalhaHttpSicoob("SICOOB_HEALTH_INVALIDO");
      return Object.freeze({ disponivel: true, status: "UP" });
    },
  });
  return Object.freeze({
    adaptador,
    oauth,
    diagnostico,
    configuracao: resumirConfiguracaoSicoob(configuracao),
  });
}
