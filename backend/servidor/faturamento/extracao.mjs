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

// Extração assistida: sugestões nunca liberam uma cobrança sem conferência.
export function extrairCampos(texto) {
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
  const uc = normal.match(/NUMERO DA UC\s*\n?\s*([\d.\-]+)/);
  if (uc)
    guardar("uc", uc[1].replace(/\D/g, "").replace(/^0+(?=\d)/, ""), uc[0]);
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
  const linhas = normal.split(/\r?\n/);
  const injecoes = [],
    ajustes = [],
    bandeiras = [];
  for (let i = 0; i < linhas.length; i++) {
    let linha = linhas[i];
    if (/INJECAO SCEE|PARC INJET/.test(linha) && !/KWH/.test(linha))
      linha += " " + (linhas[i + 1] || "");
    const depois = linha.split(/KWH\s*/)[1];
    const valores = depois?.match(numero);
    if (/INJECAO SCEE/.test(linha) && valores?.length >= 3)
      injecoes.push({ valores, linha });
    if (/PARC INJET/.test(linha) && valores?.length >= 3)
      ajustes.push({ valores, linha });
    if (/BANDEIRA/.test(linha) && valores?.length >= 3)
      bandeiras.push({ valores, linha });
  }
  // Múltiplas origens ou bandeiras exigem revisão; não somar taxas sem conhecer a base.
  if (injecoes.length === 1) {
    guardar("injecao", br(injecoes[0].valores[0]), injecoes[0].linha);
    guardar("unitario", br(injecoes[0].valores[1]), injecoes[0].linha);
  }
  if (ajustes.length === 1)
    guardar("ajuste_gdii", br(ajustes[0].valores[2]), ajustes[0].linha);
  if (bandeiras.length === 1)
    guardar("bandeira", br(bandeiras[0].valores[1]), bandeiras[0].linha);
  const avisos = [
    "Confira todos os campos com o PDF antes de calcular. O preço SCEE extraído pode não ser a tarifa comercial completa.",
  ];
  if (!dados.bandeira)
    avisos.push(
      "Bandeira não identificada. Informe o componente em R$/kWh ou selecione uma GDI aprovada do lote.",
    );
  if (injecoes.length > 1 || ajustes.length > 1 || bandeiras.length > 1)
    avisos.push(
      "Há múltiplas linhas de energia ou ajustes: revise a composição manualmente.",
    );
  if (!texto.trim())
    avisos.push(
      "PDF sem texto legível: preencha os campos manualmente. Reconhecimento de imagens ficará para uma próxima etapa.",
    );
  return { dados, evidencias, avisos };
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
    for (let p = 1; p <= documento.numPages; p++) {
      const pagina = await documento.getPage(p);
      const conteudo = await pagina.getTextContent();
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
    return { texto, ...extrairCampos(texto) };
  } finally {
    await tarefa.destroy();
  }
}
