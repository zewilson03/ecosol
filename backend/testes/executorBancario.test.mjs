import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-executor-"));
process.env.NODE_ENV = "test";

const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { criarAdaptadorSicoobSimulado } =
  await import("../servidor/bancario/adaptadorSimulado.mjs");
const { criarExecutorBancario } =
  await import("../servidor/bancario/executor.mjs");
const { FalhaDeIntegracaoBancaria } =
  await import("../servidor/bancario/contrato.mjs");
const { prepararBancario } = await import("../servidor/bancario/esquema.mjs");
const { hashCanonico, jsonCanonico } =
  await import("../servidor/bancario/operacoes.mjs");

const banco = obterBanco();
const preparadorId = Number(
  banco
    .prepare(
      "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,3)",
    )
    .run("Preparador", "preparador-executor@teste.local", "hash")
    .lastInsertRowid,
);
const aprovadorId = Number(
  banco
    .prepare(
      "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,3)",
    )
    .run("Aprovador", "aprovador-executor@teste.local", "hash").lastInsertRowid,
);
banco
  .prepare(
    "INSERT INTO bancario_papeis_equipe(staff_id,papel,concedido_por) VALUES(?, 'operador_financeiro', 9999)",
  )
  .run(preparadorId);
banco
  .prepare(
    "INSERT INTO bancario_papeis_equipe(staff_id,papel,concedido_por) VALUES(?, 'aprovador_financeiro', 9999)",
  )
  .run(aprovadorId);

const clienteId = Number(
  banco
    .prepare("INSERT INTO customers(name,cpf,email,phone) VALUES(?,?,?,?)")
    .run("Cliente executor", "52998224725", "executor@teste.local", "")
    .lastInsertRowid,
);
const unidadeId = Number(
  banco
    .prepare(
      `INSERT INTO faturamento_unidades
       (uc,nome,documento,email,dia_vencimento,cliente_id)
       VALUES(?,?,?,?,?,?)`,
    )
    .run(
      "987654321",
      "Cliente executor",
      "52998224725",
      "executor@teste.local",
      20,
      clienteId,
    ).lastInsertRowid,
);

let sequencia = 0;
function criarTrabalho(rotulo, valorCentavos = 10000) {
  sequencia += 1;
  const competencia = `2027-${String(sequencia).padStart(2, "0")}`;
  const pdf = Buffer.from(`%PDF simulador ${rotulo}`);
  const documentoHash = createHash("sha256").update(pdf).digest("hex");
  const memoria = {
    regra: "ecosol-v1",
    total_centavos: valorCentavos,
    vencimento_ecosol: "2027-12-20",
    unidade: { id: unidadeId, uc: "987654321" },
  };
  const documentoId = Number(
    banco
      .prepare(
        `INSERT INTO faturamento_documentos
         (hash,nome,pdf,lote,texto,extracao,dados,memoria,unidade_id,
          competencia,status,classificacao,finalidade,versao)
         VALUES(?,?,?,?,?,?,?,?,?,?,'Aprovada — aguardando emissão','fatura','cobranca',7)`,
      )
      .run(
        documentoHash,
        `${rotulo}.pdf`,
        pdf,
        rotulo,
        "texto",
        "{}",
        "{}",
        JSON.stringify(memoria),
        unidadeId,
        competencia,
      ).lastInsertRowid,
  );
  const snapshot = {
    versao: 1,
    tipo: "cobranca",
    origem: {
      documento_id: documentoId,
      documento_hash: documentoHash,
      documento_versao: 7,
      nome: `${rotulo}.pdf`,
    },
    cliente: {
      id: clienteId,
      nome: "Cliente executor",
      documento: "52998224725",
    },
    unidade: { id: unidadeId, uc: "987654321", competencia },
    cobranca: {
      valor_centavos: valorCentavos,
      moeda: "BRL",
      vencimento: "2027-12-20",
    },
    memoria_calculo: memoria,
  };
  const operacaoId = randomUUID();
  const idempotencia = createHash("sha256")
    .update(`executor-${rotulo}`)
    .digest("hex");
  const snapshotHash = hashCanonico(snapshot);
  banco
    .prepare(
      `INSERT INTO bancario_operacoes
       (id,tipo,ambiente,conta_referencia,origem_tipo,origem_id,origem_versao,
        idempotencia,valor_centavos,vencimento,snapshot,snapshot_hash,estado,preparado_por)
       VALUES(?,'cobranca','homologacao','conta-teste','faturamento_documento',?,7,
              ?,?,'2027-12-20',?,?,'aguardando_aprovacao',?)`,
    )
    .run(
      operacaoId,
      String(documentoId),
      idempotencia,
      valorCentavos,
      jsonCanonico(snapshot),
      snapshotHash,
      preparadorId,
    );
  banco
    .prepare(
      `INSERT INTO bancario_aprovacoes
       (operacao_id,operacao_versao,snapshot_hash,preparador_id,aprovador_id)
       VALUES(?,1,?,?,?)`,
    )
    .run(operacaoId, snapshotHash, preparadorId, aprovadorId);
  banco
    .prepare("UPDATE bancario_operacoes SET estado='aprovada' WHERE id=?")
    .run(operacaoId);
  const intencaoId = randomUUID();
  banco
    .prepare(
      `INSERT INTO bancario_intencoes
       (id,operacao_id,operacao_versao,acao,estado,proxima_tentativa_em)
       VALUES(?,?,1,'registrar_cobranca','pendente',0)`,
    )
    .run(intencaoId, operacaoId);
  banco
    .prepare("UPDATE bancario_operacoes SET estado='envio_pendente' WHERE id=?")
    .run(operacaoId);
  return { operacaoId, intencaoId, documentoId, idempotencia };
}

