import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { obterBanco } from "../servidor/bancoDeDados.mjs";
import { prepararFaturamento } from "../servidor/faturamento/esquema.mjs";
import { identificarFinalidadeDocumento } from "../servidor/faturamento/finalidadeDocumento.mjs";

const confirmar = process.argv.includes("--confirmar");
const banco = obterBanco();
if (confirmar) prepararFaturamento(banco);
const temFinalidade = banco
  .prepare("PRAGMA table_info(faturamento_documentos)")
  .all()
  .some((coluna) => coluna.name === "finalidade");
const documentos = banco
  .prepare(
    `SELECT id,nome,texto,extracao,status,memoria,unidade_id,competencia,
            ${temFinalidade ? "finalidade" : "'cobranca' AS finalidade"},versao
     FROM faturamento_documentos
     WHERE classificacao='fatura' AND excluido_em IS NULL ORDER BY id`,
  )
  .all();
const candidatos = documentos
  .map((documento) => ({
    documento,
    resultado: identificarFinalidadeDocumento(documento.texto),
  }))
  .filter((item) => item.resultado.finalidade === "pagamento");
const protegidos = candidatos.filter(
  ({ documento }) =>
    documento.memoria !== null ||
    documento.status !== "Pendente de revisão" ||
    documento.unidade_id !== null ||
    documento.competencia !== null,
);
const elegiveis = candidatos.filter((item) => !protegidos.includes(item));
const resumo = {
  modo: confirmar ? "confirmado" : "previa",
  documentos: documentos.length,
  pagamentos_identificados: candidatos.length,
  elegiveis: elegiveis.length,
  protegidos: protegidos.map(({ documento, resultado }) => ({
    id: documento.id,
    nome: documento.nome,
    status: documento.status,
    motivo: resultado.motivo,
  })),
  itens: candidatos.map(({ documento, resultado }) => ({
    id: documento.id,
    nome: documento.nome,
    motivo: resultado.motivo,
    quantidade_itens: resultado.evidencias.quantidade_itens,
  })),
};

if (confirmar) {
  const pasta = resolve("backend/data/backups");
  mkdirSync(pasta, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[-:.]/g, "");
  const backup = resolve(
    pasta,
    `ecosol-antes-classificar-pagamentos-${carimbo}.db`,
  );
  banco.prepare("VACUUM INTO ?").run(backup);
  resumo.backup = backup;
  banco.exec("BEGIN IMMEDIATE");
  try {
    const atualizar = banco.prepare(
      `UPDATE faturamento_documentos
       SET finalidade='pagamento',extracao=?,versao=versao+1,
           atualizado_em=CURRENT_TIMESTAMP
       WHERE id=? AND versao=? AND finalidade='cobranca'
         AND status='Pendente de revisão' AND memoria IS NULL
         AND unidade_id IS NULL AND competencia IS NULL`,
    );
    const historico = banco.prepare(
      `INSERT INTO faturamento_historico
       (documento_id,responsavel,acao,dados) VALUES(?,?,?,?)`,
    );
    let alterados = 0;
    for (const { documento, resultado } of elegiveis) {
      const extracao = JSON.parse(documento.extracao);
      extracao.finalidade = resultado;
      const gravacao = atualizar.run(
        JSON.stringify(extracao),
        documento.id,
        documento.versao,
      );
      if (gravacao.changes === 1) {
        alterados++;
        historico.run(
          documento.id,
          "Classificação automática de pagamentos",
          "Documento separado para Pagamentos",
          JSON.stringify(resultado),
        );
      }
    }
    banco.exec("COMMIT");
    resumo.alterados = alterados;
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}
console.log(JSON.stringify(resumo, null, 2));
