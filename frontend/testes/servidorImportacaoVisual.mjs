// Cenário visual isolado para validar a prévia da importação de cadastros.
// Usa somente dados sintéticos e não acessa banco, planilhas ou APIs reais.
import express from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const app = express();
const dist = resolve("frontend/dist");
const indice = readFileSync(resolve(dist, "index.html"), "utf8");
const css = indice.match(/href="([^"]+\.css)"/)?.[1];
if (!css)
  throw new Error("CSS compilado não encontrado. Execute npm run build.");

const campos = [
  ["Nome / razão social", "NGR Engenharia Suster"],
  ["CPF/CNPJ", ""],
  ["Unidade consumidora", "3.116.510.012-16"],
  ["E-mail de cobrança", ""],
  ["Dia preferido de vencimento", ""],
  ["Modalidade GDI/GDII", ""],
  ["Desconto (%)", "25"],
  ["Vigência inicial (competência)", ""],
];

app.get("/teste-importacao", (_req, res) =>
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="${css}"><title>Prévia de importação</title></head>
  <body><main class="admin-aplicacao" style="display:block;padding:24px">
    <section class="admin-formulario"><h2>Prévia da importação</h2>
      <div class="admin-tabela importacao-previa"><table><thead><tr>
        <th>Linha</th><th>Cliente / UC</th><th>Desconto</th><th>Situação</th>
        <th>Detalhe</th><th>Completar no sistema</th></tr></thead><tbody><tr>
        <td>2</td><td>NGR Engenharia Suster<small>311651001216</small></td>
        <td>25%</td><td>Com pendência</td><td>E-mail inválido.</td>
        <td class="importacao-previa-completar"><details class="importacao-previa-editor" open>
          <summary>Conferir dados da linha 2</summary><div class="importacao-previa-campos">
            ${campos.map(([rotulo, valor]) => `<label><span>${rotulo}</span><input value="${valor}"></label>`).join("")}
          </div></details></td></tr></tbody></table></div>
    </section></main></body></html>`),
);
app.use(express.static(dist));
app.listen(4318, "127.0.0.1", () =>
  console.log("Teste visual isolado: http://127.0.0.1:4318/teste-importacao"),
);
