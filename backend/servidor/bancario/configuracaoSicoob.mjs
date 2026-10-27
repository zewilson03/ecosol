const ambientesPermitidos = new Set(["homologacao", "producao"]);

function lerTexto(ambiente, nome) {
  const valor = ambiente[nome];
  return typeof valor === "string" ? valor.trim() : "";
}

function falhar(mensagem) {
  const erro = new Error(mensagem);
  erro.codigo = "SICOOB_CONFIGURACAO_INVALIDA";
  throw erro;
}

function validarUrl(valor, nome, { ambiente, nodeEnv }) {
  if (!valor) return null;
  let url;
  try {
    url = new URL(valor);
  } catch {
    falhar(`${nome} deve ser uma URL absoluta válida.`);
  }
  if (url.username || url.password || url.hash)
    falhar(`${nome} não pode conter credenciais nem fragmento.`);
  const local = new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname);
  const testeLocal = nodeEnv === "test" && local && url.protocol === "http:";
  if (url.protocol !== "https:" && !testeLocal)
    falhar(`${nome} deve usar HTTPS.`);
  if (ambiente === "producao" && local)
    falhar(`${nome} de produção não pode apontar para o computador local.`);
  return url;
}

function validarPar(configuracao, primeiro, segundo, descricao) {
  if (Boolean(configuracao[primeiro]) !== Boolean(configuracao[segundo]))
    falhar(`${descricao} deve informar os dois arquivos em conjunto.`);
}

function validarMtls(configuracao) {
  const usaPem = Boolean(
    configuracao.certificadoPath || configuracao.chavePrivadaPath,
  );
  const usaPfx = Boolean(configuracao.pfxPath);
  if (usaPem && usaPfx)
    falhar(
      "A configuração mTLS deve usar PFX ou certificado/chave PEM, não ambos.",
    );
  validarPar(
    configuracao,
    "certificadoPath",
    "chavePrivadaPath",
    "A configuração mTLS em PEM",
  );
  return usaPfx || Boolean(configuracao.certificadoPath);
}

function inteiroOpcional(ambiente, nome) {
  const valor = lerTexto(ambiente, nome);
  if (!valor) return null;
  if (!/^\d+$/.test(valor) || !Number.isSafeInteger(Number(valor)))
    falhar(`${nome} deve ser um número inteiro positivo.`);
  const numero = Number(valor);
  if (numero <= 0) falhar(`${nome} deve ser um número inteiro positivo.`);
  return numero;
}

/**
 * Lê somente o conjunto de variáveis do ambiente selecionado. Nenhum segredo é
 * devolvido pelo resumo público e nenhuma URL oficial é presumida aqui.
 */
