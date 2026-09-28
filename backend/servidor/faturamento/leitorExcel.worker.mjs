import { parentPort, workerData } from "node:worker_threads";
import ExcelJS from "exceljs";

// Arquivos externos são lidos fora do servidor HTTP, com memória e tempo limitados.
try {
  const workbook = new ExcelJS.Workbook();
  // A consulta precisa de valores e formatos numéricos, não de objetos visuais.
  // Referências antigas de tabelas podem estar quebradas; mesclagens enormes
  // também tornavam a leitura lenta. Ignorar esses nós não modifica o arquivo.
  await workbook.xlsx.load(Buffer.from(workerData), {
    ignoreNodes: [
      "dataValidations",
      "conditionalFormatting",
      "drawing",
      "extLst",
      "tableParts",
      "mergeCells",
    ],
  });
  if (workbook.worksheets.length > 20)
    throw new Error("Use um arquivo com até 20 abas.");
  let total = 0;
  const abas = workbook.worksheets.map((sheet) => {
    // columnCount percorre as linhas internamente; calcule uma vez por aba.
    const rowCount = sheet.rowCount,
      columnCount = sheet.columnCount;
    if (rowCount > 2001 || columnCount > 60)
      throw new Error(
        "Cada aba pode ter até 2.001 linhas e 60 colunas. Exporte somente os cadastros necessários.",
      );
    const linhas = [];
    for (let r = 1; r <= rowCount; r++) {
      const linha = [];
      for (let c = 1; c <= columnCount; c++) {
        const cell = sheet.getCell(r, c),
          v = cell.value;
        if (++total > 500000)
          throw new Error("A planilha excede o limite de células desta etapa.");
        let valor = "",
          tipo = "texto";
        if (v instanceof Date) {
          valor = v.toISOString().slice(0, 10);
          tipo = "data";
        } else if (typeof v === "number") {
          valor = String(v);
          tipo = cell.numFmt?.replace(/"[^"]*"|\\./g, "").includes("%")
            ? "percentual"
            : "numero";
        } else if (typeof v === "string") valor = v;
        else if (v && typeof v === "object") {
          if ("formula" in v || "sharedFormula" in v) {
            tipo = "formula";
            valor = "Fórmula — conferir no sistema";
          } else if ("richText" in v)
            valor = v.richText.map((t) => t.text).join("");
          else if ("text" in v) valor = String(v.text);
          else if ("error" in v) {
            tipo = "erro";
            valor = String(v.error);
          }
        } else if (v !== null && v !== undefined) valor = String(v);
        if (valor.length > 500)
          throw new Error(
            "Há uma célula com mais de 500 caracteres. Use uma aba de cadastros resumida.",
          );
        linha.push({ valor, tipo });
      }
      linhas.push(linha);
    }
    return { nome: sheet.name, linhas };
  });
  parentPort.postMessage({ abas });
} catch (erro) {
  parentPort.postMessage({ erro: erro.message });
}
