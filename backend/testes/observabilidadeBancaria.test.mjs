import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ECOSOL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "ecosol-observabilidade-"),
);
process.env.NODE_ENV = "test";

const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { obterObservabilidadeBancaria } =
  await import("../servidor/bancario/observabilidadeBancaria.mjs");

const banco = obterBanco();
const staffId = Number(
  banco
    .prepare(
      "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,3)",
    )
    .run("Auditoria", "auditoria-observabilidade@teste.local", "hash")
    .lastInsertRowid,
);
const aprovadorId = Number(
  banco
    .prepare(
      "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,3)",
    )
    .run("Aprovador", "aprovador-observabilidade@teste.local", "hash")
    .lastInsertRowid,
);
let sequencia = 0;

function criarOperacao(estado, { provedor = null, codigo = null } = {}) {
  sequencia += 1;
  const id = randomUUID();
  banco
    .prepare(
      `INSERT INTO bancario_operacoes
       (id,tipo,ambiente,conta_referencia,origem_tipo,origem_id,origem_versao,
        idempotencia,valor_centavos,vencimento,snapshot,snapshot_hash,
        provedor_id,ultimo_codigo,estado,preparado_por,criado_em,atualizado_em)
       VALUES(?,'cobranca','homologacao','conta-teste','manual',?,1,?,10000,
              '2026-11-20','{}',?,?,?,?,?,'2026-10-22 10:00:00','2026-10-22 11:00:00')`,
    )
    .run(
      id,
      `observabilidade-${sequencia}`,
      createHash("sha256").update(`idem-${sequencia}`).digest("hex"),
      createHash("sha256").update("{}").digest("hex"),
      provedor,
      codigo,
      estado,
      staffId,
    );
  return id;
}

const desconhecida = criarOperacao("aguardando_aprovacao", {
  provedor: "900000001",
  codigo: "SICOOB_TIMEOUT",
});
const hashDesconhecida = banco
  .prepare("SELECT snapshot_hash FROM bancario_operacoes WHERE id=?")
  .get(desconhecida).snapshot_hash;
banco
  .prepare(
    `INSERT INTO bancario_aprovacoes
     (operacao_id,operacao_versao,snapshot_hash,preparador_id,aprovador_id)
     VALUES(?,1,?,?,?)`,
  )
  .run(desconhecida, hashDesconhecida, staffId, aprovadorId);
banco
  .prepare("UPDATE bancario_operacoes SET estado='aprovada' WHERE id=?")
  .run(desconhecida);
const intencaoId = randomUUID();
banco
  .prepare(
    `INSERT INTO bancario_intencoes
     (id,operacao_id,operacao_versao,acao,estado,tentativas)
     VALUES(?,?,1,'registrar_cobranca','resultado_desconhecido',2)`,
  )
  .run(intencaoId, desconhecida);
banco
  .prepare("UPDATE bancario_operacoes SET estado='envio_pendente' WHERE id=?")
  .run(desconhecida);
banco
  .prepare(
    `UPDATE bancario_operacoes
     SET estado='resultado_desconhecido',atualizado_em='2026-10-22 11:00:00'
     WHERE id=?`,
  )
  .run(desconhecida);
banco
  .prepare(
    `INSERT INTO bancario_tentativas
     (id,intencao_id,operacao_id,etapa,correlacao,resultado,codigo,concluido_em)
     VALUES(?,?,?,'consulta',?,'resultado_desconhecido',?,CURRENT_TIMESTAMP)`,
  )
  .run(
    randomUUID(),
    intencaoId,
    desconhecida,
    randomUUID(),
    "resposta sensível que não deve aparecer",
  );

const registrada = criarOperacao("registrada", { provedor: "900000002" });
banco
  .prepare(
    `INSERT INTO bancario_reconciliacoes_cobranca
     (id,operacao_id,correlacao,estado,estado_anterior,estado_observado,codigo,
      tentativa,solicitado_por,solicitado_por_nome)
     VALUES(?,?,?,'inconclusiva','registrada',NULL,'SICOOB_NAO_ENCONTRADO',1,?,?)`,
  )
  .run(randomUUID(), registrada, randomUUID(), staffId, "Auditoria");