export function obterConfiguracaoSicoob({
  variaveis = process.env,
  exigirCompleta = false,
} = {}) {
  const ambiente = (
    lerTexto(variaveis, "SICOOB_AMBIENTE") || "homologacao"
  ).toLowerCase();
  if (!ambientesPermitidos.has(ambiente))
    falhar("SICOOB_AMBIENTE deve ser homologacao ou producao.");

  const prefixo = `SICOOB_${ambiente.toUpperCase()}_`;
  const nodeEnv = lerTexto(variaveis, "NODE_ENV");
  const configuracao = {
    ambiente,
    contaReferencia: lerTexto(variaveis, "SICOOB_CONTA_REFERENCIA"),
    apiBaseUrl: lerTexto(variaveis, `${prefixo}API_BASE_URL`),
    oauthTokenUrl: lerTexto(variaveis, `${prefixo}OAUTH_TOKEN_URL`),
    clientId: lerTexto(variaveis, `${prefixo}CLIENT_ID`),
    clientSecret: lerTexto(variaveis, `${prefixo}CLIENT_SECRET`),
    oauthScope: lerTexto(variaveis, `${prefixo}OAUTH_SCOPE`),
    certificadoPath: lerTexto(variaveis, `${prefixo}MTLS_CERT_PATH`),
    chavePrivadaPath: lerTexto(variaveis, `${prefixo}MTLS_KEY_PATH`),
    chavePrivadaSenha: lerTexto(variaveis, `${prefixo}MTLS_KEY_PASSPHRASE`),
    pfxPath: lerTexto(variaveis, `${prefixo}MTLS_PFX_PATH`),
    pfxSenha: lerTexto(variaveis, `${prefixo}MTLS_PFX_PASSPHRASE`),
    contratoVersao: lerTexto(variaveis, `${prefixo}CONTRATO_VERSAO`),
    contaCorrente: Object.freeze({
      apiBaseUrl: lerTexto(variaveis, `${prefixo}CONTA_CORRENTE_API_BASE_URL`),
      numeroContaCorrente: inteiroOpcional(
        variaveis,
        `${prefixo}CONTA_CORRENTE_NUMERO_CONTA`,
      ),
    }),
    cobranca: Object.freeze({
      numeroCliente: inteiroOpcional(
        variaveis,
        `${prefixo}COBRANCA_NUMERO_CLIENTE`,
      ),
      codigoModalidade: inteiroOpcional(
        variaveis,
        `${prefixo}COBRANCA_CODIGO_MODALIDADE`,
      ),
      numeroContaCorrente: inteiroOpcional(
        variaveis,
        `${prefixo}COBRANCA_NUMERO_CONTA_CORRENTE`,
      ),
      codigoEspecieDocumento: lerTexto(
        variaveis,
        `${prefixo}COBRANCA_ESPECIE_DOCUMENTO`,
      ),
      identificacaoEmissaoBoleto: inteiroOpcional(
        variaveis,
        `${prefixo}COBRANCA_IDENTIFICACAO_EMISSAO`,
      ),
      identificacaoDistribuicaoBoleto: inteiroOpcional(
        variaveis,
        `${prefixo}COBRANCA_IDENTIFICACAO_DISTRIBUICAO`,
      ),
      numeroContratoCobranca: inteiroOpcional(
        variaveis,
        `${prefixo}COBRANCA_NUMERO_CONTRATO`,
      ),
      gerarPdf: lerTexto(variaveis, `${prefixo}COBRANCA_GERAR_PDF`) === "SIM",
    }),
  };

  const mtlsConfigurado = validarMtls(configuracao);
  const apiUrl = validarUrl(configuracao.apiBaseUrl, `${prefixo}API_BASE_URL`, {
    ambiente,
    nodeEnv,
  });
  const tokenUrl = validarUrl(
    configuracao.oauthTokenUrl,
    `${prefixo}OAUTH_TOKEN_URL`,
    { ambiente, nodeEnv },
  );
  const contaCorrenteUrl = validarUrl(
    configuracao.contaCorrente.apiBaseUrl,
    `${prefixo}CONTA_CORRENTE_API_BASE_URL`,
    { ambiente, nodeEnv },
  );
  if (apiUrl && apiUrl.search)
    falhar(`${prefixo}API_BASE_URL não pode conter parâmetros de consulta.`);
  if (tokenUrl && tokenUrl.search)
    falhar(`${prefixo}OAUTH_TOKEN_URL não pode conter parâmetros de consulta.`);
  if (contaCorrenteUrl && contaCorrenteUrl.search)
    falhar(
      `${prefixo}CONTA_CORRENTE_API_BASE_URL não pode conter parâmetros de consulta.`,
    );
  if (
    Boolean(configuracao.contaCorrente.apiBaseUrl) !==
    Boolean(configuracao.contaCorrente.numeroContaCorrente)
  )
    falhar(
      `A API de Conta Corrente exige ${prefixo}CONTA_CORRENTE_API_BASE_URL e ` +
        `${prefixo}CONTA_CORRENTE_NUMERO_CONTA em conjunto.`,
    );
  if (
    configuracao.contaCorrente.apiBaseUrl &&
    !configuracao.oauthScope.split(/\s+/).includes("cco_consulta")
  )
    falhar(
      `${prefixo}OAUTH_SCOPE deve incluir cco_consulta para consultar o extrato.`,
    );

  if (ambiente === "producao") {
    if (nodeEnv !== "production")
      falhar("A configuração Sicoob de produção exige NODE_ENV=production.");
    if (lerTexto(variaveis, "SICOOB_PRODUCAO_HABILITADA") !== "SIM")
      falhar("A produção Sicoob exige SICOOB_PRODUCAO_HABILITADA=SIM.");
  }

  if (exigirCompleta) {
    const obrigatorios = [
      ["contaReferencia", "SICOOB_CONTA_REFERENCIA"],
      ["apiBaseUrl", `${prefixo}API_BASE_URL`],
      ["oauthTokenUrl", `${prefixo}OAUTH_TOKEN_URL`],
      ["clientId", `${prefixo}CLIENT_ID`],
      ["contratoVersao", `${prefixo}CONTRATO_VERSAO`],
    ];
    const ausentes = obrigatorios
      .filter(([campo]) => !configuracao[campo])
      .map(([, nome]) => nome);
    if (ausentes.length)
      falhar(`Configuração Sicoob incompleta: ${ausentes.join(", ")}.`);
    if (!mtlsConfigurado)
      falhar(
        `Configuração Sicoob incompleta: ${prefixo}MTLS_PFX_PATH ou ` +
          `${prefixo}MTLS_CERT_PATH/${prefixo}MTLS_KEY_PATH.`,
      );
  }

  return Object.freeze(configuracao);
}

export function resumirConfiguracaoSicoob(configuracao) {
  return {
    ambiente: configuracao.ambiente,
    conta_referencia_configurada: Boolean(configuracao.contaReferencia),
    api_configurada: Boolean(configuracao.apiBaseUrl),
    oauth_configurado: Boolean(
      configuracao.oauthTokenUrl && configuracao.clientId,
    ),
    mtls_configurado: Boolean(
      configuracao.pfxPath ||
      (configuracao.certificadoPath && configuracao.chavePrivadaPath),
    ),
    contrato_versao: configuracao.contratoVersao || null,
    conta_corrente_configurada: Boolean(
      configuracao.contaCorrente?.apiBaseUrl &&
      configuracao.contaCorrente?.numeroContaCorrente,
    ),
  };
}
