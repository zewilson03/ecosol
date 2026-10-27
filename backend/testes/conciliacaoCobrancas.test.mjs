import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

process.env.ECOSOL_DATA_DIR = mkdtempSync(
  join(tmpdir(), "ecosol-conciliacao-"),
);
process.env.NODE_ENV = "test";

const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { conciliarCobranca } =
  await import("../servidor/bancario/conciliacaoCobrancas.mjs");
const { FalhaDeIntegracaoBancaria } =
  await import("../servidor/bancario/contrato.mjs");
const { criarAdaptadorDeConciliacaoManual, executarConciliacaoManual } =
  await import("../servidor/bancario/conciliacaoManual.mjs");
const { prepararBancario } = await import("../servidor/bancario/esquema.mjs");

{
  const legado = new DatabaseSync(":memory:");
  legado.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE staff_users(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      access_level INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE bancario_reconciliacoes_cobranca(
      id TEXT PRIMARY KEY,
      operacao_id TEXT NOT NULL,
      correlacao TEXT NOT NULL UNIQUE,
      estado TEXT NOT NULL,
      estado_anterior TEXT NOT NULL,
      estado_observado TEXT,
      codigo TEXT,
      iniciado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      concluido_em TEXT
    );
  `);
  prepararBancario(legado);
  const colunas = new Set(
    legado
      .prepare("PRAGMA table_info(bancario_reconciliacoes_cobranca)")
      .all()
      .map((coluna) => coluna.name),
  );
  assert.ok(colunas.has("solicitado_por"));
  assert.ok(colunas.has("solicitado_por_nome"));
  assert.ok(
    legado
      .prepare("PRAGMA index_list(bancario_reconciliacoes_cobranca)")
      .all()
      .some(
        (indice) => indice.name === "bancario_reconciliacoes_limite_manual",
      ),
  );
  legado.close();
}

const banco = obterBanco();
assert.ok(
  banco
    .prepare("PRAGMA index_list(bancario_reconciliacoes_cobranca)")
    .all()
    .some((indice) => indice.name === "bancario_reconciliacoes_limite_manual"),
);
const preparadorId = Number(
  banco
    .prepare(
      "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,3)",
    )
    .run("Conciliação", "conciliacao@teste.local", "hash").lastInsertRowid,
);

let sequencia = 0;
function criarOperacao(estado = "registrada", provedorId = undefined) {
  sequencia += 1;
  const id = randomUUID();
  const nossoNumero =
    provedorId === undefined ? `900000000${sequencia}` : provedorId;
  const idempotencia = createHash("sha256")
    .update(`conciliacao-${sequencia}`)
    .digest("hex");
  banco
    .prepare(
      `INSERT INTO bancario_operacoes
       (id,tipo,ambiente,conta_referencia,origem_tipo,origem_id,origem_versao,
        idempotencia,valor_centavos,vencimento,snapshot,snapshot_hash,
        provedor_id,estado,preparado_por)
       VALUES(?,'cobranca','homologacao','conta-teste','manual',?,1,
              ?,10000,'2027-01-20','{}',?, ?,?,?)`,
    )
    .run(
      id,
      `manual-${sequencia}`,
      idempotencia,
      createHash("sha256").update("{}").digest("hex"),
      nossoNumero,
      estado,
      preparadorId,
    );
  return { id, nossoNumero };
}

function estadoDaOperacao(id) {
  return banco
    .prepare("SELECT estado FROM bancario_operacoes WHERE id=?")
    .get(id).estado;
}

function reconciliacaoDaOperacao(id) {
  return banco
    .prepare(
      `SELECT estado,estado_anterior,estado_observado,codigo
       FROM bancario_reconciliacoes_cobranca
       WHERE operacao_id=? ORDER BY iniciado_em DESC LIMIT 1`,
    )
    .get(id);
}

{
  const operacao = criarOperacao("registrada");
  const resposta = await conciliarCobranca({
    banco,
    operacaoId: operacao.id,
    adaptador: {
      async consultarCobranca() {
        return {
          categoria: "sucesso",
          estado: "registrada",
          provedor_id: operacao.nossoNumero,
          codigo: "SICOOB_EM_ABERTO",
        };
      },
    },
  });
  assert.equal(resposta.resultado, "concluida");
  assert.equal(estadoDaOperacao(operacao.id), "registrada");
  assert.deepEqual(
    { ...reconciliacaoDaOperacao(operacao.id) },
    {
      estado: "concluida",
      estado_anterior: "registrada",
      estado_observado: "registrada",
      codigo: "SICOOB_EM_ABERTO",
    },
  );
}

{
  const operacao = criarOperacao("registrada");
  await conciliarCobranca({
    banco,
    operacaoId: operacao.id,
    adaptador: {
      async consultarCobranca() {
        return {
          categoria: "sucesso",
          estado: "liquidada",
          provedor_id: operacao.nossoNumero,
          codigo: "SICOOB_LIQUIDADA",
        };
      },
    },
  });
  assert.equal(estadoDaOperacao(operacao.id), "liquidada");
}

{
  const operacao = criarOperacao("registrada");
  const parcial = await conciliarCobranca({
    banco,
    operacaoId: operacao.id,
    adaptador: {
      async consultarCobranca() {
        return {
          categoria: "sucesso",
          estado: "liquidada",
          provedor_id: operacao.nossoNumero,
          valor_pago_centavos: 5_000,
          codigo: "SIM_PAGAMENTO_PARCIAL",
        };
      },
    },
  });
  assert.equal(parcial.resultado, "inconclusiva");
  assert.equal(parcial.codigo, "CONCILIACAO_PAGAMENTO_PARCIAL");
  assert.equal(estadoDaOperacao(operacao.id), "registrada");
}

{
  const operacao = criarOperacao("registrada");
  const excedente = await conciliarCobranca({
    banco,
    operacaoId: operacao.id,
    adaptador: {
      async consultarCobranca() {
        return {
          categoria: "sucesso",
          estado: "liquidada",
          provedor_id: operacao.nossoNumero,
          valor_pago_centavos: 10_001,
          codigo: "SIM_VALOR_EXCEDENTE",
        };
      },
    },
  });
  assert.equal(excedente.resultado, "inconclusiva");
  assert.equal(excedente.codigo, "CONCILIACAO_VALOR_EXCEDENTE");
  assert.equal(estadoDaOperacao(operacao.id), "registrada");
}

{
  const operacao = criarOperacao("liquidada");
  const estorno = await conciliarCobranca({
    banco,
    operacaoId: operacao.id,
    adaptador: {
      async consultarCobranca() {
        return {
          categoria: "sucesso",
          estado: "estornada",
          provedor_id: operacao.nossoNumero,
          valor_pago_centavos: 10_000,
          codigo: "SIM_ESTORNO",
        };
      },
    },
  });
  assert.equal(estorno.resultado, "inconclusiva");
  assert.equal(estorno.codigo, "CONCILIACAO_ESTORNO_REQUER_REVISAO");
  assert.equal(estadoDaOperacao(operacao.id), "liquidada");
}

{
  const operacao = criarOperacao("registrada");
  const adaptador = {
    async consultarCobranca() {
      return {
        categoria: "sucesso",
        estado: "liquidada",
        provedor_id: operacao.nossoNumero,
        valor_pago_centavos: 10_000,
        codigo: "SIM_LIQUIDADA",
      };
    },
  };
  await conciliarCobranca({ banco, operacaoId: operacao.id, adaptador });
  await conciliarCobranca({ banco, operacaoId: operacao.id, adaptador });
  assert.equal(estadoDaOperacao(operacao.id), "liquidada");
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) AS total FROM bancario_auditoria_operacoes WHERE operacao_id=? AND estado_anterior='registrada' AND estado_novo='liquidada'",
      )
      .get(operacao.id).total,
    1,
  );
}

{
  const operacao = criarOperacao("liquidada");
  const resposta = await conciliarCobranca({
    banco,
    operacaoId: operacao.id,
    adaptador: {
      async consultarCobranca() {
        return {
          categoria: "sucesso",
          estado: "registrada",
          provedor_id: operacao.nossoNumero,
          codigo: "SICOOB_EM_ABERTO",
        };
      },
    },
  });
  assert.equal(resposta.estadoAtual, "liquidada");
  assert.equal(estadoDaOperacao(operacao.id), "liquidada");
}

{
  const operacao = criarOperacao("resultado_desconhecido");
  await conciliarCobranca({
    banco,
    operacaoId: operacao.id,
    adaptador: {
      async consultarCobranca() {
        return {
          categoria: "sucesso",
          estado: "registrada",
          provedor_id: operacao.nossoNumero,
          codigo: "SICOOB_ENCONTRADA",
        };
      },
    },
  });
  assert.equal(estadoDaOperacao(operacao.id), "registrada");
}

{
  const operacao = criarOperacao("registrada", null);
  let chamadas = 0;
  await assert.rejects(
    conciliarCobranca({
      banco,
      operacaoId: operacao.id,
      adaptador: {
        async consultarCobranca() {
          chamadas += 1;
        },
      },
    }),
    (erro) =>
      erro.status === 409 && erro.codigo === "CONCILIACAO_SEM_NOSSO_NUMERO",
  );
  assert.equal(chamadas, 0);
}

{
  const operacao = criarOperacao("registrada");
  let liberar;
  const espera = new Promise((resolve) => {
    liberar = resolve;
  });
  let chamadas = 0;
  const adaptador = {
    async consultarCobranca() {
      chamadas += 1;
      await espera;
      return {
        categoria: "sucesso",
        estado: "registrada",
        provedor_id: operacao.nossoNumero,
        codigo: "SICOOB_EM_ABERTO",
      };
    },
  };
  const primeira = conciliarCobranca({
    banco,
    operacaoId: operacao.id,
    adaptador,
  });
  await assert.rejects(
    conciliarCobranca({ banco, operacaoId: operacao.id, adaptador }),
    (erro) => erro.status === 409 && erro.codigo === "CONCILIACAO_EM_ANDAMENTO",
  );
  liberar();
  await primeira;
  assert.equal(chamadas, 1);
}

{
  const operacao = criarOperacao("registrada");
  let liberarPrimeira;
  const primeiraPendente = new Promise((resolve) => {
    liberarPrimeira = resolve;
  });
  const tentativas = [];
  const adaptador = {
    async consultarCobranca({ tentativa }) {
      tentativas.push(tentativa);
      if (tentativa === 1) await primeiraPendente;
      return {
        categoria: "sucesso",
        estado: tentativa === 1 ? "registrada" : "liquidada",
        provedor_id: operacao.nossoNumero,
        codigo: tentativa === 1 ? "RESPOSTA_ANTIGA" : "RESPOSTA_RECUPERADA",
      };
    },
  };
  const primeira = conciliarCobranca({
    banco,
    operacaoId: operacao.id,
    adaptador,
    executorId: "executor-antigo",
    relogio: () => 1_000,
  });
  await Promise.resolve();
  const recuperada = await conciliarCobranca({
    banco,
    operacaoId: operacao.id,
    adaptador,
    executorId: "executor-recuperador",
    relogio: () => 301_001,
  });
  liberarPrimeira();
  const respostaAntiga = await primeira;

  assert.equal(recuperada.resultado, "concluida");
  assert.equal(recuperada.estadoAtual, "liquidada");
  assert.deepEqual(respostaAntiga, {
    ignorada: true,
    motivo: "posse_perdida",
  });
  assert.deepEqual(tentativas, [1, 2]);
  assert.equal(estadoDaOperacao(operacao.id), "liquidada");
  const reconciliacoes = banco
    .prepare(
      `SELECT tentativa,estado,codigo,posse_por,posse_ate
       FROM bancario_reconciliacoes_cobranca
       WHERE operacao_id=? ORDER BY tentativa`,
    )
    .all(operacao.id)
    .map((item) => ({ ...item }));
  assert.deepEqual(reconciliacoes, [
    {
      tentativa: 1,
      estado: "inconclusiva",
      codigo: "CONCILIACAO_POSSE_EXPIRADA",
      posse_por: null,
      posse_ate: null,
    },
    {
      tentativa: 2,
      estado: "concluida",
      codigo: "RESPOSTA_RECUPERADA",
      posse_por: null,
      posse_ate: null,
    },
  ]);
  assert.equal(
    banco
      .prepare(
        `SELECT COUNT(*) AS total FROM bancario_auditoria_operacoes
         WHERE operacao_id=? AND acao='Recuperação de conciliação expirada'`,
      )
      .get(operacao.id).total,
    1,
  );
}

{
  const operacao = criarOperacao("registrada");
  await assert.rejects(
    conciliarCobranca({
      banco,
      operacaoId: operacao.id,
      adaptador: {
        async consultarCobranca() {
          throw new FalhaDeIntegracaoBancaria("SICOOB_INDISPONIVEL", {
            seguroRepetir: true,
          });
        },
      },
    }),
    (erro) => erro.codigo === "SICOOB_INDISPONIVEL",
  );
  assert.equal(estadoDaOperacao(operacao.id), "registrada");
  assert.equal(reconciliacaoDaOperacao(operacao.id).estado, "falhou");
}

{
  const operacao = criarOperacao("registrada");
  await conciliarCobranca({
    banco,
    operacaoId: operacao.id,
    adaptador: {
      async consultarCobranca() {
        return { categoria: "nao_encontrada", codigo: "SICOOB_204" };
      },
    },
  });
  assert.equal(estadoDaOperacao(operacao.id), "registrada");
  assert.equal(reconciliacaoDaOperacao(operacao.id).estado, "inconclusiva");
}

{
  const operacao = criarOperacao("registrada");
  const resposta = await conciliarCobranca({
    banco,
    operacaoId: operacao.id,
    solicitante: { id: preparadorId, nome: "Conciliação" },
    adaptador: {
      async consultarCobranca() {
        return {
          categoria: "sucesso",
          estado: "registrada",
          provedor_id: "OUTRO-NOSSO-NUMERO",
          codigo: "SICOOB_DIVERGENTE",
        };
      },
    },
  });
  assert.equal(resposta.resultado, "inconclusiva");
  assert.equal(resposta.codigo, "CONCILIACAO_PROVEDOR_DIVERGENTE");
  assert.equal(estadoDaOperacao(operacao.id), "registrada");
  assert.equal(
    banco
      .prepare(
        `SELECT COUNT(*) AS total FROM bancario_auditoria_operacoes
         WHERE operacao_id=? AND ator_id=?
           AND acao='Conciliação manual solicitada'`,
      )
      .get(operacao.id, preparadorId).total,
    1,
  );
}

assert.throws(
  () =>
    criarAdaptadorDeConciliacaoManual({
      banco,
      variaveis: {
        BANCARIO_EXECUTOR_MODO: "real",
        SICOOB_AMBIENTE: "producao",
      },
    }),
  (erro) =>
    erro.status === 409 && erro.codigo === "CONCILIACAO_MANUAL_INDISPONIVEL",
);

{
  const operacao = criarOperacao("registrada");
  const adaptador = {
    async consultarCobranca() {
      return {
        categoria: "sucesso",
        estado: "registrada",
        provedor_id: operacao.nossoNumero,
        codigo: "SICOOB_EM_ABERTO",
      };
    },
  };
  for (let tentativa = 0; tentativa < 5; tentativa += 1)
    await executarConciliacaoManual({
      banco,
      operacaoId: operacao.id,
      administrador: { id: preparadorId, nome: "Conciliação" },
      adaptador,
    });
  await assert.rejects(
    executarConciliacaoManual({
      banco,
      operacaoId: operacao.id,
      administrador: { id: preparadorId, nome: "Conciliação" },
      adaptador,
    }),
    (erro) =>
      erro.status === 429 && erro.codigo === "CONCILIACAO_LIMITE_ATINGIDO",
  );
  const bloqueio = banco
    .prepare(
      `SELECT ator_id,acao,detalhes FROM bancario_auditoria_operacoes
       WHERE operacao_id=? AND acao='Conciliação manual bloqueada'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(operacao.id);
  assert.equal(bloqueio.ator_id, preparadorId);
  assert.deepEqual(JSON.parse(bloqueio.detalhes), {
    codigo: "CONCILIACAO_LIMITE_ATINGIDO",
  });
}

{
  const operacao = criarOperacao("registrada");
  await assert.rejects(
    executarConciliacaoManual({
      banco,
      operacaoId: operacao.id,
      administrador: { id: preparadorId, nome: "Conciliação" },
      adaptador: {
        async consultarCobranca() {
          throw new FalhaDeIntegracaoBancaria("SIM_CONSULTA_INDISPONIVEL", {
            seguroRepetir: true,
          });
        },
      },
    }),
    (erro) =>
      erro.status === 503 && erro.codigo === "SIM_CONSULTA_INDISPONIVEL",
  );
  assert.equal(estadoDaOperacao(operacao.id), "registrada");
  assert.equal(reconciliacaoDaOperacao(operacao.id).estado, "falhou");
}

console.log("Conciliação bancária de cobranças: testes concluídos.");
