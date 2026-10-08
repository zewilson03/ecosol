import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const numero = /-?\d[\d.]*(?:,\d+)?/g;
const br = (s) => s?.replace(/\./g, "").replace(",", ".");
const meses = [
  "JAN",
  "FEV",
  "MAR",
  "ABR",
  "MAI",
  "JUN",
  "JUL",
  "AGO",
  "SET",
  "OUT",
  "NOV",
  "DEZ",
];

// O título do quadro verde nem sempre está na camada de texto do PDF.
// A posição do número, junto à linha RAMAL, identifica a UC de cobrança;
// os números da seção SCEE ficam em outra região e não são candidatos.
export function extrairUcDoQuadro(itens, largura, altura) {
  if (!(largura > 0 && altura > 0)) return null;
  const visiveis = itens.filter((item) => "str" in item);
  const ramais = visiveis.filter(
    (item) =>
      /PERDAS DE TRANSFORMA[CÇ][AÃ]O\s*\/\s*RAMAL:/i.test(item.str) &&
      item.transform[4] < largura * 0.3,
  );
  const formato = /^\d{1,3}(?:\.\d{3}){2,3}-\d{2}$/;
  const candidatos = visiveis.filter((item) => {
    const x = item.transform[4];
    const y = item.transform[5];
    return (
      formato.test(item.str.trim()) &&
      x >= largura * 0.3 &&
      x <= largura * 0.6 &&
      y >= altura * 0.72 &&
      y <= altura * 0.9 &&
      ramais.some((ramal) => Math.abs(ramal.transform[5] - y) <= 6)
    );
  });
  return candidatos.length === 1 ? candidatos[0].str.trim() : null;
}

