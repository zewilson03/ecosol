import ExcelJS from "exceljs";
import { obterBanco } from "./bancoDeDados.mjs";

function textoSeguro(valor) {
  if (valor === null || valor === undefined) return "";
  const texto = String(valor);
  return /^\s*[=+\-@]/.test(texto) ? `'${texto}` : texto;
}

function configurarAba(aba, cabecalhos, larguras) {
  aba.columns = cabecalhos.map((cabecalho, indice) => ({
    header: cabecalho,
    key: `c${indice}`,
    width: larguras[indice],
  }));
  aba.views = [{ state: "frozen", ySplit: 1 }];
  aba.autoFilter = {
    from: "A1",
    to: aba.getRow(1).getCell(cabecalhos.length).address,
  };
  aba.getRow(1).height = 24;
  aba.getRow(1).eachCell((celula) => {
    celula.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF153F4B" },
    };
    celula.font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    celula.alignment = { vertical: "middle", horizontal: "center" };
  });
}

function adicionarLinha(aba, valores) {
  const linha = aba.addRow(
    valores.map((valor) =>
      typeof valor === "number" ? valor : textoSeguro(valor),
    ),
  );
  linha.font = { name: "Arial", size: 10, color: { argb: "FF183743" } };
}

export async function gerarPlanilhaClientes(banco = obterBanco()) {
  banco.exec("BEGIN");
  let portal, operacionais, provisorios, unidades, aliases;
  try {
    portal = banco
      .prepare(
        "SELECT id,name,cpf,email,phone,password_hash,created_at FROM customers ORDER BY id",
      )
      .all();
    operacionais = banco
      .prepare(
        "SELECT id,nome,referencia_interna,origem_provisorio_id,situacao,criado_em FROM faturamento_clientes_operacionais ORDER BY id",
      )
      .all();
    provisorios = banco
      .prepare(
        "SELECT id,nome,chave_origem,origem,criado_em FROM faturamento_clientes_provisorios ORDER BY id",
      )
      .all();
    unidades = banco
      .prepare(
        `SELECT u.id,u.uc,u.uc_antiga,u.nome,u.documento,u.email,
      u.dia_vencimento,u.cliente_id,u.cliente_operacional_id,u.cliente_provisorio_id,
      u.pendencia_cadastro,s.nome AS usina
      FROM faturamento_unidades u LEFT JOIN usinas s ON s.id=u.usina_id
      ORDER BY u.uc,u.id`,
      )
      .all();
    aliases = banco
      .prepare(
        "SELECT unidade_id,uc FROM faturamento_unidades_aliases ORDER BY unidade_id,uc",
      )
      .all();
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }

  const chave = (tipo, id) => `${tipo}:${id}`;
  const unidadesPorCliente = new Map();
  for (const unidade of unidades) {
    const tipo =
      unidade.cliente_id != null
        ? "Portal"
        : unidade.cliente_operacional_id != null
          ? "Operacional"
          : unidade.cliente_provisorio_id != null
            ? "Provisório"
            : "Sem vínculo";
    const id =
      unidade.cliente_id ??
      unidade.cliente_operacional_id ??
      unidade.cliente_provisorio_id ??
      unidade.id;
    const identificador = chave(tipo, id);
    unidadesPorCliente.set(
      identificador,
      (unidadesPorCliente.get(identificador) ?? 0) + 1,
    );
  }
  const origens = new Map(
    operacionais.map((item) => [item.origem_provisorio_id, item.id]),
  );
  const aliasesPorUnidade = new Map();
  for (const alias of aliases)
    aliasesPorUnidade.set(alias.unidade_id, [
      ...(aliasesPorUnidade.get(alias.unidade_id) ?? []),
      alias.uc,
    ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ecosol";
  workbook.created = new Date();
  const resumo = workbook.addWorksheet("Resumo", {
    properties: { tabColor: { argb: "FF153F4B" } },
    views: [{ showGridLines: false }],
  });
  const clientes = workbook.addWorksheet("Todos os clientes", {
    properties: { tabColor: { argb: "FF236B78" } },
    views: [{ showGridLines: false }],
  });
  const ucs = workbook.addWorksheet("UCs vinculadas", {
    views: [{ showGridLines: false }],
  });
  const semVinculo = unidades.filter(
    (unidade) =>
      unidade.cliente_id == null &&
      unidade.cliente_operacional_id == null &&
      unidade.cliente_provisorio_id == null,
  );
  const total =
    portal.length +
    operacionais.length +
    provisorios.length +
    semVinculo.length;
  resumo.getCell("A2").value = "Cadastro de clientes • Ecosol";
  resumo.getCell("A2").font = {
    name: "Arial",
    size: 15,
    bold: true,
    color: { argb: "FF153F4B" },
  };
  resumo.getColumn("A").width = 47;
  resumo.getColumn("B").width = 28;
  const hoje = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  [
    ["Data de referência", hoje],
    ["Registros de clientes", total],
    ["Clientes do portal", portal.length],
    ["Cadastros operacionais", operacionais.length],
    ["Cadastros provisórios", provisorios.length],
    ["UCs sem cliente vinculado", semVinculo.length],
    ["UCs no sistema", unidades.length],
    ["Provisórios convertidos em operacionais", origens.size],
  ].forEach(([titulo, valor], indice) => {
    resumo.getCell(4 + indice, 1).value = titulo;
    resumo.getCell(4 + indice, 2).value = valor;
    resumo.getCell(4 + indice, 1).font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: "FF153F4B" },
    };
  });
  resumo.getCell("A13").value =
    "Escopo: todos os registros existentes, inclusive os pendentes e sem UC.";
  resumo.getCell("A14").value =
    "Uma pessoa pode constar em mais de um tipo de cadastro; esta exportação não deduplica nomes.";
  resumo.getCell("A15").value =
    "Dados sensíveis: uso interno. Senhas, tokens e códigos não foram exportados.";

  configurarAba(
    clientes,
    [
      "Tipo de cadastro",
      "ID",
      "Nome / razão social",
      "CPF/CNPJ",
      "E-mail",
      "Telefone",
      "Situação",
      "UCs vinculadas",
      "Cadastrado em",
      "Origem / referência",
      "ID ou chave de origem",
      "Observação",
    ],
    [18, 10, 36, 24, 28, 20, 30, 18, 18, 28, 28, 38],
  );
  for (const item of portal)
    adicionarLinha(clientes, [
      "Portal",
      item.id,
      item.name,
      item.cpf,
      item.email,
      item.phone,
      item.password_hash ? "Senha cadastrada" : "Acesso pendente",
      unidadesPorCliente.get(chave("Portal", item.id)) ?? 0,
      item.created_at,
      "",
      "",
      "",
    ]);
  for (const item of operacionais)
    adicionarLinha(clientes, [
      "Operacional",
      item.id,
      item.nome,
      "",
      "",
      "",
      item.situacao,
      unidadesPorCliente.get(chave("Operacional", item.id)) ?? 0,
      item.criado_em,
      item.referencia_interna,
      item.origem_provisorio_id,
      "Sem acesso ao portal",
    ]);
  for (const item of provisorios)
    adicionarLinha(clientes, [
      "Provisório",
      item.id,
      item.nome,
      "",
      "",
      "",
      origens.has(item.id) ? "Convertido em operacional" : "Provisório",
      unidadesPorCliente.get(chave("Provisório", item.id)) ?? 0,
      item.criado_em,
      item.origem,
      item.chave_origem,
      origens.has(item.id)
        ? `Origem do operacional ${origens.get(item.id)}`
        : "Sem acesso ao portal",
    ]);
  for (const item of semVinculo)
    adicionarLinha(clientes, [
      "Sem vínculo",
      item.id,
      item.nome,
      item.documento,
      item.email,
      "",
      "UC sem cadastro de cliente vinculado",
      1,
      "",
      "UC",
      item.uc,
      "Requer conferência",
    ]);

  configurarAba(
    ucs,
    [
      "ID da UC",
      "UC atual",
      "UC antiga / histórica",
      "Tipo de cadastro",
      "ID cliente",
      "Nome na UC",
      "Documento na UC",
      "E-mail na UC",
      "Dia vencimento",
      "Usina",
      "Pendência cadastral",
    ],
    [11, 26, 28, 18, 18, 36, 24, 28, 16, 24, 32],
  );
  for (const item of unidades) {
    const tipo =
      item.cliente_id != null
        ? "Portal"
        : item.cliente_operacional_id != null
          ? "Operacional"
          : item.cliente_provisorio_id != null
            ? "Provisório"
            : "Sem vínculo";
    const id =
      item.cliente_id ??
      item.cliente_operacional_id ??
      item.cliente_provisorio_id ??
      item.id;
    const antigas = [
      ...new Set(
        [item.uc_antiga, ...(aliasesPorUnidade.get(item.id) ?? [])].filter(
          Boolean,
        ),
      ),
    ].join("; ");
    adicionarLinha(ucs, [
      item.id,
      item.uc,
      antigas,
      tipo,
      id,
      item.nome,
      item.documento,
      item.email,
      item.dia_vencimento || "",
      item.usina,
      item.pendencia_cadastro,
    ]);
  }
  for (const linha of clientes.getRows(2, total) ?? [])
    linha.getCell(4).numFmt = "@";
  for (const linha of ucs.getRows(2, unidades.length) ?? []) {
    linha.getCell(2).numFmt = "@";
    linha.getCell(3).numFmt = "@";
  }
  return {
    buffer: await workbook.xlsx.writeBuffer(),
    total,
    unidades: unidades.length,
  };
}

export async function exportarClientes(req, res) {
  const banco = obterBanco();
  const { buffer, total, unidades } = await gerarPlanilhaClientes(banco);
  banco
    .prepare(
      "INSERT INTO auditoria_exportacoes_clientes(responsavel_id,total_clientes,total_unidades) VALUES(?,?,?)",
    )
    .run(req.administrador.id, total, unidades);
  const data = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  res.set({
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="clientes-ecosol-${data}.xlsx"`,
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(Buffer.from(buffer));
}
