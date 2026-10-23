import { createHash, randomUUID } from "node:crypto";

export function chaveProcessamentoCentral(documento) {
  return createHash("sha256")
    .update(
      `central-homologacao:${documento.id}:${documento.versao}:${documento.hash}:${documento.modoProcessamento}`,
    )
    .digest("hex");
}

export function iniciarProcessamentoCentral({
  banco,
  documento,
  administrador,
  modo,
}) {
  const chave = chaveProcessamentoCentral(documento);
  const existente = banco
    .prepare(
      "SELECT * FROM faturamento_processamentos_central WHERE chave_idempotencia=?",
    )
    .get(chave);
  if (existente) return { existente, criado: false };
  const id = randomUUID();
  banco
    .prepare(
      `INSERT INTO faturamento_processamentos_central
       (id,chave_idempotencia,documento_id,documento_versao,ambiente,modo,estado,origem,responsavel,administrador_id)
       VALUES (?,?,?,?, 'homologacao',?,'em_andamento',?,?,?)`,
    )
    .run(
      id,
      chave,
      documento.id,
      documento.versao,
      modo,
      JSON.stringify({
        hash: documento.hash,
        competencia: documento.competencia,
      }),
      administrador.nome,
      administrador.id,
    );
  return { criado: true, id, chave };
}

export function concluirProcessamentoCentral({ banco, id, estado, resultado }) {
  if (!["concluido", "revisar", "falhou"].includes(estado))
    throw new Error("estado_processamento_central_invalido");
  const atualizado = banco
    .prepare(
      `UPDATE faturamento_processamentos_central
       SET estado=?,resultado=?,concluido_em=CURRENT_TIMESTAMP
       WHERE id=? AND estado='em_andamento'`,
    )
    .run(estado, JSON.stringify(resultado), id);
  if (atualizado.changes !== 1)
    throw new Error("transicao_processamento_central_invalida");
  return banco
    .prepare("SELECT * FROM faturamento_processamentos_central WHERE id=?")
    .get(id);
}

export function processamentoCentralSeguro(registro) {
  if (!registro) return null;
  return {
    ...registro,
    origem: JSON.parse(registro.origem),
    resultado: registro.resultado ? JSON.parse(registro.resultado) : null,
  };
}