const cenarios = new Map();
const adaptador = criarAdaptadorSicoobSimulado({
  banco,
  decidir({ idempotencia, etapa, tentativa }) {
    const cenario = cenarios.get(idempotencia) ?? "sucesso";
    if (
      cenario === "falha_segura_uma_vez" &&
      etapa === "envio" &&
      tentativa === 1
    )
      return "indisponivel_antes_envio";
    if (cenario === "falha_segura_sempre" && etapa === "envio")
      return "indisponivel_antes_envio";
    if (cenario === "aceitar_e_timeout" && etapa === "envio")
      return "aceitar_e_timeout";
    if (cenario === "timeout_sem_aceite" && etapa === "envio")
      return "timeout_sem_aceite";
    if (cenario === "rejeitada" && etapa === "envio") return "rejeitada";
    return "sucesso";
  },
});
let agora = 2_000_000_000_000;
const executor = criarExecutorBancario({
  banco,
  adaptador,
  relogio: () => agora,
  executorId: "executor-teste",
});

function operacao(id) {
  return banco
    .prepare(
      "SELECT estado,provedor_id,ultimo_codigo FROM bancario_operacoes WHERE id=?",
    )
    .get(id);
}

function intencao(id) {
  return banco
    .prepare(
      "SELECT estado,tentativas,posse_por,posse_ate FROM bancario_intencoes WHERE id=?",
    )
    .get(id);
}

