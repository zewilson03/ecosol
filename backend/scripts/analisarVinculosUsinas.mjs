import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { lerExcel } from "../servidor/faturamento/planilhas.mjs";
import {
  chaveUsina,
  extrairVinculosDaAba,
} from "../servidor/faturamento/vinculosUsinas.mjs";
import { prepararPrevia } from "../servidor/faturamento/rotasVinculosUsinas.mjs";

const [arquivo, bancoArquivo] = process.argv.slice(2);
if (!arquivo || !bancoArquivo)
  throw new Error("Informe o caminho da planilha e do banco para análise.");

const abas = await lerExcel(readFileSync(arquivo));
const extraida = extrairVinculosDaAba(abas, "Consulta", "uc por usina.xlsx");
const banco = new DatabaseSync(bancoArquivo, { readOnly: true });
const usinas = banco.prepare("SELECT id,nome FROM usinas").all();
const unidades = banco
  .prepare(
    "SELECT u.id,u.uc,u.uc_antiga,u.usina_id,COALESCE(c.name,p.nome,u.nome) AS nome FROM faturamento_unidades u LEFT JOIN customers c ON c.id=u.cliente_id LEFT JOIN faturamento_clientes_provisorios p ON p.id=u.cliente_provisorio_id",
  )
  .all();
const porUc = new Map(unidades.map((u) => [u.uc, u]));
const usinaPorId = new Map(usinas.map((u) => [u.id, u.nome]));
const escolhas = {};
for (const usina of usinas)
  if (chaveUsina(usina.nome) !== "ecosol")
    escolhas[chaveUsina(usina.nome)] = usina.id;
const previa = prepararPrevia(
  { linhas: JSON.stringify(extraida.linhas) },
  escolhas,
  banco,
);
const resumo = new Map();
for (const l of extraida.linhas) {
  const chave = chaveUsina(l.usina);
  const r = resumo.get(chave) ?? {
    usina: l.usina,
    total: 0,
    aptas: 0,
    semAtual: 0,
    erro: 0,
    semAntiga: 0,
    existentes: 0,
    vinculadasEcosol: 0,
    conflitoOutraUsina: 0,
  };
  r.total++;
  if (!l.uc) r.semAtual++;
  if (l.erro) r.erro++;
  if (!l.uc_antiga) r.semAntiga++;
  const u = porUc.get(l.uc);
  if (u) {
    r.existentes++;
    if (chaveUsina(usinaPorId.get(u.usina_id)) === "ecosol")
      r.vinculadasEcosol++;
    else if (u.usina_id && chaveUsina(usinaPorId.get(u.usina_id)) !== chave)
      r.conflitoOutraUsina++;
  }
  if (l.uc && !l.erro) r.aptas++;
  resumo.set(chave, r);
}
console.log(
  JSON.stringify(
    {
      linhas: extraida.linhas.length,
      usinasCadastradas: usinas,
      porUsina: [...resumo.values()].sort((a, b) => b.total - a.total),
      ucsEcosol: unidades.filter(
        (u) => chaveUsina(usinaPorId.get(u.usina_id)) === "ecosol",
      ).length,
      previaUsinasConfirmadas: previa.resumo,
    },
    null,
    2,
  ),
);
banco.close();
