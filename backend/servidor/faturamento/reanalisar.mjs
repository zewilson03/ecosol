import { createHash } from "node:crypto";
import { lerPdf } from "./extracao.mjs";
import { falhar } from "./regras.mjs";

function elegivel(documento) {
  return (
    documento &&
    documento.classificacao === "fatura" &&
    documento.excluido_em === null &&
    documento.status === "Pendente de revisão" &&
    documento.memoria === null &&
    documento.unidade_id === null &&
    documento.competencia === null
  );
}

export async function reanalisarFatura({
  banco,
  documentoId,
  versao,
  responsavel,
  administradorId = null,
}) {
  if (!Number.isSafeInteger(documentoId) || documentoId < 1)
    falhar("Fatura inválida.");
  if (!Number.isSafeInteger(versao) || versao < 1)
    falhar("Versão da fatura inválida.");
  const anterior = banco
    .prepare("SELECT * FROM faturamento_documentos WHERE id=?")
    .get(documentoId);
  if (!anterior || anterior.classificacao !== "fatura" || anterior.excluido_em)
    falhar("Fatura não encontrada.", 404);
  if (!elegivel(anterior))
    falhar(
      "Somente faturas pendentes e sem cálculo podem ser reanalisadas.",
      409,
    );
  if (anterior.versao !== versao)
    falhar("Fatura alterada. Atualize a lista antes de reanalisar.", 409);
  if (!anterior.pdf?.length)
    falhar("PDF original indisponível para reanálise.", 409);
  const hash = createHash("sha256").update(anterior.pdf).digest("hex");
  if (hash !== anterior.hash)
    falhar("Integridade do PDF divergente; reanálise interrompida.", 409);

  // A leitura do PDF pode levar segundos. Não manter o banco bloqueado aqui.
  const novaExtracao = await lerPdf(Buffer.from(anterior.pdf));
  banco.exec("BEGIN IMMEDIATE");
  try {
    const atual = banco
      .prepare(
        `SELECT id,versao,status,classificacao,excluido_em,memoria,
                unidade_id,competencia,hash,texto,extracao,dados
         FROM faturamento_documentos WHERE id=?`,
      )
      .get(documentoId);
    if (!elegivel(atual) || atual.versao !== versao || atual.hash !== hash)
      falhar("Fatura alterada. Atualize a lista antes de reanalisar.", 409);

    const edicaoHumana = Boolean(
      banco
        .prepare(
          `SELECT 1 FROM faturamento_historico
           WHERE documento_id=? AND acao='Conferência salva' LIMIT 1`,
        )
        .get(documentoId),
    );
    const dados = JSON.parse(atual.dados);
    const extracaoAnterior = JSON.parse(atual.extracao);
    const preenchidos = {};
    const corrigidos = {};
    if (!edicaoHumana) {
      for (const [campo, valor] of Object.entries(novaExtracao.dados)) {
        if (
          dados[campo] === undefined ||
          dados[campo] === null ||
          dados[campo] === ""
        ) {
          dados[campo] = valor;
          preenchidos[campo] = valor;
        } else if (
          campo === "unitario" &&
          dados[campo] === extracaoAnterior.dados?.unitario &&
          dados[campo] !== valor
        ) {
          // Corrigir somente a sugestão automática comprovadamente antiga.
          // Qualquer valor que divirja da extração anterior fica intocado.
          dados[campo] = valor;
          corrigidos[campo] = {
            anterior: extracaoAnterior.dados.unitario,
            novo: valor,
          };
        }
      }
    }
    const extracao = JSON.stringify(novaExtracao);
    const novosDados = JSON.stringify(dados);
    const alterado =
      atual.texto !== novaExtracao.texto ||
      atual.extracao !== extracao ||
      atual.dados !== novosDados;
    if (alterado) {
      const gravacao = banco
        .prepare(
          `UPDATE faturamento_documentos
           SET texto=?,extracao=?,dados=?,versao=versao+1,
               atualizado_em=CURRENT_TIMESTAMP
           WHERE id=? AND versao=? AND classificacao='fatura'
             AND excluido_em IS NULL AND status='Pendente de revisão'
             AND memoria IS NULL AND unidade_id IS NULL AND competencia IS NULL`,
        )
        .run(novaExtracao.texto, extracao, novosDados, documentoId, versao);
      if (gravacao.changes !== 1)
        falhar("Fatura alterada. Atualize a lista antes de reanalisar.", 409);
      banco
        .prepare(
          `INSERT INTO faturamento_historico
           (documento_id,responsavel,administrador_id,acao,dados)
           VALUES (?,?,?,?,?)`,
        )
        .run(
          documentoId,
          responsavel,
          administradorId,
          "Reanálise de PDF",
          JSON.stringify({
            preenchidos,
            corrigidos,
            dadosManuaisPreservados: edicaoHumana,
            camposReconhecidos: novaExtracao.qualidade.campos_identificados,
          }),
        );
    }
    banco.exec("COMMIT");
    return {
      id: documentoId,
      atualizado: alterado,
      versao: versao + Number(alterado),
      preenchidos: Object.keys(preenchidos),
      corrigidos: Object.keys(corrigidos),
      dadosManuaisPreservados: edicaoHumana,
      qualidade: novaExtracao.qualidade,
    };
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}
