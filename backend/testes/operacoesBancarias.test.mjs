import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-operacoes-"));
process.env.NODE_ENV = "test";
process.env.SICOOB_AMBIENTE = "homologacao";
process.env.SICOOB_CONTA_REFERENCIA = "conta-teste";

const { resumoCriptografico, protegerSenha } =
  await import("../servidor/autenticacao.mjs");
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { prepararBancario } = await import("../servidor/bancario/esquema.mjs");
const { hashCanonico, jsonCanonico } =
  await import("../servidor/bancario/operacoes.mjs");
const { rotasAdministrativas } =
  await import("../servidor/rotasAdministrativas.mjs");

const banco = obterBanco();
prepararBancario(banco);
const senhaDeTeste = "Senha bancaria de teste 2026";
const hashDeTeste = await protegerSenha(senhaDeTeste);

function criarPessoa(nome, nivel) {
  const id = Number(
    banco
      .prepare(
        "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,?)",
      )
      .run(nome, `${nome}@teste.local`, hashDeTeste, nivel).lastInsertRowid,
  );
  const token = randomBytes(32).toString("hex");
  banco
    .prepare(
      "INSERT INTO sessions(staff_id,token_hash,role,expires_at) VALUES(?,?,?,?)",
    )
    .run(id, resumoCriptografico(token), "staff", Date.now() + 60_000);
  return { id, cookie: `ecosol_session=${token}` };
}

const colaborador = criarPessoa("colaborador", 1);
const proprietario = criarPessoa("proprietario", 3);
const proprietarioDois = criarPessoa("proprietario-dois", 3);
const outroAdministrador = criarPessoa("outro-administrador", 3);
banco
  .prepare(
    "INSERT INTO equipe_papeis_criticos(staff_id,papel) VALUES(?,'proprietario')",
  )
  .run(proprietario.id);
banco
  .prepare(
    "INSERT INTO equipe_papeis_criticos(staff_id,papel) VALUES(?,'proprietario')",
  )
  .run(proprietarioDois.id);

const clienteId = Number(
  banco
    .prepare("INSERT INTO customers(name,cpf,email,phone) VALUES(?,?,?,?)")
    .run("Cliente teste", "39053344705", "cliente@teste.local", "")
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
      "123456789",
      "Cliente teste",
      "39053344705",
      "cliente@teste.local",
      20,
      clienteId,
    ).lastInsertRowid,
);

function criarFatura(sufixo, totalCentavos = 12345) {
  const pdf = Buffer.from(`%PDF-1.4 teste ${sufixo}`);
  const hash = createHash("sha256").update(pdf).digest("hex");
  const memoria = {
    regra: "ecosol-v1",
    total_centavos: totalCentavos,
    vencimento_ecosol: "2026-11-20",
    unidade: { id: unidadeId, uc: "123456789" },
  };
  return Number(
    banco
      .prepare(
        `INSERT INTO faturamento_documentos
         (hash,nome,pdf,lote,texto,extracao,dados,memoria,unidade_id,
          competencia,status,classificacao,finalidade,versao)
         VALUES(?,?,?,?,?,?,?,?,?,?,'Aprovada — aguardando emissão','fatura','cobranca',7)`,
      )
      .run(
        hash,
        `fatura-${sufixo}.pdf`,
        pdf,
        `lote-${sufixo}`,
        "texto",
        "{}",
        "{}",
        JSON.stringify(memoria),
        unidadeId,
        `2026-${sufixo}`,
      ).lastInsertRowid,
  );
}

function criarPagamento(preparadoPor, sufixo) {
  const snapshot = {
    versao: 1,
    tipo: "pagamento",
    origem: { referencia: `titulo-${sufixo}` },
    pagamento: { valor_centavos: 5000, moeda: "BRL" },
  };
  const id = randomUUID();
  banco
    .prepare(
      `INSERT INTO bancario_operacoes
       (id,tipo,ambiente,conta_referencia,origem_tipo,origem_id,origem_versao,
        idempotencia,valor_centavos,snapshot,snapshot_hash,estado,preparado_por)
       VALUES(?,'pagamento','homologacao','conta-teste','manual',?,1,?,5000,?,?,'aguardando_aprovacao',?)`,
    )
    .run(
      id,
      `titulo-${sufixo}`,
      hashCanonico({ tipo: "pagamento", sufixo }),
      jsonCanonico(snapshot),
      hashCanonico(snapshot),
      preparadoPor,
    );
  return id;
}

const aplicacao = express();
aplicacao.use(express.json(), rotasAdministrativas);
const servidor = aplicacao.listen(0, "127.0.0.1");
await new Promise((resolver) => servidor.once("listening", resolver));
const base = `http://127.0.0.1:${servidor.address().port}`;
process.env.APP_URL = base;