// Extração assistida: sugestões nunca liberam uma cobrança sem conferência.
export function extrairCampos(texto, { ucQuadro = null } = {}) {
  const normal = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  const dados = {};
  const evidencias = {};
  function guardar(campo, valor, linha) {
    if (valor !== undefined) {
      dados[campo] = valor;
      evidencias[campo] = linha.trim();
    }
  }
  const ucCanonica = (valor) =>
    valor.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const ucExplicita = normal.match(/NUMERO DA UC\s*\n?\s*([\d.\-]+)/);
  // Nesta versão da Equatorial, o título do quadro verde pode não integrar
  // a camada de texto. O número consta no rodapé e, por vezes, após RAMAL.
  // Nunca usar a UC da linha de injeção SCEE como UC de cobrança.
  const formatoUc = "(\\d{1,3}(?:\\.\\d{3}){2,3}-\\d{2})";
  const ucsRodape = [
    ...normal.matchAll(
      new RegExp(
        `^EQUATORIAL GOIAS DISTRIBUIDORA DE ENERGIA S/A\\s+${formatoUc}\\s+(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\\s*/\\s*20\\d{2}`,
        "gm",
      ),
    ),
  ];
  const ucsCabecalho = [
    ...normal.matchAll(
      new RegExp(
        `^PERDAS DE TRANSFORMACAO\\s*/\\s*RAMAL:\\s*[\\d,.]+%\\s+${formatoUc}\\s*$`,
        "gm",
      ),
    ),
  ];
  const valoresUc = [
    ...ucsRodape.map((item) => ucCanonica(item[1])),
    ...ucsCabecalho.map((item) => ucCanonica(item[1])),
    ...(ucExplicita ? [ucCanonica(ucExplicita[1])] : []),
  ];
  const ucDoQuadro =
    ucQuadro && new RegExp(`^${formatoUc}$`).test(ucQuadro)
      ? ucCanonica(ucQuadro)
      : null;
  const ucsDivergentes =
    new Set(valoresUc).size > 1 ||
    (ucDoQuadro && valoresUc.some((valor) => valor !== ucDoQuadro));
  if (!ucsDivergentes && ucDoQuadro)
    guardar("uc", ucDoQuadro, `Quadro verde da UC: ${ucQuadro}`);
  else if (
    !ucsDivergentes &&
    valoresUc.length &&
    (ucExplicita || ucsRodape.length)
  )
    guardar("uc", valoresUc[0], ucExplicita?.[0] ?? ucsRodape[0][0]);
  const ref = normal.match(
    /\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s*\/\s*(20\d{2})\b/,
  );
  if (ref)
    guardar(
      "competencia",
      `${ref[2]}-${String(meses.indexOf(ref[1]) + 1).padStart(2, "0")}`,
      ref[0],
    );
  const total = normal.match(
    /TOTAL A PAGAR[\s\S]{0,180}?R\$\s*\**\s*([\d.]+,\d{2})/,
  );
  if (total) guardar("total_equatorial", br(total[1]), total[0]);
  const venc = normal.match(
    /VENCIMENTO[\s\S]{0,180}?\b(\d{2})\/(\d{2})\/(20\d{2})\b/,
  );
  if (venc)
    guardar(
      "vencimento_equatorial",
      `${venc[3]}-${venc[2]}-${venc[1]}`,
      venc[0],
    );
  const resumos = normal
    .split(/\r?\n/)
    .slice(0, 40)
    .map((linha) => {
      const achado = linha.match(
        /^\s*(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s*\/\s*(20\d{2})\s+R\$\s*\**\s*([\d.]+,\d{2})\s+(\d{2})\/(\d{2})\/(20\d{2})\b/,
      );
      if (!achado) return null;
      const data = `${achado[6]}-${achado[5]}-${achado[4]}`;
      const instante = new Date(`${data}T12:00:00Z`);
      if (
        !Number.isFinite(instante.getTime()) ||
        instante.toISOString().slice(0, 10) !== data
      )
        return null;
      return {
        competencia: `${achado[2]}-${String(meses.indexOf(achado[1]) + 1).padStart(2, "0")}`,
        total: br(achado[3]),
        vencimento: data,
        linha,
      };
    })
    .filter(Boolean);
  const resumosDistintos = new Set(
    resumos.map((item) =>
      JSON.stringify([item.competencia, item.total, item.vencimento]),
    ),
  );
  if (
    resumosDistintos.size === 1 &&
    (!dados.competencia || dados.competencia === resumos[0].competencia)
  ) {
    if (!dados.competencia)
      guardar("competencia", resumos[0].competencia, resumos[0].linha);
    if (!dados.total_equatorial)
      guardar("total_equatorial", resumos[0].total, resumos[0].linha);
    if (!dados.vencimento_equatorial)
      guardar("vencimento_equatorial", resumos[0].vencimento, resumos[0].linha);
  }
  const linhas = normal.split(/\r?\n/);
  const injecoes = [],
    ajustes = [],
    bandeiras = [],
    consumosNaoCompensados = [];
  for (let i = 0; i < linhas.length; i++) {
    let linha = linhas[i];
    if (
      /INJECAO SCEE|PARC INJET|CONSUMO NAO COMPENSADO/.test(linha) &&
      !/KWH/.test(linha) &&
      /^\s*KWH\b/.test(linhas[i + 1] || "")
    )
      linha += " " + (linhas[i + 1] || "");
    const depois = linha.split(/KWH\s*/)[1];
    const valores = depois?.match(numero);
    if (/INJECAO SCEE/.test(linha) && valores?.length >= 3)
      injecoes.push({ valores, linha });
    if (/PARC INJET/.test(linha) && valores?.length >= 3)
      ajustes.push({ valores, linha });
    if (/BANDEIRA/.test(linha) && valores?.length >= 3)
      bandeiras.push({ valores, linha });
    if (/CONSUMO NAO COMPENSADO/.test(linha) && valores?.length >= 3)
      consumosNaoCompensados.push({ valores, linha });
  }
  // A tarifa comercial vem do consumo não compensado, não da injeção SCEE.
  // Múltiplas origens ou bandeiras exigem revisão; não somar taxas sem conhecer a base.
  if (injecoes.length === 1) {
    guardar("injecao", br(injecoes[0].valores[0]), injecoes[0].linha);
  }
  // Ausência de linha não é o mesmo que falha de leitura. Só assumir zero
  // quando a tabela de fornecimento estiver delimitada e contiver itens kWh.
  const inicioFornecimento = linhas.findIndex((linha) =>
    /^\s*FORNECIMENTO\s*$/.test(linha),
  );
  const fimFornecimento = linhas.findIndex(
    (linha, indice) =>
      indice > inicioFornecimento &&
      /^\s*(?:ITENS FINANCEIROS|TIPOS DE)/.test(linha),
  );
  const tabelaFornecimentoLegivel =
    inicioFornecimento >= 0 &&
    fimFornecimento > inicioFornecimento &&
    linhas
      .slice(inicioFornecimento + 1, fimFornecimento)
      .some((linha) => /\bKWH\b/.test(linha));
  const injecaoZeroInferida =
    injecoes.length === 0 &&
    tabelaFornecimentoLegivel &&
    !/\bINJECAO\b/.test(normal);
  if (injecaoZeroInferida)
    guardar(
      "injecao",
      "0",
      "Inferência: tabela de fornecimento legível sem linha de injeção SCEE; 0 kWh.",
    );
  if (consumosNaoCompensados.length === 1)
    guardar(
      "unitario",
      br(consumosNaoCompensados[0].valores[1]),
      consumosNaoCompensados[0].linha,
    );
  if (ajustes.length === 1)
    guardar("ajuste_gdii", br(ajustes[0].valores[2]), ajustes[0].linha);
  if (bandeiras.length === 1)
    guardar("bandeira", br(bandeiras[0].valores[1]), bandeiras[0].linha);
  const avisos = [
    "Confira todos os campos com o PDF antes de calcular. A tarifa completa soma o preço do consumo não compensado e a bandeira, ambos em R$/kWh.",
  ];
  if (ucsDivergentes)
    avisos.push(
      "Números de UC divergentes entre o quadro verde e outras áreas da fatura; confirme a UC no PDF antes de vincular o cliente.",
    );
  else if (!ucDoQuadro && dados.uc)
    avisos.push(
      "A posição da UC no quadro verde não pôde ser confirmada automaticamente; confira o número diretamente no PDF.",
    );
  if (injecaoZeroInferida)
    avisos.push(
      "Injeção SCEE assumida como 0 kWh pela ausência da linha na tabela de fornecimento; confirme no PDF.",
    );
  if (!dados.bandeira)
    avisos.push(
      "Bandeira não identificada. Informe o componente em R$/kWh ou selecione uma GDI aprovada do lote.",
    );
  if (
    injecoes.length > 1 ||
    ajustes.length > 1 ||
    bandeiras.length > 1 ||
    consumosNaoCompensados.length > 1
  )
    avisos.push(
      "Há múltiplas linhas de energia ou ajustes: revise a composição manualmente.",
    );
  if (texto.trim().length < 80)
    avisos.push(
      "PDF sem texto legível: preencha os campos manualmente. Reconhecimento de imagens ficará para uma próxima etapa.",
    );
  const camposEsperados = [
    ["uc", "Unidade consumidora"],
    ["competencia", "Competência"],
    ["injecao", "Injeção SCEE"],
    ["total_equatorial", "Total Equatorial"],
    ["vencimento_equatorial", "Vencimento Equatorial"],
    ["unitario", "Preço unitário"],
    ["bandeira", "Bandeira"],
  ];
  const identificados = camposEsperados.filter(([campo]) => dados[campo]);
  const pendencias = camposEsperados
    .filter(([campo]) => !dados[campo])
    .map(([, rotulo]) => rotulo);
  const qualidade = {
    modo: texto.trim().length < 80 ? "manual" : "texto",
    campos_identificados: identificados.length,
    campos_esperados: camposEsperados.length,
    percentual: Math.round(
      (identificados.length / camposEsperados.length) * 100,
    ),
    pendencias,
    ...(injecaoZeroInferida ? { campos_inferidos: ["Injeção SCEE"] } : {}),
  };
  return { dados, evidencias, avisos, qualidade };
}

export async function lerPdf(buffer) {
  const tarefa = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
    stopAtErrors: true,
  });
  try {
    const documento = await tarefa.promise;
    if (documento.numPages > 10)
      throw new Error("Envie uma fatura com até 10 páginas.");
    const paginas = [];
    let ucQuadro = null;
    for (let p = 1; p <= documento.numPages; p++) {
      const pagina = await documento.getPage(p);
      const conteudo = await pagina.getTextContent();
      if (p === 1)
        ucQuadro = extrairUcDoQuadro(
          conteudo.items,
          pagina.view[2] - pagina.view[0],
          pagina.view[3] - pagina.view[1],
        );
      const linhas = new Map();
      for (const item of conteudo.items) {
        if (!("str" in item)) continue;
        const y = Math.round(item.transform[5] / 3) * 3;
        if (!linhas.has(y)) linhas.set(y, []);
        linhas.get(y).push(item);
      }
      paginas.push(
        [...linhas.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([, itens]) =>
            itens
              .sort((a, b) => a.transform[4] - b.transform[4])
              .map((i) => i.str)
              .join(" "),
          )
          .join("\n"),
      );
    }
    const texto = paginas.join("\n\n").slice(0, 200000);
    return {
      texto,
      paginas: documento.numPages,
      ...extrairCampos(texto, { ucQuadro }),
    };
  } finally {
    await tarefa.destroy();
  }
}