try {
  const sucesso = criarTrabalho("sucesso");
  assert.deepEqual(await executor.processarUma(), {
    processada: false,
    motivo: "sem_trabalho",
  });
  banco
    .prepare("UPDATE bancario_controle_executor SET pausado=0 WHERE id=1")
    .run();
  assert.equal((await executor.processarUma()).processada, true);
  assert.equal(operacao(sucesso.operacaoId).estado, "registrada");
  assert.match(operacao(sucesso.operacaoId).provedor_id, /^SIM-/);
  assert.equal(intencao(sucesso.intencaoId).estado, "concluida");

  const ambiguoAceito = criarTrabalho("ambiguo-aceito");
  cenarios.set(ambiguoAceito.idempotencia, "aceitar_e_timeout");
  await executor.processarUma();
  assert.equal(
    operacao(ambiguoAceito.operacaoId).estado,
    "resultado_desconhecido",
  );
  assert.equal(
    intencao(ambiguoAceito.intencaoId).estado,
    "resultado_desconhecido",
  );
  agora += quinzeMinutosParaTeste();
  await executor.processarUma();
  assert.equal(operacao(ambiguoAceito.operacaoId).estado, "registrada");
  assert.deepEqual(
    banco
      .prepare(
        "SELECT etapa FROM bancario_tentativas WHERE operacao_id=? ORDER BY rowid",
      )
      .all(ambiguoAceito.operacaoId)
      .map((item) => item.etapa),
    ["envio", "consulta"],
  );
  const ambiguoAusente = criarTrabalho("ambiguo-ausente");
  cenarios.set(ambiguoAusente.idempotencia, "timeout_sem_aceite");
  await executor.processarUma();
  agora += quinzeMinutosParaTeste();
  await executor.processarUma();
  assert.equal(
    operacao(ambiguoAusente.operacaoId).estado,
    "resultado_desconhecido",
  );
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM bancario_simulador_cobrancas WHERE idempotencia=?",
      )
      .get(ambiguoAusente.idempotencia).n,
    0,
  );
  assert.deepEqual(
    banco
      .prepare(
        "SELECT etapa FROM bancario_tentativas WHERE operacao_id=? ORDER BY rowid",
      )
      .all(ambiguoAusente.operacaoId)
      .map((item) => item.etapa),
    ["envio", "consulta"],
  );
  banco
    .prepare("UPDATE bancario_intencoes SET proxima_tentativa_em=? WHERE id=?")
    .run(agora + 24 * 60 * 60_000, ambiguoAusente.intencaoId);

  const falhaSegura = criarTrabalho("falha-segura");
  cenarios.set(falhaSegura.idempotencia, "falha_segura_uma_vez");
  await executor.processarUma();
  assert.equal(operacao(falhaSegura.operacaoId).estado, "envio_pendente");
  assert.equal(intencao(falhaSegura.intencaoId).estado, "pendente");
  agora += quinzeMinutosParaTeste();
  await executor.processarUma();
  assert.equal(operacao(falhaSegura.operacaoId).estado, "registrada");

  const rejeitada = criarTrabalho("rejeitada");
  cenarios.set(rejeitada.idempotencia, "rejeitada");
  await executor.processarUma();
  assert.equal(operacao(rejeitada.operacaoId).estado, "rejeitada");
  assert.equal(intencao(rejeitada.intencaoId).estado, "falhou");

  const posseExpirada = criarTrabalho("posse-expirada");
  banco
    .prepare(
      "UPDATE bancario_intencoes SET estado='processando',posse_por='morto',posse_ate=? WHERE id=?",
    )
    .run(agora - 1, posseExpirada.intencaoId);
  await executor.processarUma();
  assert.equal(
    operacao(posseExpirada.operacaoId).estado,
    "resultado_desconhecido",
  );
  assert.equal(
    banco
      .prepare(
        "SELECT etapa FROM bancario_tentativas WHERE operacao_id=? ORDER BY iniciado_em DESC LIMIT 1",
      )
      .get(posseExpirada.operacaoId).etapa,
    "consulta",
  );

  const concorrente = criarTrabalho("concorrente");
  const executorDois = criarExecutorBancario({
    banco,
    adaptador,
    relogio: () => agora,
    executorId: "executor-teste-2",
  });
  const concorrencia = await Promise.all([
    executor.processarUma(),
    executorDois.processarUma(),
  ]);
  assert.equal(
    concorrencia.filter((resultado) => resultado.processada).length,
    1,
  );
  assert.equal(operacao(concorrente.operacaoId).estado, "registrada");
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM bancario_tentativas WHERE operacao_id=?",
      )
      .get(concorrente.operacaoId).n,
    1,
  );

  const limiteRetentativas = criarTrabalho("limite-retentativas");
  cenarios.set(limiteRetentativas.idempotencia, "falha_segura_sempre");
  banco
    .prepare("UPDATE bancario_intencoes SET tentativas=7 WHERE id=?")
    .run(limiteRetentativas.intencaoId);
  await executor.processarUma();
  assert.equal(operacao(limiteRetentativas.operacaoId).estado, "falhou");
  assert.equal(intencao(limiteRetentativas.intencaoId).estado, "falhou");

  const permissaoRevogada = criarTrabalho("permissao-revogada");
  banco
    .prepare(
      "DELETE FROM bancario_papeis_equipe WHERE staff_id=? AND papel='aprovador_financeiro'",
    )
    .run(aprovadorId);
  const bloqueio = await executor.processarUma();
  assert.equal(bloqueio.motivo, "bloqueada_antes_envio");
  assert.equal(operacao(permissaoRevogada.operacaoId).estado, "falhou");
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM bancario_tentativas WHERE operacao_id=?",
      )
      .get(permissaoRevogada.operacaoId).n,
    0,
  );
  banco
    .prepare(
      "INSERT INTO bancario_papeis_equipe(staff_id,papel,concedido_por) VALUES(?, 'aprovador_financeiro', 9999)",
    )
    .run(aprovadorId);
  banco
    .prepare(
      `UPDATE bancario_intencoes
       SET proxima_tentativa_em=? WHERE estado='resultado_desconhecido'`,
    )
    .run(agora + 24 * 60 * 60_000);

  const conflitoUm = criarTrabalho("provedor-conflito-um");
  let enviosConflitantes = 0;
  let consultasConflitantes = 0;
  const executorConflito = criarExecutorBancario({
    banco,
    executorId: "executor-conflito",
    relogio: () => agora,
    adaptador: {
      async registrarCobranca() {
        enviosConflitantes += 1;
        return {
          categoria: "sucesso",
          estado: "registrada",
          provedor_id: "SICOOB-MESMO-ID",
          codigo: "TESTE_REGISTRADA",
        };
      },
      async consultarCobranca() {
        consultasConflitantes += 1;
        return {
          categoria: "sucesso",
          estado: "registrada",
          provedor_id: "SICOOB-MESMO-ID",
          codigo: "TESTE_CONSULTADA",
        };
      },
    },
  });
  await executorConflito.processarUma();
  assert.equal(operacao(conflitoUm.operacaoId).estado, "registrada");
  const conflitoDois = criarTrabalho("provedor-conflito-dois");
  await executorConflito.processarUma();
  assert.equal(
    operacao(conflitoDois.operacaoId).estado,
    "resultado_desconhecido",
  );
  assert.equal(operacao(conflitoDois.operacaoId).provedor_id, null);
  assert.equal(
    operacao(conflitoDois.operacaoId).ultimo_codigo,
    "PROVEDOR_ID_CONFLITANTE",
  );
  assert.equal(
    intencao(conflitoDois.intencaoId).estado,
    "resultado_desconhecido",
  );
  assert.equal(enviosConflitantes, 2);
  agora += quinzeMinutosParaTeste();
  await executorConflito.processarUma();
  assert.equal(enviosConflitantes, 2, "uma colisão nunca pode causar reenvio");
  assert.equal(consultasConflitantes, 1);
  assert.deepEqual(
    banco
      .prepare(
        "SELECT etapa FROM bancario_tentativas WHERE operacao_id=? ORDER BY rowid",
      )
      .all(conflitoDois.operacaoId)
      .map((item) => item.etapa),
    ["envio", "consulta"],
  );

  const identificadorVazio = criarTrabalho("provedor-vazio");
  const executorIdentificadorVazio = criarExecutorBancario({
    banco,
    executorId: "executor-provedor-vazio",
    relogio: () => agora,
    adaptador: {
      async registrarCobranca() {
        return {
          categoria: "sucesso",
          estado: "registrada",
          provedor_id: "   ",
          codigo: "TESTE_REGISTRADA",
        };
      },
    },
  });
  await executorIdentificadorVazio.processarUma();
  assert.equal(
    operacao(identificadorVazio.operacaoId).estado,
    "resultado_desconhecido",
  );
  assert.equal(operacao(identificadorVazio.operacaoId).provedor_id, null);
  assert.equal(
    operacao(identificadorVazio.operacaoId).ultimo_codigo,
    "PROVEDOR_ID_INVALIDO",
  );

  const escopoDiferente = criarTrabalho("provedor-escopo-diferente");
  banco
    .prepare(
      `UPDATE bancario_operacoes
       SET conta_referencia='outra-conta',provedor_id='SICOOB-MESMO-ID'
       WHERE id=?`,
    )
    .run(escopoDiferente.operacaoId);
  assert.equal(
    operacao(escopoDiferente.operacaoId).provedor_id,
    "SICOOB-MESMO-ID",
  );
  assert.throws(
    () =>
      banco
        .prepare("UPDATE bancario_operacoes SET provedor_id='   ' WHERE id=?")
        .run(escopoDiferente.operacaoId),
    /Identificador do provedor não pode ser vazio/,
  );
  assert.throws(
    () =>
      banco
        .prepare(
          `UPDATE bancario_operacoes
           SET conta_referencia=' conta-teste ',provedor_id=' SICOOB-MESMO-ID '
           WHERE id=?`,
        )
        .run(escopoDiferente.operacaoId),
    /UNIQUE constraint failed/,
  );

  banco.exec("DROP INDEX bancario_operacoes_provedor_unico");
  banco
    .prepare(
      `UPDATE bancario_operacoes
       SET conta_referencia=' CONTA-TESTE ',provedor_id=' SICOOB-MESMO-ID '
       WHERE id=?`,
    )
    .run(escopoDiferente.operacaoId);
  assert.throws(
    () => prepararBancario(banco),
    (erro) => erro.codigo === "PROVEDOR_ID_DUPLICADO_EXISTENTE",
  );
  assert.equal(
    banco
      .prepare("SELECT provedor_id FROM bancario_operacoes WHERE id=?")
      .get(escopoDiferente.operacaoId).provedor_id,
    " SICOOB-MESMO-ID ",
    "o preflight não pode alterar dados divergentes",
  );

  const respeitaRetryAfter = criarTrabalho("retry-after");
  banco
    .prepare(
      `UPDATE bancario_intencoes SET proxima_tentativa_em=?
       WHERE id<>? AND estado IN ('pendente','resultado_desconhecido')`,
    )
    .run(agora + 24 * 60 * 60_000, respeitaRetryAfter.intencaoId);
  const executorRetryAfter = criarExecutorBancario({
    banco,
    executorId: "executor-retry-after",
    relogio: () => agora,
    adaptador: {
      async registrarCobranca() {
        throw new FalhaDeIntegracaoBancaria("TESTE_429", {
          seguroRepetir: false,
          retryAfterMs: 60 * 60_000,
        });
      },
    },
  });
  await executorRetryAfter.processarUma();
  assert.equal(
    banco
      .prepare("SELECT proxima_tentativa_em FROM bancario_intencoes WHERE id=?")
      .get(respeitaRetryAfter.intencaoId).proxima_tentativa_em,
    agora + 60 * 60_000,
  );

  const consultaPersistente = criarTrabalho("consulta-persistente");
  banco
    .prepare(
      "UPDATE bancario_operacoes SET estado='resultado_desconhecido' WHERE id=?",
    )
    .run(consultaPersistente.operacaoId);
  banco
    .prepare(
      `UPDATE bancario_intencoes
       SET estado='resultado_desconhecido',tentativas=11,proxima_tentativa_em=0
       WHERE id=?`,
    )
    .run(consultaPersistente.intencaoId);
  banco
    .prepare(
      `UPDATE bancario_intencoes SET proxima_tentativa_em=?
       WHERE id<>? AND estado IN ('pendente','resultado_desconhecido')`,
    )
    .run(agora + 24 * 60 * 60_000, consultaPersistente.intencaoId);
  const executorConsultaPersistente = criarExecutorBancario({
    banco,
    executorId: "executor-consulta-persistente",
    relogio: () => agora,
    adaptador: {
      async consultarCobranca() {
        throw new FalhaDeIntegracaoBancaria("TESTE_CONSULTA_429", {
          seguroRepetir: true,
          retryAfterMs: 60_000,
        });
      },
    },
  });
  await executorConsultaPersistente.processarUma();
  assert.equal(intencao(consultaPersistente.intencaoId).estado, "falhou");
  assert.equal(
    operacao(consultaPersistente.operacaoId).estado,
    "resultado_desconhecido",
  );
  assert.equal(
    banco
      .prepare(
        `SELECT COUNT(*) AS n FROM bancario_auditoria_operacoes
         WHERE operacao_id=? AND acao='Consulta automática suspensa; requer intervenção'`,
      )
      .get(consultaPersistente.operacaoId).n,
    1,
  );

  const falhaPermanente = criarTrabalho("falha-permanente");
  banco
    .prepare(
      `UPDATE bancario_intencoes SET proxima_tentativa_em=?
       WHERE id<>? AND estado IN ('pendente','resultado_desconhecido')`,
    )
    .run(agora + 24 * 60 * 60_000, falhaPermanente.intencaoId);
  const executorFalhaPermanente = criarExecutorBancario({
    banco,
    executorId: "executor-falha-permanente",
    relogio: () => agora,
    adaptador: {
      async registrarCobranca() {
        throw new FalhaDeIntegracaoBancaria("SICOOB_ACESSO_NEGADO", {
          permanente: true,
        });
      },
    },
  });
  await executorFalhaPermanente.processarUma();
  assert.equal(intencao(falhaPermanente.intencaoId).estado, "falhou");
  assert.equal(operacao(falhaPermanente.operacaoId).estado, "falhou");
  assert.equal(
    banco
      .prepare(
        `SELECT COUNT(*) AS n FROM bancario_auditoria_operacoes
         WHERE operacao_id=? AND acao='Falha permanente de integração; requer intervenção'`,
      )
      .get(falhaPermanente.operacaoId).n,
    1,
  );

  const comArtefatos = criarTrabalho("com-artefatos");
  banco
    .prepare(
      `UPDATE bancario_intencoes SET proxima_tentativa_em=?
       WHERE id<>? AND estado IN ('pendente','resultado_desconhecido')`,
    )
    .run(agora + 24 * 60 * 60_000, comArtefatos.intencaoId);
  const pdfTeste = Buffer.from("%PDF-1.4\nboleto fictício de homologação\n");
  const executorArtefatos = criarExecutorBancario({
    banco,
    executorId: "executor-artefatos",
    relogio: () => agora,
    adaptador: {
      async registrarCobranca() {
        return {
          categoria: "sucesso",
          provedor_id: "987654321",
          estado: "registrada",
          codigo: "SICOOB_BOLETO_INCLUIDO",
          artefatos: {
            linha_digitavel: "1".repeat(47),
            codigo_barras: "2".repeat(44),
            qr_code: "00020101021226890014br.gov.bcb.pix",
            pdf_base64: pdfTeste.toString("base64"),
          },
        };
      },
    },
  });
  await executorArtefatos.processarUma();
  assert.equal(operacao(comArtefatos.operacaoId).estado, "registrada");
  const artefatosPersistidos = banco
    .prepare(
      `SELECT nosso_numero,linha_digitavel,codigo_barras,qr_code,pdf,pdf_sha256
       FROM bancario_artefatos_cobranca WHERE operacao_id=?`,
    )
    .get(comArtefatos.operacaoId);
  assert.equal(artefatosPersistidos.nosso_numero, "987654321");
  assert.equal(artefatosPersistidos.linha_digitavel, "1".repeat(47));
  assert.equal(artefatosPersistidos.codigo_barras, "2".repeat(44));
  assert.equal(
    artefatosPersistidos.qr_code,
    "00020101021226890014br.gov.bcb.pix",
  );
  assert.deepEqual(Buffer.from(artefatosPersistidos.pdf), pdfTeste);
  assert.equal(artefatosPersistidos.pdf_sha256.length, 64);

  assert.ok(
    banco.prepare("SELECT COUNT(*) AS n FROM bancario_tentativas").get().n >= 8,
  );
  console.log(
    "OK: executor pausado, claim, sucesso, rejeição, retry seguro, timeout, consulta e posse expirada.",
  );
} finally {
  banco.close();
}

function quinzeMinutosParaTeste() {
  return 16 * 60_000;
}
