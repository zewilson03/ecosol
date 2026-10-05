import { obterBanco } from "../bancoDeDados.mjs";

export function registrarHistorico({
  responsavel,
  administradorId = null,
  acao,
  dados,
  documentoId = null,
  unidadeId = null,
}) {
  obterBanco()
    .prepare(
      "INSERT INTO faturamento_historico (documento_id, unidade_id, responsavel, administrador_id, acao, dados) VALUES (?,?,?,?,?,?)",
    )
    .run(
      documentoId,
      unidadeId,
      responsavel,
      administradorId,
      acao,
      JSON.stringify(dados),
    );
}

export function registrarRecebimentoPdf({
  hash = null,
  nome,
  lote,
  resultado,
  codigo,
  motivo,
  documentoId = null,
  responsavel,
  origem,
}) {
  obterBanco()
    .prepare(
      `INSERT INTO faturamento_recebimentos_pdf
       (hash,nome,lote,resultado,codigo,motivo,documento_id,responsavel,origem)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      hash,
      nome,
      lote,
      resultado,
      codigo,
      motivo,
      documentoId,
      responsavel,
      origem,
    );
}
