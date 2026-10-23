import { obterBanco } from "../bancoDeDados.mjs";
import {
  obterConfiguracaoSicoob,
  resumirConfiguracaoSicoob,
} from "./configuracaoSicoob.mjs";

const camposConvenioEmissao = [
  "numeroCliente",
  "codigoModalidade",
  "numeroContaCorrente",
  "codigoEspecieDocumento",
  "identificacaoEmissaoBoleto",
  "identificacaoDistribuicaoBoleto",
];

function preenchido(valor) {
  return valor !== null && valor !== undefined && String(valor).trim() !== "";
}

export function avaliarProntidaoSicoob({
  variaveis = process.env,
  banco = obterBanco(),
} = {}) {
  let configuracao;
  try {
    configuracao = obterConfiguracaoSicoob({ variaveis });
  } catch {
    return Object.freeze({
      estado: "configuracao_invalida",
      ambiente: null,
      executor_pausado: true,
      configuracao_consulta_completa: false,
      configuracao_emissao_completa: false,
      executor_real_disponivel: false,
      pendencias: ["CONFIGURACAO_SICOOB_INVALIDA"],
    });
  }

  const resumo = resumirConfiguracaoSicoob(configuracao);
  const controle = banco
    .prepare("SELECT pausado FROM bancario_controle_executor WHERE id=1")
    .get();
  const executorPausado = !controle || Boolean(controle.pausado);
  const pendencias = [];
  if (!resumo.conta_referencia_configurada)
    pendencias.push("CONTA_REFERENCIA_AUSENTE");
  if (!resumo.api_configurada) pendencias.push("API_BASE_AUSENTE");
  if (!resumo.oauth_configurado) pendencias.push("OAUTH_INCOMPLETO");
  if (!configuracao.oauthScope) pendencias.push("ESCOPO_OAUTH_AUSENTE");
  if (!resumo.mtls_configurado) pendencias.push("MTLS_INCOMPLETO");
  if (!resumo.contrato_versao) pendencias.push("VERSAO_CONTRATO_AUSENTE");

  const convenioConsulta =
    preenchido(configuracao.cobranca.numeroCliente) &&
    preenchido(configuracao.cobranca.codigoModalidade);
  if (!convenioConsulta) pendencias.push("CONVENIO_CONSULTA_INCOMPLETO");
  const convenioEmissao = camposConvenioEmissao.every((campo) =>
    preenchido(configuracao.cobranca[campo]),
  );
  if (!convenioEmissao) pendencias.push("CONVENIO_EMISSAO_INCOMPLETO");

  const basePronta =
    resumo.conta_referencia_configurada &&
    resumo.api_configurada &&
    resumo.oauth_configurado &&
    Boolean(configuracao.oauthScope) &&
    resumo.mtls_configurado &&
    Boolean(resumo.contrato_versao);
  const consultaCompleta = basePronta && convenioConsulta;
  const emissaoCompleta = basePronta && convenioEmissao;
  const modo = String(variaveis.BANCARIO_EXECUTOR_MODO ?? "desligado")
    .trim()
    .toLowerCase();

  return Object.freeze({
    estado: emissaoCompleta
      ? "configuracao_completa_executor_nao_implementado"
      : consultaCompleta
        ? "somente_consulta"
        : "incompleta",
    ambiente: configuracao.ambiente,
    contrato_versao: resumo.contrato_versao,
    executor_modo: modo,
    executor_pausado: executorPausado,
    configuracao_consulta_completa: consultaCompleta,
    configuracao_emissao_completa: emissaoCompleta,
    executor_real_disponivel: false,
    producao_habilitada:
      configuracao.ambiente === "producao" &&
      String(variaveis.SICOOB_PRODUCAO_HABILITADA ?? "").trim() === "SIM",
    configuracao: Object.freeze({
      conta_referencia: resumo.conta_referencia_configurada,
      api: resumo.api_configurada,
      oauth: resumo.oauth_configurado,
      escopo_oauth: Boolean(configuracao.oauthScope),
      mtls: resumo.mtls_configurado,
      convenio_consulta: convenioConsulta,
      convenio_emissao: convenioEmissao,
    }),
    pendencias: Object.freeze(pendencias),
  });
}
