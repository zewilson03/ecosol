import { Worker } from "node:worker_threads";
import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { validarContrato, validarUnidade, falhar } from "./regras.mjs";

export const camposImportacao = [
  {
    chave: "nome",
    rotulo: "Nome / razão social",
    aliases: [
      "nome",
      "cliente",
      "clientes",
      "razao social",
      "nome razao social",
    ],
  },
  {
    chave: "documento",
    rotulo: "CPF/CNPJ",
    aliases: ["cpf", "cnpj", "cpf cnpj", "documento"],
  },
  {
    chave: "uc",
    rotulo: "Unidade consumidora",
    aliases: ["uc", "nova uc", "unidade consumidora", "numero da uc"],
  },
  {
    chave: "email",
    rotulo: "E-mail de cobrança",
    aliases: ["email", "e mail", "email de cobranca", "e mail de cobranca"],
  },
  {
    chave: "dia_vencimento",
    rotulo: "Dia preferido de vencimento",
    aliases: [
      "dia",
      "dia vencimento",
      "dia de vencimento",
      "dia preferido de vencimento",
    ],
  },
  {
    chave: "modalidade",
    rotulo: "Modalidade GDI/GDII",
    aliases: ["modalidade", "tipo gd", "gdi gdii", "modalidade gdi gdii"],
  },
  {
    chave: "desconto",
    rotulo: "Desconto (%)",
    aliases: ["desconto", "desconto contratado"],
  },
  {
    chave: "inicio",
    rotulo: "Vigência inicial (competência)",
    aliases: [
      "inicio",
      "vigencia",
      "competencia",
      "vigencia inicial competencia",
    ],
  },
];
const normal = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const meses = new Set([
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
]);

function abaMensal(nome) {
  const valor = normal(nome);
  const partes = valor.split(" ");
  return (
    meses.has(partes[0]) &&
    (partes.length === 1 ||
      (partes.length <= 3 && partes.slice(1).some((p) => /^\d{1,4}$/.test(p))))
  );
}

function linhaCabecalho(aba) {
  let encontrada = null;
  for (let i = 0; i < aba.linhas.length; i++) {
    const rotulos = aba.linhas[i].map((c) => normal(c.valor));
    const novaUc = rotulos.some((r) =>
      ["nova uc", "uc2", "uc nova"].includes(r),
    );
    const boleto = rotulos.some((r) => r.includes("boleto"));
    if (novaUc && boleto) encontrada = i + 1;
  }
  if (encontrada) return encontrada;
  return /^(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s+-\s+\d{2,4}/.test(
    normal(aba.nome),
  )
    ? 1
    : null;
}

export function analisarEstruturaMensal(abas) {
  const candidatas = [...abas]
    .reverse()
    .map((aba) => ({ aba, cabecalho: linhaCabecalho(aba) }))
    .filter((item) => abaMensal(item.aba.nome) && item.cabecalho);
  if (!candidatas.length)
    return {
      compativel: false,
      motivo:
        "Não foi encontrada uma aba mensal com Nova UC e Valor do boleto.",
      problemas: [],
    };
  const { aba, cabecalho } = candidatas[0];
  const rotulos = aba.linhas[cabecalho - 1].map((c) => normal(c.valor));
  const classica =
    rotulos.includes("energia injetada") &&
    rotulos.some((r) => r.includes("energia consumida"));
  const esperados = classica
    ? new Map([
        [0, ["usina"]],
        [1, ["client"]],
        [2, ["uc"]],
        [3, ["uc"]],
        [4, ["energia", "injet"]],
        [5, ["energia", "consum"]],
        [16, ["boleto"]],
      ])
    : new Map([
        [0, ["usina"]],
        [1, ["client"]],
        [2, ["uc"]],
        [3, ["uc"]],
        [4, ["energia", "injet"]],
        [5, ["valor", "kwh"]],
        [6, ["desconto"]],
        [7, ["total", "pagar"]],
        [8, ["juros"]],
        [9, ["multa"]],
        [10, ["desconto", "gd"]],
        [11, ["valor", "boleto"]],
      ]);
  const problemas = [];
  for (const [indice, termos] of esperados) {
    const encontrado = rotulos[indice] ?? "";
    if (!termos.every((termo) => encontrado.includes(termo)))
      problemas.push(
        `Coluna ${indice + 1}: esperado ${termos.join("/")}; encontrado “${aba.linhas[cabecalho - 1][indice]?.valor ?? "vazio"}”.`,
      );
  }
  const dados = aba.linhas
    .slice(cabecalho)
    .filter((linha) =>
      [linha[2], linha[3]].some(
        (c) => (c?.valor ?? "").replace(/\D/g, "").length >= 5,
      ),
    );
  const colunasEntrada = classica ? [4, 5, 7] : [4, 5, 7, 8, 9, 10];
  const pendentes = dados.filter((linha) => {
    const valores = colunasEntrada.map(
      (indice) => linha[indice]?.valor?.trim() ?? "",
    );
    const energia = (linha[4]?.valor ?? "").replace(",", ".");
    return (
      valores.every((valor) => !valor) || !energia || Number(energia) === 0
    );
  }).length;
  const ucs = dados
    .map((linha) =>
      (linha[3]?.valor || linha[2]?.valor || "")
        .replace(/\D/g, "")
        .replace(/^0+(?=\d)/, ""),
    )
    .filter(Boolean);
  const repetidas = [...new Set(ucs.filter((uc, i) => ucs.indexOf(uc) !== i))];
  return {
    compativel: problemas.length === 0,
    motivo: problemas.length
      ? "A estrutura mensal foi alterada e precisa de revisão."
      : "Estrutura mensal reconhecida automaticamente.",
    aba: aba.nome,
    cabecalho,
    modelo: classica ? "Clássico de rateio" : "Fórmula fixa Ecosol",
    mapa: { nome: 1, uc: 3, desconto: classica ? 12 : 6 },
    linhas: dados.length,
    linhas_pendentes: pendentes,
    linhas_preenchidas: dados.length - pendentes,
    ucs,
    ucs_repetidas: repetidas,
    problemas,
  };
}

export function lerExcel(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./leitorExcel.worker.mjs", import.meta.url),
      { workerData: buffer },
    );
    let concluido = false;
    const finalizar = (erro, dados) => {
      if (concluido) return;
      concluido = true;
      clearTimeout(timer);
      void worker.terminate();
      erro ? reject(erro) : resolve(dados);
    };
    const timer = setTimeout(
      () =>
        finalizar(
          new Error("A leitura ultrapassou 25 segundos. Use um arquivo menor."),
        ),
      25000,
    );
    worker.once("message", (m) =>
      finalizar(m.erro ? new Error(m.erro) : null, m.abas),
    );
    worker.once("error", (erro) =>
      finalizar(
        new Error(
          "Não foi possível ler a planilha dentro dos limites de memória. " +
            erro.message,
        ),
      ),
    );
    worker.once("exit", () => {
      if (!concluido)
        finalizar(new Error("A leitura da planilha foi interrompida."));
    });
  });
}

