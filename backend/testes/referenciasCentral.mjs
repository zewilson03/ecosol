// Casos SINTÉTICOS de caracterização do código, não cobranças reais homologadas.
// Esperados confirmados por verificarReferenciaCentral.py executando funções AST
// da Central original, sem importar o aplicativo ou abrir planilhas/bancos.
// Execução portátil: npm run test:equivalencia-central (somente Node/decimal.js).
// Revalidar fonte: npm run test:equivalencia-central -- --verificar-central
// (Python 3 padrão, sem pip; PYTHON pode apontar para outro executável).
// Centavos esperados são constantes verificadas, nunca calculados pelo José.
// "aprovado" significa equivalência numérica deste cenário, não aprovação financeira.
// Divergências conhecidas são caracterizadas e testadas; passar a suíte não
// significa que o José já incorporou as regras. Atualizar classificação exige revisão.
// PIX cobre soma dos ajustes disponíveis; seleção PAGO, aliases e ledger de
// consumo dependem de referências adicionais e não estão homologados aqui.
export const fonteCentral =
  "C:/Users/User/Desktop/00 - Central de Faturas Ecosol/_SUPORTE_ORGANIZACAO/ARQUIVOS_RETIRADOS_DA_RAIZ_20260917/CODIGO_FONTE_V146/atualizador_engine.py";
export const sha256Central =
  "f3c9c1fb5265db117d1eb0a86c03737c4b40cbd499e6e8432cc04c93f98b904c";
