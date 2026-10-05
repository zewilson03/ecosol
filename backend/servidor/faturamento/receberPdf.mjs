import { createHash } from "node:crypto";
import { obterBanco } from "../bancoDeDados.mjs";
import { lerPdf } from "./extracao.mjs";
import { registrarHistorico, registrarRecebimentoPdf } from "./registros.mjs";
import { falhar, texto } from "./regras.mjs";

const LIMITE_PDF = 10 * 1024 * 1024;

function transacao(fn) {
  const banco = obterBanco();
  banco.exec("BEGIN IMMEDIATE");
  try {
    const resultado = fn();
    banco.exec("COMMIT");
    return resultado;
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

// Usada pela rota manual e, futuramente, pelo coletor Gmail no servidor.
// A origem informa o canal; a identificação de mensagem/anexo virá na fila durável.
export async function receberPdf({ arquivo, nome, lote, ator, origem }) {
  lote = texto(lote, "o lote", 80);
  nome = texto(nome, "o nome do arquivo", 200);
  if (origem !== "manual" && origem !== "gmail")
    falhar("Origem do PDF inválida.");
  const responsavel = texto(ator?.nome, "o responsável", 160);
  const administradorId = ator?.id ?? null;
  if (
    administradorId !== null &&
    (!Number.isSafeInteger(administradorId) || administradorId < 1)
  )
    falhar("Responsável pela importação inválido.");

  const registrar = (dados) =>
    registrarRecebimentoPdf({ nome, lote, responsavel, origem, ...dados });

  if (
    !Buffer.isBuffer(arquivo) ||
    arquivo.length < 8 ||
    arquivo.length > LIMITE_PDF ||
    arquivo.subarray(0, 5).toString() !== "%PDF-"
  ) {
    registrar({
      resultado: "Erro",
      codigo: "invalida",
      motivo: "O arquivo não é um PDF válido ou está incompleto.",
    });
    falhar("Envie um arquivo PDF válido, com até 10 MB.");
  }

  const hash = createHash("sha256").update(arquivo).digest("hex");
  const banco = obterBanco();
  const registrarDuplicata = (documentoId) => {
    registrar({
      hash,
      resultado: origem === "gmail" ? "Duplicada" : "Erro",
      codigo: "duplicada",
      motivo: `Esta mesma fatura já foi recebida como #${documentoId}. Nenhuma cópia foi criada.`,
      documentoId,
    });
    return { tipo: "duplicado", documentoId };
  };
  const duplicada = banco
    .prepare("SELECT id FROM faturamento_documentos WHERE hash=?")
    .get(hash);
  if (duplicada) return registrarDuplicata(duplicada.id);

  let extracao;
  try {
    extracao = await lerPdf(arquivo);
  } catch {
    registrar({
      hash,
      resultado: "Erro",
      codigo: "ilegivel",
      motivo:
        "Não foi possível abrir o PDF. Ele pode estar com senha, danificado ou ter mais de 10 páginas.",
    });
    falhar(
      "Não foi possível ler o PDF. Verifique se está íntegro, sem senha e com até 10 páginas.",
    );
  }

  return transacao(() => {
    // A leitura é assíncrona: outra entrada pode ter salvo o PDF nesse intervalo.
    const existente = banco
      .prepare("SELECT id FROM faturamento_documentos WHERE hash=?")
      .get(hash);
    if (existente) return registrarDuplicata(existente.id);

    const documentoId = Number(
      banco
        .prepare(
          "INSERT INTO faturamento_documentos (hash,nome,pdf,lote,texto,extracao,dados) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          hash,
          nome,
          arquivo,
          lote,
          extracao.texto,
          JSON.stringify(extracao),
          JSON.stringify({ ...extracao.dados, origem_tarifa: "propria" }),
        ).lastInsertRowid,
    );
    registrarHistorico({
      responsavel,
      administradorId,
      acao: "Importação de PDF",
      dados: { nome, lote, hash, origem },
      documentoId,
    });
    const manual = extracao.qualidade?.modo === "manual";
    registrar({
      hash,
      resultado: manual ? "Requer atenção" : "Recebida",
      codigo: manual ? "ilegivel" : "ok",
      motivo: manual
        ? "O PDF parece ser uma imagem. Preencha e confira os campos manualmente."
        : "PDF recebido e lido. Confira os dados antes de calcular.",
      documentoId,
    });
    return { tipo: "novo", documentoId };
  });
}
