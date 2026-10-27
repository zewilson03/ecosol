import { FalhaHttpSicoob } from "./clienteHttpSeguro.mjs";
import { FalhaDeIntegracaoBancaria } from "./contrato.mjs";

const camposResultado = new Set([
  "categoria",
  "provedor_id",
  "estado",
  "codigo",
  "artefatos",
]);
const identificadorSeguro = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const codigoSeguro = /^[A-Z0-9][A-Z0-9_.:-]{0,79}$/;

function conferirContrato(contrato) {
  for (const nome of [
    "criarRequisicaoRegistro",
    "interpretarRegistro",
    "criarRequisicaoConsulta",
    "interpretarConsulta",
  ]) {
    if (typeof contrato?.[nome] !== "function")
      throw new Error(
        "O contrato oficial de cobrança do Sicoob está incompleto.",
      );
  }
}

function foraDoContrato() {
  throw new FalhaDeIntegracaoBancaria("SICOOB_RESPOSTA_FORA_DO_CONTRATO");
}

function validarResultado(etapa, resultado) {
  if (
    !resultado ||
    typeof resultado !== "object" ||
    Array.isArray(resultado) ||
    Object.keys(resultado).some((campo) => !camposResultado.has(campo))
  )
    foraDoContrato();
  if (resultado.codigo != null && !codigoSeguro.test(resultado.codigo))
    foraDoContrato();
  if (resultado.artefatos != null) {
    const artefatos = resultado.artefatos;
    const permitidos = new Set([
      "linha_digitavel",
      "codigo_barras",
      "qr_code",
      "pdf_base64",
    ]);
    if (
      !artefatos ||
      typeof artefatos !== "object" ||
      Array.isArray(artefatos) ||
      Object.keys(artefatos).some((campo) => !permitidos.has(campo))
    )
      foraDoContrato();
    for (const campo of ["linha_digitavel", "codigo_barras"])
      if (artefatos[campo] != null && !/^\d{40,60}$/.test(artefatos[campo]))
        foraDoContrato();
    if (
      artefatos.qr_code != null &&
      (typeof artefatos.qr_code !== "string" ||
        !artefatos.qr_code ||
        artefatos.qr_code.length > 8_192 ||
        /[\r\n]/.test(artefatos.qr_code))
    )
      foraDoContrato();
    if (
      artefatos.pdf_base64 != null &&
      (typeof artefatos.pdf_base64 !== "string" ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(artefatos.pdf_base64) ||
        artefatos.pdf_base64.length > 7_000_000)
    )
      foraDoContrato();
  }
  const temProvedor = resultado.provedor_id != null;
  if (temProvedor && !identificadorSeguro.test(resultado.provedor_id))
    foraDoContrato();

  if (etapa === "registro") {
    if (resultado.categoria === "sucesso") {
      if (!temProvedor || resultado.estado !== "registrada") foraDoContrato();
    } else if (resultado.categoria === "rejeitada") {
      if (temProvedor || resultado.estado != null) foraDoContrato();
    } else if (resultado.categoria === "resultado_desconhecido") {
      if (temProvedor || resultado.estado != null) foraDoContrato();
    } else {
      foraDoContrato();
    }
    return resultado;
  }

  if (resultado.categoria === "sucesso") {
    if (
      !temProvedor ||
      !new Set(["registrada", "liquidada"]).has(resultado.estado)
    )
      foraDoContrato();
  } else if (resultado.categoria === "rejeitada") {
    if (resultado.estado != null && resultado.estado !== "rejeitada")
      foraDoContrato();
  } else if (
    resultado.categoria === "nao_encontrada" ||
    resultado.categoria === "resultado_desconhecido"
  ) {
    if (temProvedor || resultado.estado != null) foraDoContrato();
  } else {
    throw new FalhaDeIntegracaoBancaria("SICOOB_RESPOSTA_FORA_DO_CONTRATO");
  }
  return resultado;
}

function codigoHttp(status) {
  if (status === 401) return "SICOOB_NAO_AUTORIZADO";
  if (status === 403) return "SICOOB_ACESSO_NEGADO";
  if (status === 429) return "SICOOB_LIMITE_REQUISICOES";
  if (status >= 500) return "SICOOB_INDISPONIVEL";
  return null;
}

export function criarAdaptadorSicoob({
  clienteHttp,
  gerenciadorOAuth,
  contrato,
  clientId,
} = {}) {
  if (!clienteHttp?.solicitar || !gerenciadorOAuth?.obter)
    throw new Error("Cliente HTTP e gerenciador OAuth são obrigatórios.");
  conferirContrato(contrato);

  async function executar(etapa, entrada) {
    let token;
    let iniciouOperacao = false;
    let renovacoesApos401 = 0;
    try {
      const requisicao =
        etapa === "registro"
          ? contrato.criarRequisicaoRegistro(entrada)
          : contrato.criarRequisicaoConsulta(entrada);
      let resposta;
      while (true) {
        token = await gerenciadorOAuth.obter();
        iniciouOperacao = true;
        resposta = await clienteHttp.solicitar({
          ...requisicao,
          cabecalhos: {
            ...requisicao.cabecalhos,
            ...(clientId ? { client_id: clientId } : {}),
          },
          accessToken: token.accessToken,
          tokenType: token.tokenType,
        });
        // Um registro pode já ter sido aceito mesmo que a resposta seja 401.
        // Sem a idempotência remota comprovada pelo contrato oficial, não é
        // seguro repetir um POST financeiro: a próxima etapa será consulta.
        if (
          resposta.status === 401 &&
          etapa === "consulta" &&
          renovacoesApos401 === 0
        ) {
          gerenciadorOAuth.invalidar(token.accessToken);
          renovacoesApos401 += 1;
          continue;
        }
        break;
      }
      const falha = codigoHttp(resposta.status);
      if (falha) {
        const envioPossivelmenteExecutado = etapa === "registro";
        throw new FalhaDeIntegracaoBancaria(falha, {
          // Depois de atravessar a fronteira financeira, qualquer erro HTTP
          // vira resultado inconclusivo até a consulta confirmar o estado.
          // A renovação automática de 401 existe somente para consultas.
          seguroRepetir:
            !envioPossivelmenteExecutado &&
            resposta.status !== 401 &&
            resposta.status !== 403,
          retryAfterMs: resposta.retryAfterMs,
          permanente:
            !envioPossivelmenteExecutado &&
            (resposta.status === 401 || resposta.status === 403),
        });
      }
      return validarResultado(
        etapa,
        etapa === "registro"
          ? contrato.interpretarRegistro(resposta, entrada)
          : contrato.interpretarConsulta(resposta, entrada),
      );
    } catch (erro) {
      if (erro instanceof FalhaDeIntegracaoBancaria) throw erro;
      if (erro instanceof FalhaHttpSicoob)
        throw new FalhaDeIntegracaoBancaria(erro.codigo, {
          // Falha OAuth acontece antes da operação financeira; depois do início
          // do envio, só consultas são repetíveis sem reconciliação prévia.
          seguroRepetir: !iniciouOperacao || etapa === "consulta",
          retryAfterMs: erro.retryAfterMs,
        });
      throw new FalhaDeIntegracaoBancaria("SICOOB_FALHA_DE_CONTRATO");
    }
  }

  return Object.freeze({
    nome: "sicoob",
    async registrarCobranca(entrada) {
      return await executar("registro", entrada);
    },
    async consultarCobranca(entrada) {
      return await executar("consulta", entrada);
    },
  });
}
