import ExcelJS from "exceljs";
import { obterBanco } from "./bancoDeDados.mjs";

const seguro = (valor) => {
  const texto = String(valor ?? "");
  return /^\s*[=+\-@]/.test(texto) ? `'${texto}` : texto;
};

function aba(workbook, nome, cabecalhos) {
  const sheet = workbook.addWorksheet(nome);
  sheet.columns = cabecalhos.map((titulo) => ({ header: titulo, width: 24 }));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: "A1",
    to: sheet.getRow(1).getCell(cabecalhos.length).address,
  };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF153F4B" },
  };
  return sheet;
}

export async function gerarPlanilhaUsinas(banco = obterBanco()) {
  banco.exec("BEGIN");
  let usinas, modalidades, identificadores, unidades;
  try {
    usinas = banco
      .prepare(
        "SELECT id,nome,localizacao,potencia_kw,status FROM usinas ORDER BY nome,id",
      )
      .all();
    modalidades = banco
      .prepare(
        "SELECT usina_id,inicio,modalidade FROM usinas_modalidades ORDER BY usina_id,inicio",
      )
      .all();
    identificadores = banco
      .prepare(
        "SELECT usina_id,numero,tipo,origem FROM usinas_identificadores_geracao ORDER BY usina_id,tipo,numero",
      )
      .all();
    unidades = banco
      .prepare(
        `SELECT u.uc,u.uc_antiga,u.nome,u.usina_id,
      COALESCE(c.name,o.nome,p.nome) AS cliente
      FROM faturamento_unidades u
      LEFT JOIN customers c ON c.id=u.cliente_id
      LEFT JOIN faturamento_clientes_operacionais o ON o.id=u.cliente_operacional_id
      LEFT JOIN faturamento_clientes_provisorios p ON p.id=u.cliente_provisorio_id
      ORDER BY u.usina_id,u.uc`,
      )
      .all();
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ecosol";
  const lista = aba(workbook, "Usinas", [
    "ID",
    "Usina",
    "Localização",
    "Potência (kW)",
    "Status",
    "UCs vinculadas",
  ]);
  const vinculos = aba(workbook, "UCs por usina", [
    "Usina",
    "UC atual",
    "UC antiga",
    "Cliente",
    "Nome na UC",
  ]);
  const historico = aba(workbook, "Modalidades e IDs", [
    "Usina",
    "Tipo",
    "Início ou número",
    "Valor ou origem",
  ]);
  const nomes = new Map(usinas.map((usina) => [usina.id, usina.nome]));
  const contagem = new Map();
  for (const unidade of unidades) {
    contagem.set(unidade.usina_id, (contagem.get(unidade.usina_id) ?? 0) + 1);
    vinculos.addRow([
      seguro(nomes.get(unidade.usina_id) ?? "Sem usina"),
      seguro(unidade.uc),
      seguro(unidade.uc_antiga),
      seguro(unidade.cliente),
      seguro(unidade.nome),
    ]);
  }
  for (const usina of usinas)
    lista.addRow([
      usina.id,
      seguro(usina.nome),
      seguro(usina.localizacao),
      usina.potencia_kw,
      seguro(usina.status),
      contagem.get(usina.id) ?? 0,
    ]);
  for (const item of modalidades)
    historico.addRow([
      seguro(nomes.get(item.usina_id)),
      "Modalidade",
      seguro(item.inicio),
      seguro(item.modalidade),
    ]);
  for (const item of identificadores)
    historico.addRow([
      seguro(nomes.get(item.usina_id)),
      seguro(`Identificador ${item.tipo}`),
      seguro(item.numero),
      seguro(item.origem),
    ]);
  vinculos.getColumn(2).numFmt = "@";
  vinculos.getColumn(3).numFmt = "@";
  historico.getColumn(3).numFmt = "@";
  return {
    buffer: await workbook.xlsx.writeBuffer(),
    total: usinas.length,
    unidades: unidades.length,
  };
}

export async function exportarUsinas(req, res) {
  const banco = obterBanco();
  const { buffer, total, unidades } = await gerarPlanilhaUsinas(banco);
  banco
    .prepare(
      "INSERT INTO auditoria_exportacoes_usinas(responsavel_id,total_usinas,total_unidades) VALUES(?,?,?)",
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
    "Content-Disposition": `attachment; filename="usinas-ecosol-${data}.xlsx"`,
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(Buffer.from(buffer));
}