criarOperacao("liquidada", { provedor: "900000003" });

const resultado = obterObservabilidadeBancaria({
  banco,
  limite: 20,
  relogio: () => Date.parse("2026-10-22T12:00:00Z"),
  variaveis: {
    SICOOB_AMBIENTE: "homologacao",
    BANCARIO_EXECUTOR_MODO: "desligado",
  },
});

assert.equal(resultado.executor.pausado, true);
assert.equal(resultado.executor.modo, "desligado");
assert.equal(resultado.resumo.operacoes_por_estado.liquidada, 1);
assert.equal(resultado.resumo.operacoes_por_estado.resultado_desconhecido, 1);
assert.equal(resultado.resumo.exigem_intervencao, 2);
assert.equal(resultado.resumo.pendencias_total, 2);
assert.equal(resultado.resumo.resultado_limitado, false);
assert.equal(resultado.pendencias.length, 2);

const pendenciaDesconhecida = resultado.pendencias.find(
  (item) => item.operacao_id === desconhecida,
);
assert.equal(pendenciaDesconhecida.acao_necessaria, "CONCILIAR_COBRANCA");
assert.equal(pendenciaDesconhecida.prioridade, "alta");
assert.equal(pendenciaDesconhecida.idade_estado_segundos, 3_600);
assert.equal(pendenciaDesconhecida.provedor_identificado, true);
assert.equal(pendenciaDesconhecida.ultima_tentativa.codigo, null);

const pendenciaRegistrada = resultado.pendencias.find(
  (item) => item.operacao_id === registrada,
);
assert.equal(pendenciaRegistrada.acao_necessaria, "REVISAR_CONCILIACAO");
assert.equal(pendenciaRegistrada.reconciliacao.tentativa, 1);
assert.equal(pendenciaRegistrada.reconciliacao.posse_expirada, false);
assert.equal(pendenciaRegistrada.historico_conciliacao.length, 1);
assert.equal(
  pendenciaRegistrada.historico_conciliacao[0].solicitado_por,
  "Auditoria",
);
assert.equal(
  pendenciaRegistrada.historico_conciliacao[0].codigo,
  "SICOOB_NAO_ENCONTRADO",
);

const serializado = JSON.stringify(resultado);
assert.doesNotMatch(serializado, /resposta sensível|900000001|900000002/);
assert.doesNotMatch(serializado, /snapshot|idempotencia|cpf|client_secret/i);

for (let indice = 0; indice < 25; indice += 1)
  criarOperacao("aguardando_aprovacao");
const altaRecente = criarOperacao("falhou");
banco
  .prepare(
    "UPDATE bancario_operacoes SET atualizado_em='2026-10-22 11:59:00' WHERE id=?",
  )
  .run(altaRecente);
const limitado = obterObservabilidadeBancaria({
  banco,
  limite: 10,
  relogio: () => Date.parse("2026-10-22T12:00:00Z"),
});
assert.equal(limitado.resumo.pendencias_total, 28);
assert.equal(limitado.resumo.pendencias_listadas, 10);
assert.equal(limitado.resumo.exigem_intervencao, 28);
assert.equal(limitado.resumo.resultado_limitado, true);
assert.ok(
  limitado.pendencias.some((item) => item.operacao_id === altaRecente),
  "prioridade alta recente não pode ser excluída pelo limite",
);
assert.ok(
  limitado.pendencias.slice(0, 2).every((item) => item.prioridade === "alta"),
);

assert.throws(
  () => obterObservabilidadeBancaria({ banco, limite: 0 }),
  (erro) => erro.status === 400,
);
assert.throws(
  () => obterObservabilidadeBancaria({ banco, limite: 201 }),
  (erro) => erro.status === 400,
);

console.log("Observabilidade bancária: resumo seguro e pendências validados.");