export function resumirAbas(abas) {
  return abas.map((a) => ({
    nome: a.nome,
    total_linhas: a.linhas.length,
    amostra: a.linhas.slice(0, 30),
  }));
}
export function sugerirMapeamento(cabecalho) {
  const mapa = {};
  for (const campo of camposImportacao) {
    const novas = cabecalho
      .map((c, i) => (normal(c.valor) === "nova uc" ? i : -1))
      .filter((i) => i >= 0);
    if (campo.chave === "uc" && novas.length === 1) {
      mapa.uc = novas[0];
      continue;
    }
    const indices = cabecalho
      .map((c, i) => (campo.aliases.includes(normal(c.valor)) ? i : -1))
      .filter((i) => i >= 0);
    mapa[campo.chave] = indices.length === 1 ? indices[0] : "";
  }
  return mapa;
}
function lerCampo(celula, chave) {
  if (!celula) return "";
  if (["formula", "erro"].includes(celula.tipo))
    throw new Error(
      "Há fórmula ou erro em um campo selecionado. Importe valores conferidos.",
    );
  let valor = celula.valor.trim();
  if (chave === "desconto") {
    if (celula.tipo === "percentual")
      valor = new Decimal(valor).times(100).toFixed();
    else valor = valor.replace(/\s*%$/, "");
  }
  if (chave === "inicio") {
    if (/^20\d{2}-\d{2}-\d{2}$/.test(valor)) valor = valor.slice(0, 7);
    else if (/^\d{2}\/20\d{2}$/.test(valor))
      valor = valor.slice(3) + "-" + valor.slice(0, 2);
  }
  if (chave === "modalidade") valor = valor.toUpperCase().replace(/\s/g, "");
  return valor;
}

