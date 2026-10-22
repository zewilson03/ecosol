import { FalhaDeIntegracaoBancaria } from "./contrato.mjs";
import { mapearCobrancaParaSicoob } from "./mapeamentoCobrancaSicoob.mjs";

function codigoResposta(conteudo, padrao) {
  const bruto = conteudo?.mensagens?.[0]?.codigo;
  const codigo = String(bruto ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]/g, "_")
    .slice(0, 80);
  return codigo || padrao;
}

function nossoNumero(valor) {
  const resultado = String(valor ?? "").trim();
  if (!/^\d{1,20}$/.test(resultado))
    throw new FalhaDeIntegracaoBancaria("SICOOB_RESPOSTA_FORA_DO_CONTRATO");
  return resultado;
}

function inteiroConvenio(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero <= 0)
    throw new FalhaDeIntegracaoBancaria(
      `SICOOB_CONFIGURACAO_${campo.toUpperCase()}`,
      { permanente: true },
    );
  return String(numero);
}

function situacaoConsulta(valor) {
  const normalizada = String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (normalizada.includes("liquid")) return "liquidada";
  if (normalizada === "em aberto" || normalizada.includes("aberto"))
    return "registrada";
  return null;
}

function dataAtual(relogio) {
  const instante = new Date(relogio());
  if (Number.isNaN(instante.getTime()))
    throw new Error("Relógio inválido para emissão bancária.");
  return instante.toISOString().slice(0, 10);
}

function pagadorDoSnapshot(snapshot) {
  const cliente = snapshot?.cliente ?? {};
  return {
    documento: cliente.documento,
    nome: cliente.nome,
    endereco: cliente.endereco,
    bairro: cliente.bairro,
    cidade: cliente.cidade,
    cep: cliente.cep,
    uf: cliente.uf,
    email: cliente.email,
  };
}

function artefatosDoResultado(resultado) {
  const artefatos = {};
  if (resultado?.linhaDigitavel != null)
    artefatos.linha_digitavel = String(resultado.linhaDigitavel).trim();
  if (resultado?.codigoBarras != null)
    artefatos.codigo_barras = String(resultado.codigoBarras).trim();
  if (resultado?.qrCode != null)
    artefatos.qr_code = String(resultado.qrCode).trim();
  if (resultado?.pdfBoleto != null)
    artefatos.pdf_base64 = String(resultado.pdfBoleto).trim();
  return Object.keys(artefatos).length ? artefatos : undefined;
}

/** Contrato da Cobrança Bancária v3 publicado no Portal Developers Sicoob. */
export function criarContratoCobrancaSicoob({
  convenio,
  relogio = Date.now,
} = {}) {
  return Object.freeze({
    criarRequisicaoRegistro(entrada) {
      const snapshot = entrada?.snapshot;
      const corpo = mapearCobrancaParaSicoob({
        operacao: {
          idempotencia: entrada?.idempotencia,
          valorCentavos: snapshot?.cobranca?.valor_centavos,
          dataEmissao: dataAtual(relogio),
          vencimento: snapshot?.cobranca?.vencimento,
          mensagensInstrucao: [
            `Cobrança Ecosol - UC ${String(snapshot?.unidade?.uc ?? "").trim()}`,
          ],
        },
        pagador: pagadorDoSnapshot(snapshot),
        convenio,
      });
      return {
        metodo: "POST",
        caminho: "/boletos",
        cabecalhos: { accept: "application/json" },
        corpo,
      };
    },

    interpretarRegistro(resposta) {
      if (resposta?.status === 400 || resposta?.status === 406)
        return {
          categoria: "rejeitada",
          codigo: codigoResposta(
            resposta.conteudo,
            `SICOOB_REJEITADO_${resposta.status}`,
          ),
        };
      if (resposta?.status !== 200 || !resposta.conteudo?.resultado)
        return {
          categoria: "resultado_desconhecido",
          codigo: "SICOOB_REGISTRO_INCONCLUSIVO",
        };
      return {
        categoria: "sucesso",
        provedor_id: nossoNumero(resposta.conteudo.resultado.nossoNumero),
        estado: "registrada",
        codigo: "SICOOB_BOLETO_INCLUIDO",
        ...(artefatosDoResultado(resposta.conteudo.resultado)
          ? { artefatos: artefatosDoResultado(resposta.conteudo.resultado) }
          : {}),
      };
    },

    criarRequisicaoConsulta(entrada) {
      if (!entrada?.provedor_id)
        throw new FalhaDeIntegracaoBancaria(
          "SICOOB_CONSULTA_SEM_NOSSO_NUMERO",
          { permanente: true },
        );
      const parametros = new URLSearchParams({
        numeroCliente: inteiroConvenio(
          convenio?.numeroCliente,
          "numero_cliente",
        ),
        codigoModalidade: inteiroConvenio(
          convenio?.codigoModalidade,
          "codigo_modalidade",
        ),
        nossoNumero: nossoNumero(entrada.provedor_id),
      });
      if (convenio?.numeroContratoCobranca != null)
        parametros.set(
          "numeroContratoCobranca",
          String(convenio.numeroContratoCobranca),
        );
      return {
        metodo: "GET",
        caminho: `/boletos?${parametros.toString()}`,
        cabecalhos: { accept: "application/json" },
      };
    },

    interpretarConsulta(resposta, entrada) {
      if (resposta?.status === 204)
        return {
          categoria: "nao_encontrada",
          codigo: "SICOOB_BOLETO_NAO_ENCONTRADO",
        };
      if (resposta?.status === 400 || resposta?.status === 406)
        return {
          categoria: "rejeitada",
          codigo: codigoResposta(
            resposta.conteudo,
            `SICOOB_CONSULTA_REJEITADA_${resposta.status}`,
          ),
        };
      const resultado = resposta?.conteudo?.resultado;
      if (resposta?.status !== 200 || !resultado)
        return {
          categoria: "resultado_desconhecido",
          codigo: "SICOOB_CONSULTA_INCONCLUSIVA",
        };
      const estado = situacaoConsulta(resultado.situacaoBoleto);
      if (!estado)
        return {
          categoria: "resultado_desconhecido",
          codigo: "SICOOB_SITUACAO_NAO_MAPEADA",
        };
      const identificador = nossoNumero(resultado.nossoNumero);
      if (identificador !== nossoNumero(entrada?.provedor_id))
        throw new FalhaDeIntegracaoBancaria("SICOOB_NOSSO_NUMERO_DIVERGENTE", {
          permanente: true,
        });
      return {
        categoria: "sucesso",
        provedor_id: identificador,
        estado,
        codigo:
          estado === "liquidada"
            ? "SICOOB_BOLETO_LIQUIDADO"
            : "SICOOB_BOLETO_EM_ABERTO",
        ...(artefatosDoResultado(resultado)
          ? { artefatos: artefatosDoResultado(resultado) }
          : {}),
      };
    },
  });
}