export const origem = {
  fixa: "calculate_boleto, colunas E/F/G/H/I/J/K (linhas 748–766)",
  classico:
    "calculate_boleto(classic_rateio=True), E/F/H/I/M/O (linhas 748–757)",
  arredondamento:
    "decimal_to_br_text, formatação Decimal em 2 casas; contexto Python padrão ROUND_HALF_EVEN",
  pix: "process_workbook, soma dos adjustment.value e boleto_base + pix_adjustment (linhas 1064–1070)",
  valores:
    "Células sintéticas preservadas: o PDF não é usado para reconstruir valores preexistentes.",
};
// Confirmados executando calculate_boleto + decimal_to_br_text do fonte acima.
// Células sintéticas, sem PIX; nenhum arredondamento intermediário.
export const referenciasArredondamento = [
  ["31.005000", "31.00"],
  ["31.015000", "31.02"],
  ["31.025000", "31.02"],
  ["31.004999", "31.00"],
  ["31.005001", "31.01"],
  ["1.005000", "1.00"],
  ["10.945000", "10.94"],
].map(([tarifa, esperado]) => ({
  id: `arredondamento-${tarifa}`,
  modelo: "fixa",
  celulas: { E: "1", F: tarifa, G: "0", H: "0", I: "0", J: "0", K: "0" },
  bruto: tarifa,
  esperado,
}));
// Referências do código original, não homologação de cobranças históricas.
// M é fração na Central; o motor do José recebe o percentual explicitamente.
export const referenciasClassico = [
  {
    id: "classico-codigo-iluminacao",
    celulas: { E: "100", F: "140", H: "1", I: "0.1", M: "0.2", O: "15" },
    bruto: "147",
    esperado: "147.00",
  },
  {
    id: "classico-codigo-ausencia",
    celulas: { E: "100", F: "140", H: "1", I: "0.1", M: "0.2", O: null },
    bruto: "132",
    esperado: "132.00",
  },
  {
    id: "classico-codigo-empate",
    celulas: {
      E: "1",
      F: "31.005",
      H: "1.000000",
      I: "0.000000",
      M: "0",
      O: "0",
    },
    bruto: "31.005000",
    esperado: "31.00",
  },
  {
    id: "classico-codigo-zero-injecao",
    celulas: { E: "0", F: "30", H: "1.005000", I: "0", M: "0.2", O: "0" },
    bruto: "30.1500000",
    esperado: "30.15",
  },
  {
    id: "classico-codigo-precisao",
    celulas: {
      E: "3",
      F: "5",
      H: "0.333333",
      I: "0.000001",
      M: "0.33333333",
      O: "0.10",
    },
    bruto: "1.43333600333334",
    esperado: "1.43",
  },
].map((caso) => ({
  ...caso,
  modelo: "classico",
  confiabilidade: "funcoes_originais_celulas_sinteticas",
}));
// Etapa 2: busca operacional limitada ao lote 20261001_081256.
// Não importar os valores do CSV como células da planilha: process_workbook
// exporta data.* (extração do PDF), mas calcula nas células ws, inclusive quando
// a linha é preservada. "PRONTO" e PDF final não substituem o snapshot usado.
// Sem nomes, UCs, valores financeiros ou caminhos de clientes versionados.
export const pendenciasOperacionais = [
  {
    id: "operacional-fixa",
    origem: "RASTREABILIDADE_COMPLETA_LOTE_20261001_081256.csv",
    classificacao: "pendente",
    esperado: null,
    necessario:
      "Snapshot da planilha preenchida, aba/linha e células E/F/G/H/I/J/K, associado ao resultado preservado do mesmo lote.",
  },
  {
    id: "operacional-gdii",
    origem: "RASTREABILIDADE_COMPLETA_LOTE_20261001_081256.csv",
    classificacao: "pendente",
    esperado: null,
    necessario:
      "Mesma associação da fórmula fixa, com GDII efetivamente usado na célula K, separado do GDII extraído do PDF.",
  },
  {
    id: "operacional-juros-multa",
    origem: "RASTREABILIDADE_COMPLETA_LOTE_20261001_081256.csv",
    classificacao: "pendente",
    esperado: null,
    necessario:
      "Snapshot com juros I e multa J da linha efetivamente faturada e resultado correspondente; um mesmo candidato cobre ambos.",
  },
  {
    id: "operacional-classico",
    origem:
      "calculate_boleto(classic_rateio=True), fill_row, decimal_to_br_text",
    classificacao: "pendente",
    esperado: null,
    necessario:
      "Exemplo clássico faturado com E/F/H/I/M/O, fórmulas intermediárias e valor carimbado; exemplo de empate de centavos para homologar arredondamento histórico.",
  },
  {
    id: "operacional-pix",
    origem:
      "load_pix_adjustments; CentralFaturasEcosol._carregar_ajustes_pix_disponiveis; process_workbook",
    classificacao: "pendente",
    esperado: null,
    necessario:
      "Cópia acessível da planilha PIX usada (status A, UC C, ajuste I), ledger anterior/posterior, snapshot da cobrança e resultado com boleto base/ajuste/total do mesmo lote.",
  },
];
export const constatacoesOperacionais = {
  classico:
    "Código não arredonda parcelas intermediárias; formata o Decimal final em duas casas (contexto padrão HALF_EVEN). A gravação prévia de células usa float; formato #,##0.00 não arredonda o valor armazenado. Homologação histórica depende do snapshot.",
  elegibilidadePix:
    "load_pix_adjustments usa data_only=True e aba ativa: apenas status PAGO, UC preenchida e ajuste da coluna I não nulo/não zero; o ajuste já calculado é somado, sem recalcular encargos.",
  identidadePix:
    "Ledger identifica caminho|linha|UC|valor. UCs antiga/nova são reunidas por set de PixAdjustment(row,uc,value); valores iguais de linhas distintas não são deduplicados.",
  precedenciaPix:
    "Ajustes já registrados são filtrados antes do lote. O registro ocorre após carimbo bem-sucedido; consumidos são retirados antes da próxima planilha, não entre competências da mesma planilha.",
  limitePix:
    "Não comprova aplicação única global: caminho/linha/valor alterados mudam a chave, ledger ausente/ilegível é tratado como vazio; várias competências são processadas antes da remoção dos ajustes. Não transportar esse comportamento como garantia de idempotência.",
};
// Rastreio dirigido posterior, sem reabrir o inventário de 31 planilhas.
// Evidências operacionais identificáveis permanecem fora do repositório.
export const pendenciasComplementares = [
  {
    id: "san-german",
    classificacao: "pendente",
    esperadoHomologado: null,
    comprovado:
      "OUT-D é constante 165.40; fórmula fixa dá 70.33. process_workbook recalcula e não lê o valor final manual. Log da linha aponta sem_pdf_correspondente, sem boleto.",
    necessario:
      "Justificativa aprovada da constante e memória de cálculo ou boleto carimbado associado à mesma linha/competência. Não há substituição automática comprovada.",
  },
  {
    id: "royer",
    classificacao: "pendente",
    esperadoHomologado: null,
    comprovado:
      "Três fórmulas de somente energia, sem cache utilizável. calculate_boleto original usa fórmula fixa completa, não avalia a fórmula final da planilha.",
    necessario:
      "Entradas E/F/G/H/I/J/K e resultado real carimbado das três linhas especiais, com indicação explícita de qual cálculo prevalece. Nota avulsa de acréscimo não comprova regra PIX.",
  },
  {
    id: "classico-operacional",
    classificacao: "pendente",
    esperadoHomologado: null,
    comprovado:
      "Motor clássico validado contra funções originais em casos sintéticos. Não encontrado exemplo operacional confiável associado às células.",
    necessario:
      "Snapshot E/F/H/I/M/O e resultado carimbado da mesma cobrança para homologar o mapeamento de entrada antes de habilitar a conferência operacional.",
  },
  {
    id: "pix-operacional",
    classificacao: "pendente",
    esperadoHomologado: null,
    comprovado:
      "Planilha configurada sem acesso autorizado; ledger local contém registros anteriores, sem par antes/depois do lote examinado. Chave da Central é caminho|linha|UC|valor; não garante aplicação única se origem mudar.",
    necessario:
      "Cópia acessível da planilha usada, status A/UC C/ajuste I, aliases, ledger antes/depois e boleto base/ajuste/total do mesmo lote. Homologar identidade estável e consumo transacional antes de habilitar PIX.",
  },
];
// Etapa 3: referências das planilhas ATUAIS de outubro/2026, não snapshots do
// lote histórico. Somente células financeiras; sem cliente, UC, usina, linha,
// caminho operacional ou identificadores que permitam associar uma cobrança.
// O vínculo de proveniência e os hashes dos arquivos ficam em relatório local
// fora do repositório. Cache é evidência do arquivo salvo, não de recálculo atual.
// Normalização é hipótese EXPLÍCITA de comparação, nunca alteração operacional:
// F: seis casas conforme formato 0.000000; H/K: centavos conforme #,##0.00.
export const referenciasPlanilhasAtuais = [
  {
    id: "OUT-A",
    comportamento: "fixa-desconto-20",
    confiabilidade: "cache_coerente_com_formula_atual",
    formula: "=((E*F)*(1-G))+(H-I-J-K)",
    celulas: {
      E: "134",
      F: "1.169969",
      G: "0.2",
      H: "132.03",
      I: "0",
      J: "0",
      K: "0",
    },
    bruto: "257.4506768",
    armazenado: "257.4506768",
    formato: "0.00",
    esperado: "257.45",
    joseEsperado: "257.45",
    diferenca: "0.00",
    rejeicaoBruta: null,
  },
  {
    id: "OUT-B",
    comportamento: "gdii-residuo-binario-tarifa",
    confiabilidade: "cache_coerente_centavos_normalizacao_condicional",
    formula: "=((E*F)*(1-G))+(H-I-J-K)",
    celulas: {
      E: "290",
      F: "1.1687890000000001",
      G: "0.2",
      H: "71.64",
      I: "0",
      J: "0",
      K: "50.79",
    },
    bruto: "292.0090480000000232",
    armazenado: "292.00904800000006",
    formato: "#,##0.00",
    esperado: "292.01",
    joseEsperado: "292.01",
    diferenca: "0.00",
    rejeicaoBruta: "tarifa total",
  },
  {
    id: "OUT-C",
    comportamento: "juros-multa-desconto-25-residuo-binario",
    confiabilidade: "cache_coerente_centavos_normalizacao_condicional",
    formula: "=((E*F)*(1-G))+(H-I-J-K)",
    celulas: {
      E: "35",
      F: "1.169969",
      G: "0.25",
      H: "36.659999999999997",
      I: "7.0000000000000007E-2",
      J: "1.49",
      K: "0",
    },
    bruto: "65.811686249999996993",
    armazenado: "65.811686249999994",
    formato: "#,##0.00",
    esperado: "65.81",
    joseEsperado: "67.37",
    diferenca: "1.56",
    rejeicaoBruta: "total Equatorial",
  },
  {
    id: "OUT-D",
    comportamento: "valor-final-manual",
    confiabilidade: "constante_observada_justificativa_pendente",
    formula: null,
    celulas: {
      E: "51.72",
      F: "1.6996899999999999",
      G: "0.2",
      H: "0",
      I: "0",
      J: "0",
      K: "0",
    },
    bruto: "70.3263734399999958624",
    armazenado: "165.4",
    formato: "#,##0.00",
    esperado: "165.40",
    joseEsperado: "70.33",
    diferenca: "-95.07",
    rejeicaoBruta: "tarifa total",
  },
  {
    id: "OUT-E",
    comportamento: "fixa-desconto-15",
    confiabilidade: "cache_coerente_com_formula_atual",
    formula: "=((E*F)*(1-G))+(H-I-J-K)",
    celulas: {
      E: "289",
      F: "1.169969",
      G: "0.15",
      H: "55.13",
      I: "0",
      J: "0",
      K: "0",
    },
    bruto: "342.53288485",
    armazenado: "342.53288484999996",
    formato: "#,##0.00",
    esperado: "342.53",
    joseEsperado: "342.53",
    diferenca: "0.00",
    rejeicaoBruta: null,
  },
];
export const pendenciasPlanilhasAtuais = [
  {
    comportamento: "somente-energia",
    formula: "=((E*F)*(1-G))",
    esperado: null,
    motivo:
      "Três fórmulas observadas sem resultado armazenado; não presumir valor calculado como cache.",
  },
  {
    comportamento: "classico",
    esperado: null,
    motivo: "Modelo clássico não encontrado nas abas de outubro examinadas.",
  },
  {
    comportamento: "pix",
    esperado: null,
    motivo:
      "Coluna final não comprova origem/consumo de ajuste PIX; permanece necessária referência associada ao ledger.",
  },
];
const fixa = { E: "100", F: "1.1", G: "0.2", H: "30", I: "0", J: "0", K: "0" };
const jose = {
  injecao: "100",
  unitario: "1",
  bandeira: "0.1",
  desconto: "20",
  total_equatorial: "30",
  ajuste_gdii: "0",
  modalidade: "GDI",
};
const caso = (
  id,
  celulas,
  entradaJose,
  bruto,
  esperado,
  classificacao,
  diferenca,
  motivo,
  extra = {},
) => ({
  id,
  modelo: "fixa",
  celulas: { ...fixa, ...celulas },
  jose: { ...jose, ...entradaJose },
  bruto,
  esperado,
  classificacao,
  diferenca,
  motivo,
  ...extra,
});
export const referencias = [
  caso(
    "fixa-fracao-percentual",
    {},
    {},
    "118.00",
    "118.00",
    "aprovado",
    "0.00",
    "0.2 na Central corresponde a 20 no José",
  ),
  caso(
    "desconto-zero",
    { G: "0" },
    { desconto: "0" },
    "140.0",
    "140.00",
    "aprovado",
    "0.00",
    "Sem desconto",
  ),
  caso(
    "desconto-integral",
    { G: "1" },
    { desconto: "100" },
    "30.0",
    "30.00",
    "aprovado",
    "0.00",
    "Desconto somente sobre energia",
  ),
  caso(
    "gdii",
    { K: "12.34" },
    { ajuste_gdii: "12.34", modalidade: "GDII" },
    "105.66",
    "105.66",
    "aprovado",
    "0.00",
    "GDII abatido",
  ),
  caso(
    "juros",
    { I: "1.23" },
    {},
    "116.77",
    "116.77",
    "divergente",
    "1.23",
    "José não abate juros",
  ),
  caso(
    "multa",
    { J: "2.34" },
    {},
    "115.66",
    "115.66",
    "divergente",
    "2.34",
    "José não abate multa",
  ),
  caso(
    "encargos-gdii",
    { I: "1.23", J: "2.34", K: "12.34" },
    { ajuste_gdii: "12.34", modalidade: "GDII" },
    "102.09",
    "102.09",
    "divergente",
    "3.57",
    "Juros e multa ausentes no José",
  ),
  caso(
    "pix-positivo",
    {},
    {},
    "123.25",
    "123.25",
    "divergente",
    "-5.25",
    "Ajuste PIX não aplicado no José",
    { pix: ["5.25"] },
  ),
  caso(
    "pix-negativo",
    {},
    {},
    "112.75",
    "112.75",
    "divergente",
    "5.25",
    "Ajuste PIX negativo",
    { pix: ["-5.25"] },
  ),
  caso(
    "pix-soma",
    {},
    {},
    "120.10",
    "120.10",
    "divergente",
    "-2.10",
    "Soma exata de ajustes já elegíveis e não consumidos",
    { pix: ["3.20", "-1.10"] },
  ),
  caso(
    "empate-arredondamento",
    { E: "1", F: "1.005", G: "0" },
    { injecao: "1", unitario: "1.005", bandeira: "0", desconto: "0" },
    "31.005",
    "31.00",
    "divergente",
    "0.01",
    "HALF_EVEN Central versus HALF_UP José",
  ),
  caso(
    "empate-invertido-total",
    { E: "1", F: "1.005", G: "0", H: "30.01" },
    {
      injecao: "1",
      unitario: "1.005",
      bandeira: "0",
      desconto: "0",
      total_equatorial: "30.01",
    },
    "31.015",
    "31.02",
    "aprovado",
    "0.00",
    "Arredondamento final pode coincidir apesar de políticas diferentes",
  ),
  caso(
    "tarifa-final",
    { F: "1.123456789" },
    { tarifa_total: "1.123456789", unitario: "", bandeira: "" },
    "119.8765431200",
    "119.88",
    "aprovado",
    "0.00",
    "Tarifa final explícita preservada",
  ),
  caso(
    "bandeira-zero",
    { F: "1" },
    { bandeira: "0" },
    "110.0",
    "110.00",
    "aprovado",
    "0.00",
    "Zero explícito",
  ),
  caso(
    "bandeira-ausente",
    { F: "1" },
    { bandeira: "" },
    "110.0",
    "110.00",
    "divergente",
    null,
    "José rejeita componente ausente; Central recebeu tarifa final",
    { rejeicao: "componentes da tarifa" },
  ),
  caso(
    "energia-ausente",
    { E: null },
    { injecao: "" },
    "30.00",
    "30.00",
    "divergente",
    null,
    "Central converte célula ausente em zero; José rejeita",
    { rejeicao: "injeção SCEE" },
  ),
  caso(
    "gdii-ausente",
    { K: null },
    { ajuste_gdii: "", modalidade: "GDII" },
    "118.00",
    "118.00",
    "divergente",
    null,
    "Central converte ausência em zero; José exige GDII",
    { rejeicao: "ajuste GDII" },
  ),
  caso(
    "fracao-sem-conversao",
    {},
    { desconto: "0.2" },
    "118.00",
    "118.00",
    "divergente",
    "21.78",
    "Fração copiada diretamente para percentual altera a cobrança",
  ),
  caso(
    "tarifa-ausente",
    { F: null },
    { unitario: "", bandeira: "" },
    "30.0",
    "30.00",
    "divergente",
    null,
    "Central trata célula ausente como zero; não há tarifa padrão presumida neste caso",
    { rejeicao: "componentes da tarifa" },
  ),
  caso(
    "sem-injecao-com-juros",
    { E: "0", I: "1.23" },
    { injecao: "0" },
    "28.77",
    "28.77",
    "divergente",
    "1.23",
    "José retorna total Equatorial sem retirar juros",
  ),
  caso(
    "classico-iluminacao",
    { E: "100", F: "140", H: "1", I: "0.1", M: "0.2", O: "15" },
    { total_equatorial: "59" },
    "147.00",
    "147.00",
    "sem_referencia_suficiente",
    null,
    "Total distribuidora 59 é somente uma ponte sintética (44+15); não comprova equivalência entre modelos",
    { modelo: "classico", jose: null },
  ),
  caso(
    "classico-iluminacao-ausente",
    { E: "100", F: "140", H: "1", I: "0.1", M: "0.2", O: null },
    {},
    "132.00",
    "132.00",
    "sem_referencia_suficiente",
    null,
    "Sem correspondência comprovada para o total Equatorial no José",
    { modelo: "classico", jose: null },
  ),
  {
    id: "pdf-sem-linha-preservada",
    modelo: "fixa",
    celulas: null,
    jose: null,
    bruto: null,
    esperado: null,
    classificacao: "sem_referencia_suficiente",
    diferenca: null,
    motivo: "Sem snapshot da linha preenchida não há resultado verificável",
  },
];