export function prepararImportacao(abas, config, banco) {
  const aba = abas.find((a) => a.nome === config.aba);
  const cabecalho = Number(config.cabecalho);
  if (
    !aba ||
    !Number.isInteger(cabecalho) ||
    cabecalho < 1 ||
    cabecalho > Math.min(30, aba.linhas.length)
  )
    falhar("Selecione uma aba e uma linha de cabeçalho entre 1 e 30.");
  const mapa = config.mapa ?? {};
  const indices = camposImportacao
    .map((c) => mapa[c.chave])
    .filter((i) => i !== "" && i !== undefined && i !== null);
  if (
    indices.some(
      (i) =>
        !Number.isInteger(i) || i < 0 || i >= aba.linhas[cabecalho - 1].length,
    ) ||
    new Set(indices).size !== indices.length
  )
    falhar("Associe os campos a colunas diferentes da planilha.");
  if (!Number.isInteger(mapa.nome) || !Number.isInteger(mapa.uc))
    falhar(
      "Associe pelo menos o nome e a UC. Os demais campos podem ser completados no sistema.",
    );
  const linhas = [];
  for (let r = cabecalho; r < aba.linhas.length; r++) {
    const cells = aba.linhas[r];
    if (![mapa.nome, mapa.uc].some((i) => cells[i]?.valor.trim())) continue;
    const raw = {};
    const item = {
      linha: r + 1,
      status: "Válida",
      mensagem: "Nova unidade e contrato",
      dados: raw,
    };
    const errosLeitura = [];
    const correcoes = config.correcoes?.[r + 1] ?? {};
    item.complementos = {};
    for (const campo of camposImportacao) {
      const chave = campo.chave;
      try {
        if (Object.hasOwn(correcoes, chave)) {
          if (
            typeof correcoes[chave] !== "string" ||
            correcoes[chave].length > 180
          )
            throw new Error("O campo informado deve ter até 180 caracteres.");
          raw[chave] = lerCampo(
            { valor: correcoes[chave], tipo: "texto" },
            chave,
          );
          item.complementos[chave] = raw[chave];
        } else if (Number.isInteger(mapa[chave])) {
          raw[chave] = lerCampo(cells[mapa[chave]], chave);
        } else {
          const padrao = ["modalidade", "inicio"].includes(chave)
            ? config.padroes?.[chave]
            : "";
          raw[chave] =
            typeof padrao === "string"
              ? lerCampo({ valor: padrao, tipo: "texto" }, chave)
              : "";
          if (raw[chave]) item.complementos[chave] = raw[chave];
        }
      } catch (e) {
        raw[chave] = "";
        errosLeitura.push(`${campo.rotulo}: ${e.message}`);
      }
    }
    try {
      if (errosLeitura.length) throw new Error(errosLeitura.join(" "));
      item.unidade = validarUnidade({ ...raw, usina_id: config.usina_id });
      item.contrato = validarContrato(raw);
      const modalidadeUsina = banco
        .prepare(
          "SELECT modalidade FROM usinas_modalidades WHERE usina_id=? AND inicio<=? ORDER BY inicio DESC LIMIT 1",
        )
        .get(item.unidade.usina_id, item.contrato.inicio)?.modalidade;
      const primeiraVigencia = banco
        .prepare(
          "SELECT MIN(inicio) AS inicio FROM usinas_modalidades WHERE usina_id=?",
        )
        .get(item.unidade.usina_id)?.inicio;
      if (
        !modalidadeUsina &&
        (!primeiraVigencia || item.contrato.inicio >= primeiraVigencia)
      )
        throw new Error(
          "A usina não tem modalidade vigente nesta competência.",
        );
      if (modalidadeUsina && item.contrato.modalidade !== modalidadeUsina)
        throw new Error(
          `A modalidade da planilha (${item.contrato.modalidade}) difere da usina (${modalidadeUsina}) nesta competência.`,
        );
      const existente = banco
        .prepare("SELECT * FROM faturamento_unidades WHERE uc=?")
        .get(item.unidade.uc);
      if (existente) {
        const contrato = banco
          .prepare(
            "SELECT * FROM faturamento_contratos WHERE unidade_id=? AND inicio=?",
          )
          .get(existente.id, item.contrato.inicio);
        const igual =
          Object.keys(item.unidade).every(
            (k) => item.unidade[k] === existente[k],
          ) &&
          contrato &&
          Object.keys(item.contrato).every(
            (k) => item.contrato[k] === contrato[k],
          );
        item.status = igual ? "Já cadastrada" : "Conflito";
        item.mensagem = igual
          ? "Nenhuma alteração será feita"
          : "UC existente com dados diferentes. Revise no cadastro; a importação não sobrescreve registros.";
      }
    } catch (e) {
      item.status = "Erro";
      item.mensagem = e.message;
    }
    linhas.push(item);
  }
  if (linhas.length > 2000) falhar("Importe até 2.000 cadastros por arquivo.");
  const contagem = new Map();
  for (const l of linhas)
    if (l.unidade)
      contagem.set(l.unidade.uc, (contagem.get(l.unidade.uc) ?? 0) + 1);
  for (const l of linhas)
    if (l.unidade && contagem.get(l.unidade.uc) > 1) {
      l.status = "Erro";
      l.mensagem =
        "UC repetida nesta planilha. Mantenha uma linha por unidade nesta importação.";
    }
  return {
    aba: aba.nome,
    cabecalho,
    linhas,
    validas: linhas.filter((l) => l.status === "Válida").length,
    ignoradas: linhas.filter((l) => l.status === "Já cadastrada").length,
    problemas: linhas.filter((l) => ["Erro", "Conflito"].includes(l.status))
      .length,
  };
}

