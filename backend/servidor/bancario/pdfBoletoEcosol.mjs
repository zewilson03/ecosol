import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const moeda = (centavos) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    centavos / 100,
  );
const decimal = (valor) => String(valor ?? "0").replace(".", ",");
const cores = {
  escuro: rgb(0.08, 0.23, 0.28),
  verde: rgb(0.04, 0.45, 0.43),
  azul: rgb(0.16, 0.46, 0.62),
  amarelo: rgb(0.93, 0.68, 0.21),
  cinza: rgb(0.39, 0.49, 0.54),
  claro: rgb(0.94, 0.97, 0.97),
};

export async function gerarPdfBoletoEcosol({
  operacao,
  demonstrativo,
  pdfBanco,
}) {
  if (operacao.tipo !== "cobranca" || !demonstrativo)
    throw new Error("Demonstrativo indisponível para esta operação.");
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([595.28, 841.89]);
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = pagina.getSize();
  const esquerda = 46;
  const direita = width - 46;
  const limitar = (valor, fonteUsada, tamanho, largura) => {
    let resultado = String(valor)
      .replace(/[−–—]/g, "-")
      .replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, "?");
    if (fonteUsada.widthOfTextAtSize(resultado, tamanho) <= largura)
      return resultado;
    while (
      resultado.length &&
      fonteUsada.widthOfTextAtSize(`${resultado}...`, tamanho) > largura
    )
      resultado = resultado.slice(0, -1);
    return `${resultado}...`;
  };
  const texto = (
    valor,
    x,
    y,
    tamanho = 10,
    cor = cores.escuro,
    destaque = false,
  ) =>
    pagina.drawText(
      limitar(valor, destaque ? negrito : fonte, tamanho, direita - x),
      {
        x,
        y,
        size: tamanho,
        font: destaque ? negrito : fonte,
        color: cor,
        maxWidth: direita - x,
      },
    );
  const linha = (y) =>
    pagina.drawLine({
      start: { x: esquerda, y },
      end: { x: direita, y },
      thickness: 0.7,
      color: rgb(0.81, 0.88, 0.88),
    });
  const linhaValor = (rotulo, valor, y, destaque = false) => {
    const largura = (destaque ? negrito : fonte).widthOfTextAtSize(
      valor,
      destaque ? 11 : 9,
    );
    texto(
      limitar(
        rotulo,
        destaque ? negrito : fonte,
        destaque ? 11 : 9,
        direita - esquerda - largura - 42,
      ),
      esquerda + 12,
      y,
      destaque ? 11 : 9,
      cores.escuro,
      destaque,
    );
    texto(
      valor,
      direita - 12 - largura,
      y,
      destaque ? 11 : 9,
      cores.escuro,
      destaque,
    );
  };

  pagina.drawRectangle({
    x: 0,
    y: height - 112,
    width,
    height: 112,
    color: cores.escuro,
  });
  texto("ECOSOL", esquerda, height - 53, 24, rgb(1, 1, 1), true);
  texto(
    "Demonstrativo da cobrança de energia",
    esquerda,
    height - 77,
    11,
    rgb(0.85, 0.95, 0.94),
  );
  texto(
    pdfBanco
      ? "Boleto bancário original nas páginas seguintes"
      : "Prévia - sem validade para pagamento",
    esquerda,
    height - 96,
    8,
    rgb(0.91, 0.79, 0.47),
  );
  const origem = operacao.snapshot.origem;
  const unidade = operacao.snapshot.unidade;
  const cliente = operacao.snapshot.cliente;
  texto(
    cliente?.nome ?? "Cliente não informado",
    esquerda,
    695,
    14,
    cores.escuro,
    true,
  );
  texto(
    `UC ${unidade?.uc ?? "-"}   |   Competência ${unidade?.competencia ?? "-"}`,
    esquerda,
    675,
    9,
    cores.cinza,
  );
  texto(
    `Fatura #${origem?.documento_id ?? "-"}   |   Vencimento ${operacao.snapshot.cobranca?.vencimento ?? "-"}`,
    esquerda,
    659,
    9,
    cores.cinza,
  );
  linha(641);
  texto("COMO O VALOR FOI CALCULADO", esquerda, 619, 9, cores.verde, true);
  const d = demonstrativo;
  linhaValor(
    `Energia injetada: ${decimal(d.energia_injetada_kwh)} kWh × tarifa de R$ ${decimal(d.tarifa_kwh)}/kWh`,
    moeda(d.energia_sem_desconto_centavos),
    595,
  );
  linhaValor(
    `Desconto contratado: ${decimal(d.desconto_percentual)}%`,
    `- ${moeda(d.energia_sem_desconto_centavos - d.energia_com_desconto_centavos)}`,
    575,
  );
  linhaValor(
    "Energia Ecosol com desconto",
    moeda(d.energia_com_desconto_centavos),
    555,
  );
  if (d.equatorial_centavos !== null)
    linhaValor("+ Fatura Equatorial", moeda(d.equatorial_centavos), 535);
  if (d.tarifa_minima_centavos)
    linhaValor(
      "+ Parcela mínima de energia",
      moeda(d.tarifa_minima_centavos),
      525,
    );
  if (d.iluminacao_centavos)
    linhaValor("+ Iluminação pública", moeda(d.iluminacao_centavos), 505);
  if (d.juros_equatorial_centavos)
    linhaValor(
      "- Juros já incluídos na Equatorial",
      moeda(d.juros_equatorial_centavos),
      515,
    );
  if (d.multa_equatorial_centavos)
    linhaValor(
      "- Multa já incluída na Equatorial",
      moeda(d.multa_equatorial_centavos),
      495,
    );
  if (d.ajuste_gdii_centavos)
    linhaValor("- Ajuste GDII", moeda(d.ajuste_gdii_centavos), 475);
  if (d.encargos_atraso_centavos)
    linhaValor(
      "+ Encargos de boleto anterior",
      moeda(d.encargos_atraso_centavos),
      455,
    );
  linha(440);
  pagina.drawRectangle({
    x: esquerda,
    y: 399,
    width: direita - esquerda,
    height: 34,
    color: cores.claro,
  });
  linhaValor(
    "TOTAL A PAGAR À ECOSOL",
    moeda(d.total_ecosol_centavos),
    411,
    true,
  );
  texto("COMPARAÇÃO DE VALORES", esquerda, 374, 9, cores.verde, true);
  const barras = [
    ...(d.equatorial_centavos === null
      ? []
      : [
          {
            nome: "Fatura Equatorial",
            valor: d.equatorial_centavos,
            cor: rgb(0.57, 0.68, 0.73),
          },
        ]),
    {
      nome: "Sem desconto Ecosol (estimativa)",
      valor: d.referencia_sem_desconto_centavos,
      cor: cores.azul,
    },
    {
      nome: "Total Ecosol a pagar",
      valor: d.total_ecosol_centavos,
      cor: cores.verde,
    },
  ];
  const maior = Math.max(...barras.map((item) => item.valor), 1);
  for (const [indice, item] of barras.entries()) {
    const y = 348 - indice * 28;
    texto(item.nome, esquerda, y, 9);
    texto(
      moeda(item.valor),
      direita - fonte.widthOfTextAtSize(moeda(item.valor), 9),
      y,
      9,
    );
    pagina.drawRectangle({
      x: esquerda,
      y: y - 17,
      width: ((direita - esquerda) * item.valor) / maior,
      height: 10,
      color: item.cor,
    });
  }
  texto(
    `Economia estimada com o desconto: ${moeda(d.economia_centavos)}`,
    esquerda,
    258,
    10,
    cores.verde,
    true,
  );
  texto("CONSUMO DE ENERGIA", esquerda, 229, 9, cores.verde, true);
  if (d.consumo_total_kwh) {
    texto(
      `Consumo total: ${decimal(d.consumo_total_kwh)} kWh`,
      esquerda,
      209,
      9,
    );
    pagina.drawRectangle({
      x: esquerda,
      y: 187,
      width: direita - esquerda,
      height: 10,
      color: rgb(0.83, 0.89, 0.91),
    });
    const proporcao = Math.min(
      1,
      Number(d.energia_injetada_kwh) / Number(d.consumo_total_kwh),
    );
    pagina.drawRectangle({
      x: esquerda,
      y: 187,
      width: (direita - esquerda) * proporcao,
      height: 10,
      color: cores.amarelo,
    });
    texto(
      `Parcela injetada pela geração: ${decimal(d.energia_injetada_kwh)} kWh`,
      esquerda,
      170,
      8,
      cores.cinza,
    );
  } else {
    texto(
      "Consumo total não identificado com segurança no PDF Equatorial.",
      esquerda,
      207,
      9,
      cores.cinza,
    );
    texto(
      `Energia injetada considerada: ${decimal(d.energia_injetada_kwh)} kWh`,
      esquerda,
      190,
      9,
    );
  }
  linha(139);
  texto(
    "A referência sem desconto é uma simulação com a mesma energia e os mesmos componentes da cobrança.",
    esquerda,
    120,
    8,
    cores.cinza,
  );
  texto(
    "Não representa outra fatura emitida pela Equatorial. Valores das parcelas são apenas demonstrativos;",
    esquerda,
    108,
    8,
    cores.cinza,
  );
  texto(
    "o total aprovado é arredondado somente no fechamento do cálculo.",
    esquerda,
    96,
    8,
    cores.cinza,
  );
  texto(
    pdfBanco
      ? "Para pagar, use exclusivamente o boleto bancário da próxima página."
      : "A página seguinte é uma simulação. Não autoriza pagamento.",
    esquerda,
    61,
    8,
    cores.escuro,
    true,
  );

  if (!pdfBanco) {
    const folha = pdf.addPage([595.28, 841.89]);
    const escrever = (valor, x, y, tamanho = 10, destaque = false) => {
      folha.drawText(limitar(valor, destaque ? negrito : fonte, tamanho, 495 - x), {
        x,
        y,
        size: tamanho,
        font: destaque ? negrito : fonte,
        color: cores.escuro,
      });
    };
    folha.drawRectangle({
      x: 0,
      y: 745,
      width: 595.28,
      height: 96,
      color: cores.escuro,
    });
    folha.drawText("ECOSOL · PRÉVIA DO BOLETO", {
      x: 46,
      y: 795,
      size: 17,
      font: negrito,
      color: rgb(1, 1, 1),
    });
    folha.drawText("SIMULAÇÃO · SEM VALIDADE PARA PAGAMENTO", {
      x: 46,
      y: 769,
      size: 10,
      font: negrito,
      color: rgb(0.95, 0.77, 0.36),
    });
    escrever("Dados conhecidos antes do registro bancário", 46, 711, 12, true);
    escrever(`Pagador: ${cliente?.nome ?? "Não informado"}`, 46, 675);
    escrever(`UC: ${unidade?.uc ?? "-"}`, 46, 649);
    escrever(`Competência: ${unidade?.competencia ?? "-"}`, 46, 623);
    escrever(`Vencimento solicitado: ${operacao.snapshot.cobranca?.vencimento ?? "-"}`, 46, 597);
    escrever(`Valor aprovado: ${moeda(d.total_ecosol_centavos)}`, 46, 571, 13, true);
    folha.drawLine({
      start: { x: 46, y: 540 },
      end: { x: 549, y: 540 },
      thickness: 0.7,
      color: rgb(0.81, 0.88, 0.88),
    });
    escrever("Dados gerados somente pelo Sicoob após o registro", 46, 509, 11, true);
    escrever("Beneficiário bancário, nosso número e linha digitável: aguardando registro", 46, 482, 9);
    escrever("Código de barras e instruções de pagamento: aguardando registro", 46, 458, 9);
    folha.drawRectangle({
      x: 46,
      y: 321,
      width: 503,
      height: 90,
      color: cores.claro,
    });
    escrever("Esta página mostra a composição esperada do boleto.", 62, 377, 10, true);
    escrever("O documento bancário exato será anexado somente após resposta do Sicoob.", 62, 353, 9);
    escrever("Não envie esta prévia ao cliente para pagamento.", 62, 332, 9, true);
  }
  if (pdfBanco) {
    const original = await PDFDocument.load(pdfBanco, {
      ignoreEncryption: false,
    });
    const paginas = await pdf.copyPages(original, original.getPageIndices());
    for (const paginaOriginal of paginas) pdf.addPage(paginaOriginal);
  }
  return Buffer.from(await pdf.save());
}
