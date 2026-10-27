import { FalhaHttpSicoob } from "./clienteHttpSeguro.mjs";
import { FalhaDeIntegracaoBancaria } from "./contrato.mjs";

const LIMITE_TRANSACOES = 20_000;

function falhaContrato() {
  throw new FalhaDeIntegracaoBancaria("SICOOB_EXTRATO_FORA_DO_CONTRATO", {
    permanente: true,
  });
}

function inteiroNoIntervalo(valor, minimo, maximo, nome) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo)
    throw new FalhaDeIntegracaoBancaria(`SICOOB_EXTRATO_${nome}_INVALIDO`, {
      permanente: true,
    });
  return numero;
}

function textoLimitado(valor, limite, obrigatorio = false) {
  if (valor == null && !obrigatorio) return null;
  const resultado = String(valor ?? "").trim();
  if (
    (obrigatorio && !resultado) ||
    resultado.length > limite ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(resultado)
  )
    falhaContrato();
  return resultado || null;
}

function valorDecimal(valor) {
  const resultado = textoLimitado(valor, 40, true)?.replace(",", ".");
  if (!/^-?\d{1,18}(?:\.\d{1,2})?$/.test(resultado)) falhaContrato();
  const [inteiro, decimal = ""] = resultado.split(".");
  return `${inteiro}.${decimal.padEnd(2, "0")}`;
}

function dataBancaria(valor) {
  const resultado = textoLimitado(valor, 40, true);
  if (
    !/^\d{2}\/\d{2}\/\d{4}(?:\s+.*)?$|^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(
      resultado,
    )
  )
    falhaContrato();
  return resultado;
}

function mascararDocumento(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  if (digitos.length === 11)
    return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
  if (digitos.length === 14)
    return `**.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/****-**`;
  return null;
}

function codigoHttp(status) {
  if (status === 400) return ["SICOOB_EXTRATO_REJEITADO", true];
  if (status === 401) return ["SICOOB_NAO_AUTORIZADO", true];
  if (status === 403) return ["SICOOB_ACESSO_NEGADO", true];
  if (status === 429) return ["SICOOB_LIMITE_REQUISICOES", false];
  if (status >= 500) return ["SICOOB_INDISPONIVEL", false];
  return ["SICOOB_EXTRATO_RESPOSTA_INESPERADA", true];
}

function interpretarResposta(conteudo) {
  if (!conteudo || typeof conteudo !== "object" || Array.isArray(conteudo))
    falhaContrato();
  if (
    !Array.isArray(conteudo.transacoes) ||
    conteudo.transacoes.length > LIMITE_TRANSACOES
  )
    falhaContrato();
  return Object.freeze({
    saldos: Object.freeze({
      atual: valorDecimal(conteudo.saldoAtual),
      anterior: valorDecimal(conteudo.saldoAnterior),
      bloqueado: valorDecimal(conteudo.saldoBloqueado),
      limite: valorDecimal(conteudo.saldoLimite),
      bloqueio_judicial: valorDecimal(conteudo.saldoBloqueioJudicial),
    }),
    transacoes: conteudo.transacoes.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        falhaContrato();
      return Object.freeze({
        id: textoLimitado(item.transactionId, 160, true),
        tipo: textoLimitado(item.tipo, 80, true),
        valor: valorDecimal(item.valor),
        data: dataBancaria(item.data),
        data_lote: textoLimitado(item.dataLote, 40),
        descricao: textoLimitado(item.descricao, 500, true),
        numero_documento: textoLimitado(item.numeroDocumento, 120),
        documento_mascarado: mascararDocumento(item.cpfCnpj),
        informacao_complementar: textoLimitado(item.descInfComplementar, 500),
      });
    }),
  });
}

export function criarContaCorrenteSicoob({
  clienteHttp,
  gerenciadorOAuth,
  clientId,
  numeroContaCorrente,
  intervaloMinimoMs = 500,
} = {}) {
  if (!clienteHttp?.solicitar || !gerenciadorOAuth?.obter)
    throw new Error(
      "Cliente HTTP e OAuth são obrigatórios para consultar o extrato.",
    );
  const cliente = textoLimitado(clientId, 512, true);
  const conta = inteiroNoIntervalo(
    numeroContaCorrente,
    1,
    Number.MAX_SAFE_INTEGER,
    "CONTA",
  );
  if (
    !Number.isInteger(intervaloMinimoMs) ||
    intervaloMinimoMs < 0 ||
    intervaloMinimoMs > 60_000
  )
    throw new Error("Intervalo de consultas da Conta Corrente inválido.");
  let proximaRequisicaoEm = 0;
  let fila = Promise.resolve();

  function solicitarComLimite(requisicao) {
    const executar = async () => {
      const espera = Math.max(0, proximaRequisicaoEm - Date.now());
      if (espera) await new Promise((resolver) => setTimeout(resolver, espera));
      proximaRequisicaoEm = Date.now() + intervaloMinimoMs;
      return await clienteHttp.solicitar(requisicao);
    };
    const chamada = fila.then(executar, executar);
    fila = chamada.then(
      () => undefined,
      () => undefined,
    );
    return chamada;
  }

  return Object.freeze({
    async consultarExtrato({
      mes,
      ano,
      diaInicial,
      diaFinal,
      agruparCnab = false,
    }) {
      const mesValidado = inteiroNoIntervalo(mes, 1, 12, "MES");
      const anoValidado = inteiroNoIntervalo(ano, 2000, 2200, "ANO");
      const parametros = new URLSearchParams({
        numeroContaCorrente: String(conta),
        agruparCNAB: agruparCnab ? "true" : "false",
      });
      if (diaInicial != null || diaFinal != null) {
        const inicio = inteiroNoIntervalo(diaInicial, 1, 31, "DIA_INICIAL");
        const fim = inteiroNoIntervalo(diaFinal, inicio, 31, "DIA_FINAL");
        parametros.set("diaInicial", String(inicio));
        parametros.set("diaFinal", String(fim));
      }
      let token = await gerenciadorOAuth.obter();
      let resposta = await solicitarComLimite({
        metodo: "GET",
        caminho: `/extrato/${mesValidado}/${anoValidado}?${parametros}`,
        cabecalhos: { accept: "application/json", client_id: cliente },
        accessToken: token.accessToken,
        tokenType: token.tokenType,
      });
      if (resposta.status === 401) {
        gerenciadorOAuth.invalidar(token.accessToken);
        token = await gerenciadorOAuth.obter();
        resposta = await solicitarComLimite({
          metodo: "GET",
          caminho: `/extrato/${mesValidado}/${anoValidado}?${parametros}`,
          cabecalhos: { accept: "application/json", client_id: cliente },
          accessToken: token.accessToken,
          tokenType: token.tokenType,
        });
      }
      if (resposta.status < 200 || resposta.status >= 300) {
        const [codigo, permanente] = codigoHttp(resposta.status);
        throw new FalhaDeIntegracaoBancaria(codigo, {
          retryAfterMs: resposta.retryAfterMs,
          permanente,
          seguroRepetir: resposta.status !== 401 && resposta.status !== 403,
        });
      }
      return interpretarResposta(resposta.conteudo);
    },
  });
}

export function mapearFalhaExtrato(erro) {
  if (erro instanceof FalhaDeIntegracaoBancaria) return erro;
  if (erro instanceof FalhaHttpSicoob)
    return new FalhaDeIntegracaoBancaria(erro.codigo, {
      retryAfterMs: erro.retryAfterMs,
      seguroRepetir: true,
    });
  return new FalhaDeIntegracaoBancaria("SICOOB_EXTRATO_FALHA_INTERNA");
}