function formatar(sheet, larguras) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF123B61" },
  };
  sheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
  sheet.getRow(1).height = 34;
  larguras.forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: larguras.length },
  };
}
export async function criarModelo() {
  const wb = new ExcelJS.Workbook(),
    s = wb.addWorksheet("Cadastros");
  s.addRow(camposImportacao.map((c) => c.rotulo));
  formatar(s, [32, 23, 23, 32, 22, 22, 18, 24]);
  for (const coluna of [2, 3, 8]) s.getColumn(coluna).numFmt = "@";
  const ajuda = wb.addWorksheet("Orientações");
  ajuda.addRow(["Como preparar os cadastros"]);
  [
    "Preencha a aba Cadastros: uma linha por unidade consumidora.",
    "CPF/CNPJ e UC: mantenha como texto para preservar zeros à esquerda.",
    "Desconto: digite 25 ou 25%. Células percentuais do Excel também são aceitas.",
    "Vigência: use AAAA-MM (ex.: 2026-09). Dia preferido: número de 1 a 31.",
    "Modalidade: GDI ou GDII. Todos os oito campos são obrigatórios.",
    "Use valores, não fórmulas. A importação mostrará uma prévia antes de gravar.",
    "Cadastros existentes não serão sobrescritos. Revise divergências no painel.",
  ].forEach((t) => ajuda.addRow([t]));
  formatar(ajuda, [105]);
  ajuda.autoFilter = undefined;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function exportarCalculos(registros) {
  const wb = new ExcelJS.Workbook(),
    s = wb.addWorksheet("Conferência Ecosol");
  s.addRow([
    "Cobrança ID",
    "Cliente",
    "CPF/CNPJ",
    "UC",
    "Competência",
    "Lote",
    "Situação",
    "GDI/GDII",
    "Injeção SCEE (kWh)",
    "Unitário com tributos (R$/kWh)",
    "Bandeira (R$/kWh)",
    "Tarifa completa (R$/kWh)",
    "Desconto (%)",
    "Consumo com desconto (R$)",
    "Total Equatorial (R$)",
    "Ajuste GDII (R$)",
    "Valor Ecosol (R$)",
    "Vencimento Equatorial",
    "Vencimento Ecosol",
    "Fatura de referência ID",
    "Versão do cálculo",
    "Usina no cálculo",
  ]);
  for (const r of registros) {
    const m = JSON.parse(r.memoria),
      e = m.entradas;
    s.addRow([
      r.id,
      m.unidade.nome,
      m.unidade.documento,
      m.unidade.uc,
      m.competencia,
      r.lote,
      r.status,
      m.contrato.modalidade,
      Number(e.injecao),
      Number(e.unitario),
      Number(e.bandeira),
      Number(m.tarifa_completa),
      Number(e.desconto),
      m.consumo_centavos / 100,
      m.equatorial_centavos / 100,
      m.ajuste_centavos / 100,
      m.total_centavos / 100,
      m.vencimento_equatorial,
      m.vencimento_ecosol,
      m.fonte.documento_id,
      m.regra,
      m.unidade.usina_nome ?? "Não registrada nesta memória",
    ]);
  }
  formatar(
    s,
    [
      15, 32, 23, 22, 16, 28, 34, 14, 23, 26, 23, 26, 18, 26, 23, 23, 23, 24,
      24, 24, 20, 32,
    ],
  );
  [3, 4, 5, 18, 19].forEach((c) => (s.getColumn(c).numFmt = "@"));
  [10, 11, 12].forEach((c) => (s.getColumn(c).numFmt = "0.000000000"));
  [13, 14, 15, 16, 17].forEach((c) => (s.getColumn(c).numFmt = "#,##0.00"));
  const info = wb.addWorksheet("Sobre o relatório");
  [
    "Demonstrativo interno — sem validade para pagamento",
    "Valores calculados no sistema, exportados como fotografia do histórico.",
    "Não contém boletos e não indica liquidação bancária.",
    "Cobranças sem cálculo não entram neste relatório.",
    "Arquivo novo: a planilha original no Drive não é modificada.",
    "Origem: documentos e memórias de cálculo registrados no sistema Ecosol.",
    `Gerado em ${new Date().toISOString()}`,
  ].forEach((t) => info.addRow([t]));
  formatar(info, [100]);
  info.autoFilter = undefined;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
