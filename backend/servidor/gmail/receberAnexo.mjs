import { createHash } from "node:crypto";
import { obterBanco } from "../bancoDeDados.mjs";
import { lerPdf } from "../faturamento/extracao.mjs";

const LIMITE_PDF = 10 * 1024 * 1024;

export class PdfGmailInvalido extends Error {
  constructor(codigo) {
    super("Anexo PDF precisa de conferência manual.");
    this.codigo = codigo;
  }
}

// A chamada remota e a leitura do PDF ficam fora da transação. Dentro dela,
// documento, origem, recebimento e conclusão da fila são indivisíveis.
export async function receberAnexoGmail({
  anexo,
  arquivo,
  banco = obterBanco(),
  ler = lerPdf,
  agora = Date.now(),
}) {
  if (
    !Buffer.isBuffer(arquivo) ||
    arquivo.length < 8 ||
    arquivo.length > LIMITE_PDF ||
    arquivo.subarray(0, 5).toString() !== "%PDF-"
  )
    throw new PdfGmailInvalido("pdf_invalido");
  const hash = createHash("sha256").update(arquivo).digest("hex");
  let extracao;
  try {
    extracao = await ler(arquivo);
  } catch {
    throw new PdfGmailInvalido("pdf_ilegivel");
  }
  banco.exec("BEGIN IMMEDIATE");
  try {
    const atual = banco
      .prepare(
        `SELECT a.*, c.status_autorizacao, c.pausada
         FROM gmail_anexos a JOIN gmail_contas c ON c.id=a.conta_id
         WHERE a.id=?`,
      )
      .get(anexo.id);
    if (
      !atual ||
      atual.estado !== "em_processamento" ||
      atual.lease_token !== anexo.lease_token ||
      atual.lease_ate <= agora ||
      atual.status_autorizacao !== "conectada" ||
      atual.pausada
    ) {
      banco.exec("ROLLBACK");
      return { confirmado: false };
    }
    let documento = banco
      .prepare(
        "SELECT id,classificacao FROM faturamento_documentos WHERE hash=?",
      )
      .get(hash);
    const duplicado = Boolean(documento);
    const lote = `gmail-${atual.conta_id}`;
    if (!documento) {
      const id = Number(
        banco
          .prepare(
            `INSERT INTO faturamento_documentos
             (hash,nome,pdf,lote,texto,extracao,dados,classificacao)
             VALUES (?,?,?,?,?,?,?,'triagem')`,
          )
          .run(
            hash,
            atual.nome,
            arquivo,
            lote,
            extracao.texto,
            JSON.stringify(extracao),
            JSON.stringify({ ...extracao.dados, origem_tarifa: "propria" }),
          ).lastInsertRowid,
      );
      documento = { id, classificacao: "triagem" };
      banco
        .prepare(
          `INSERT INTO faturamento_historico
           (documento_id,responsavel,administrador_id,acao,dados)
           VALUES (?,'Integração Gmail',NULL,'Importação de PDF',?)`,
        )
        .run(
          id,
          JSON.stringify({
            nome: atual.nome,
            lote,
            hash,
            origem: "gmail",
            contaId: atual.conta_id,
            messageId: atual.message_id,
            partPath: atual.part_path,
          }),
        );
    }
    const manual = extracao.qualidade?.modo === "manual";
    banco
      .prepare(
        `INSERT INTO faturamento_recebimentos_pdf
         (hash,nome,lote,resultado,codigo,motivo,documento_id,
          responsavel,origem,gmail_anexo_id)
         VALUES (?,?,?,?,?,?,?,'Integração Gmail','gmail',?)`,
      )
      .run(
        hash,
        atual.nome,
        lote,
        duplicado ? "Duplicada" : manual ? "Requer atenção" : "Recebida",
        duplicado ? "duplicada" : manual ? "ilegivel" : "ok",
        duplicado
          ? `PDF já recebido como #${documento.id}. Nenhuma cópia foi criada.`
          : manual
            ? "O PDF parece ser uma imagem. Confira os campos manualmente."
            : "PDF recebido e lido. Confira os dados antes de calcular.",
        documento.id,
        atual.id,
      );
    banco
      .prepare(
        `UPDATE gmail_anexos SET estado=?, documento_id=?, hash_pdf=?,
         lease_token=NULL, lease_ate=NULL, proxima_tentativa_em=NULL,
         erro_codigo=NULL, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
      )
      .run(duplicado ? "duplicado" : "capturado", documento.id, hash, atual.id);
    banco.exec("COMMIT");
    return { confirmado: true, duplicado, documentoId: documento.id, hash };
  } catch (erro) {
    try {
      banco.exec("ROLLBACK");
    } catch {
      // Preserva a causa original se o commit já tiver encerrado a transação.
    }
    throw erro;
  }
}
