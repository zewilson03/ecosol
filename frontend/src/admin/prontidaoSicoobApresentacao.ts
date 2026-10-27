export const nomesDasPendenciasSicoob: Record<string, string> = {
  CONFIGURACAO_SICOOB_INVALIDA: "Configuração inválida ou insegura",
  CONTA_REFERENCIA_AUSENTE: "Referência interna da conta não configurada",
  API_BASE_AUSENTE: "Endereço oficial da API ausente",
  OAUTH_INCOMPLETO: "Credenciais OAuth incompletas",
  ESCOPO_OAUTH_AUSENTE: "Escopo OAuth não configurado",
  MTLS_INCOMPLETO: "Certificado mTLS ou chave privada ausente",
  VERSAO_CONTRATO_AUSENTE: "Versão do contrato oficial ausente",
  CONVENIO_CONSULTA_INCOMPLETO: "Convênio incompleto para consultas",
  CONVENIO_EMISSAO_INCOMPLETO: "Convênio incompleto para emissão",
  EXECUTOR_REAL_DESLIGADO: "Executor real Sicoob ainda está desligado",
  AMBIENTE_PRODUCAO_NAO_SELECIONADO:
    "Selecione explicitamente o ambiente de produção",
  PRODUCAO_SICOOB_NAO_HABILITADA:
    "Habilitação explícita de produção ainda não confirmada",
};

export function nomeDaPendenciaSicoob(codigo: string) {
  return nomesDasPendenciasSicoob[codigo] ?? "Pendência não reconhecida";
}

export function estadoDaProntidao({
  configuracaoConsultaCompleta,
  configuracaoEmissaoCompleta,
  executorRealDisponivel,
  executorPausado,
  producaoHabilitada,
}: {
  configuracaoConsultaCompleta: boolean;
  configuracaoEmissaoCompleta: boolean;
  executorRealDisponivel: boolean;
  executorPausado: boolean;
  producaoHabilitada: boolean;
}) {
  if (!configuracaoConsultaCompleta)
    return { rotulo: "Configuração incompleta", nivel: "bloqueado" } as const;
  if (!configuracaoEmissaoCompleta)
    return { rotulo: "Somente consulta", nivel: "atencao" } as const;
  if (!executorRealDisponivel)
    return { rotulo: "Executor real indisponível", nivel: "atencao" } as const;
  if (executorPausado)
    return { rotulo: "Pronto, porém pausado", nivel: "atencao" } as const;
  if (!producaoHabilitada)
    return { rotulo: "Pronto para homologação", nivel: "pronto" } as const;
  return { rotulo: "Produção tecnicamente pronta", nivel: "pronto" } as const;
}