async function chamar(caminho, pessoa, metodo = "GET", corpo, prova) {
  return fetch(base + caminho, {
    method: metodo,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(metodo !== "GET" ? { Origin: base } : {}),
      ...(prova ? { "X-Ecosol-Confirmacao-Bancaria": prova } : {}),
      ...(pessoa ? { Cookie: pessoa.cookie } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
}

try {
  const senhaConfirmacao = "Confirmacao financeira 2026";
  const cadastroCredencial = await chamar(
    "/api/admin/bancario/credencial-confirmacao",
    proprietario,
    "PUT",
    { nova_senha: senhaConfirmacao },
  );
  assert.equal(cadastroCredencial.status, 200);
  assert.equal(
    (
      await chamar(
        "/api/admin/bancario/credencial-confirmacao",
        proprietarioDois,
        "PUT",
        { nova_senha: "Outra confirmacao 2026" },
      )
    ).status,
    403,
  );
  const faturaId = criarFatura("10");
  const criada = await chamar(
    "/api/admin/bancario/operacoes/cobrancas",
    colaborador,
    "POST",
    { documento_id: faturaId },
  );
  assert.equal(criada.status, 201);
  const cobranca = await criada.json();
  assert.equal(cobranca.operacao.estado, "aprovada");
  assert.equal(cobranca.operacao.aprovador_id, null);
  assert.equal(
    banco.prepare("SELECT COUNT(*) AS n FROM bancario_aprovacoes").get().n,
    0,
  );

  const repetida = await chamar(
    "/api/admin/bancario/operacoes/cobrancas",
    colaborador,
    "POST",
    { documento_id: faturaId },
  );
  assert.equal(repetida.status, 200);
  assert.equal((await repetida.json()).operacao.id, cobranca.operacao.id);

  const aprovacaoDesnecessaria = await chamar(
    `/api/admin/bancario/operacoes/${cobranca.operacao.id}/aprovar`,
    proprietario,
    "POST",
    { senha: senhaConfirmacao },
  );
  assert.equal(aprovacaoDesnecessaria.status, 409);

  const fila = await chamar(
    `/api/admin/bancario/operacoes/${cobranca.operacao.id}/enfileirar`,
    colaborador,
    "POST",
  );
  assert.equal(fila.status, 200);
  assert.equal((await fila.json()).operacao.estado, "envio_pendente");
  assert.equal(
    banco.prepare("SELECT COUNT(*) AS n FROM bancario_intencoes").get().n,
    1,
  );

  const lista = await chamar("/api/admin/bancario/operacoes", colaborador);
  assert.equal(lista.status, 200);
  assert.equal((await lista.json()).length, 1);

  const pagamentoId = criarPagamento(colaborador.id, "a");
  assert.equal(
    (
      await chamar(
        `/api/admin/bancario/operacoes/${pagamentoId}`,
        outroAdministrador,
      )
    ).status,
    404,
  );
  assert.equal(
    (await chamar(`/api/admin/bancario/operacoes/${pagamentoId}`, proprietario))
      .status,
    200,
  );
  assert.equal(
    (
      await chamar(
        `/api/admin/bancario/operacoes/${pagamentoId}/aprovar`,
        outroAdministrador,
        "POST",
        { senha: senhaDeTeste },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await chamar(
        `/api/admin/bancario/operacoes/${pagamentoId}/aprovar`,
        proprietario,
        "POST",
        { senha: senhaDeTeste },
      )
    ).status,
    401,
  );

  const senhaErrada = await chamar(
    `/api/admin/bancario/operacoes/${pagamentoId}/aprovar`,
    proprietario,
    "POST",
    { senha: "senha incorreta" },
  );
  assert.equal(senhaErrada.status, 401);
  const aprovada = await chamar(
    `/api/admin/bancario/operacoes/${pagamentoId}/aprovar`,
    proprietario,
    "POST",
    { senha: senhaConfirmacao },
  );
  assert.equal(aprovada.status, 200);
  const pagamento = await aprovada.json();
  assert.equal(pagamento.operacao.estado, "aprovada");
  assert.equal(pagamento.operacao.aprovador_id, proprietario.id);
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM bancario_aprovacoes_pagamento_proprietario",
      )
      .get().n,
    1,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM bancario_auditoria_operacoes WHERE operacao_id=? AND acao='Pagamento aprovado pelo Proprietário com senha de confirmação'",
      )
      .get(pagamentoId).n,
    1,
  );

  const pagamentoDoProprietarioDois = criarPagamento(colaborador.id, "owner-2");
  const aprovadoPeloSegundo = await chamar(
    `/api/admin/bancario/operacoes/${pagamentoDoProprietarioDois}/aprovar`,
    proprietarioDois,
    "POST",
    { senha: senhaConfirmacao },
  );
  assert.equal(aprovadoPeloSegundo.status, 200);
  assert.equal(
    (await aprovadoPeloSegundo.json()).operacao.aprovador_id,
    proprietarioDois.id,
  );

  banco
    .prepare(
      `INSERT INTO bancario_intencoes
       (id,operacao_id,operacao_versao,acao,estado)
       VALUES(?,?,1,'executar_pagamento','pendente')`,
    )
    .run(randomUUID(), pagamentoId);
  banco
    .prepare("DELETE FROM equipe_papeis_criticos WHERE staff_id=?")
    .run(proprietario.id);
  const pagamentoSemProprietario = criarPagamento(colaborador.id, "b");
  assert.throws(
    () =>
      banco
        .prepare(
          `INSERT INTO bancario_aprovacoes_pagamento_proprietario
           (operacao_id,operacao_versao,snapshot_hash,proprietario_id)
           SELECT id,versao,snapshot_hash,? FROM bancario_operacoes WHERE id=?`,
        )
        .run(proprietario.id, pagamentoSemProprietario),
    /Pagamento exige aprovação atual do Proprietário/,
  );

  console.log(
    "OK: cobranças não exigem senha; pagamentos exigem Proprietário e a senha financeira gerida pelo Proprietário 1.",
  );
} finally {
  await new Promise((resolver) => servidor.close(resolver));
  banco.close();
}
