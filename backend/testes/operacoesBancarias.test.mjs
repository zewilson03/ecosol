import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { PDFDocument } from "pdf-lib";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-operacoes-"));
process.env.NODE_ENV = "test";
process.env.SICOOB_AMBIENTE = "homologacao";
process.env.SICOOB_CONTA_REFERENCIA = "conta-teste";

const { resumoCriptografico, protegerSenha } =
  await import("../servidor/autenticacao.mjs");
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { obterApuracaoDeDividas } =
  await import("../servidor/financeiro/dividas.mjs");
const { prepararBancario } = await import("../servidor/bancario/esquema.mjs");
const {
  criarOperacaoDeCobranca,
  enfileirarOperacao,
  hashCanonico,
  jsonCanonico,
  liberarNovaEmissaoAposFalha,
} = await import("../servidor/bancario/operacoes.mjs");
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

function criarFatura(
  sufixo,
  totalCentavos = 12345,
  vencimento = "2026-11-20",
  componentes = {},
) {
  const pdf = Buffer.from(`%PDF-1.4 teste ${sufixo}`);
  const hash = createHash("sha256").update(pdf).digest("hex");
  const memoria = {
    regra: "ecosol-v1",
    total_centavos: totalCentavos,
    vencimento_ecosol: vencimento,
    unidade: { id: unidadeId, uc: "123456789" },
    ...componentes,
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

function criarCobrancaRegistradaVencida(sufixo, valorCentavos, vencimento) {
  const snapshot = {
    versao: 1,
    tipo: "cobranca",
    cliente: { id: clienteId, nome: "Cliente teste" },
    unidade: { id: unidadeId, uc: "123456789", competencia: "2026-09" },
    cobranca: {
      valor_centavos: valorCentavos,
      moeda: "BRL",
      vencimento,
    },
  };
  const id = randomUUID();
  banco
    .prepare(
      `INSERT INTO bancario_operacoes
       (id,tipo,ambiente,conta_referencia,origem_tipo,origem_id,origem_versao,
        idempotencia,valor_centavos,vencimento,snapshot,snapshot_hash,
        provedor_id,estado,preparado_por)
       VALUES(?,'cobranca','homologacao','conta-teste','manual',?,1,?,?,?,?,?,?,'registrada',?)`,
    )
    .run(
      id,
      `cobranca-vencida-${sufixo}`,
      hashCanonico({ tipo: "cobranca-vencida", sufixo }),
      valorCentavos,
      vencimento,
      jsonCanonico(snapshot),
      hashCanonico(snapshot),
      `nosso-numero-${sufixo}`,
      colaborador.id,
    );
  return id;
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
  assert.equal(
    (await chamar("/api/admin/bancario/estado", colaborador)).status,
    200,
  );
  assert.equal((await chamar("/api/admin/bancario/estado", null)).status, 401);
  assert.equal(
    (
      await chamar(
        `/api/admin/bancario/operacoes/${cobranca.operacao.id}/demonstrativo.pdf`,
        colaborador,
      )
    ).status,
    404,
  );
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

  // Alguns navegadores omitem Origin em chamadas locais, mas enviam metadados
  // de mesma origem. A preparação precisa funcionar sem abrir acesso externo.
  const semOrigin = await fetch(
    `${base}/api/admin/bancario/operacoes/cobrancas`,
    {
      method: "POST",
      headers: {
        Cookie: colaborador.cookie,
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ documento_id: faturaId }),
    },
  );
  assert.equal(semOrigin.status, 200);
  assert.equal((await semOrigin.json()).operacao.id, cobranca.operacao.id);
  const origemOpaca = await fetch(
    `${base}/api/admin/bancario/operacoes/cobrancas`,
    {
      method: "POST",
      headers: {
        Cookie: colaborador.cookie,
        Origin: "null",
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ documento_id: faturaId }),
    },
  );
  assert.equal(origemOpaca.status, 200);
  const comReferenciaLocal = await fetch(
    `${base}/api/admin/bancario/operacoes/cobrancas`,
    {
      method: "POST",
      headers: {
        Cookie: colaborador.cookie,
        Referer: `${base}/admin/faturas`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ documento_id: faturaId }),
    },
  );
  assert.equal(comReferenciaLocal.status, 200);
  assert.equal((await comReferenciaLocal.json()).operacao.id, cobranca.operacao.id);
  const semProvaDeOrigem = await fetch(
    `${base}/api/admin/bancario/operacoes/cobrancas`,
    {
      method: "POST",
      headers: {
        Cookie: colaborador.cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ documento_id: faturaId }),
    },
  );
  assert.equal(semProvaDeOrigem.status, 403);
  assert.equal(
    (await semProvaDeOrigem.json()).codigo,
    "ORIGEM_NAO_CONFIAVEL",
  );
  const { origemConfiavel } = await import(
    "../servidor/bancario/confirmacaoSensivel.mjs"
  );
  assert.equal(
    origemConfiavel({
      headers: {
        host: "outro.example",
        referer: `${base}/admin/faturas`,
        "sec-fetch-site": "same-origin",
      },
    }),
    false,
  );
  assert.equal(
    origemConfiavel({
      headers: { host: new URL(base).host, referer: "https://outro.example" },
    }),
    false,
  );
  const externo = await fetch(
    `${base}/api/admin/bancario/operacoes/cobrancas`,
    {
      method: "POST",
      headers: {
        Cookie: colaborador.cookie,
        Origin: "https://outro.example",
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({ documento_id: faturaId }),
    },
  );
  assert.equal(externo.status, 403);

  const faturaFalhaSeguraId = criarFatura("falha-segura");
  const operacaoFalhaSegura = criarOperacaoDeCobranca(faturaFalhaSeguraId, {
    id: colaborador.id,
    nome: "colaborador",
  }).operacao;
  const idempotenciaAnterior = operacaoFalhaSegura.idempotencia;
  enfileirarOperacao(operacaoFalhaSegura.id, {
    id: colaborador.id,
    nome: "colaborador",
  });
  const intencaoFalhaSegura = banco
    .prepare(
      "SELECT id FROM bancario_intencoes WHERE operacao_id=? AND operacao_versao=1",
    )
    .get(operacaoFalhaSegura.id);
  banco
    .prepare("UPDATE bancario_intencoes SET estado='falhou' WHERE id=?")
    .run(intencaoFalhaSegura.id);
  banco
    .prepare("UPDATE bancario_operacoes SET estado='falhou' WHERE id=?")
    .run(operacaoFalhaSegura.id);
  banco
    .prepare(
      `INSERT INTO bancario_tentativas
       (id,intencao_id,operacao_id,etapa,correlacao,resultado,concluido_em)
       VALUES(?,?,?,?,?,'falha_segura',CURRENT_TIMESTAMP)`,
    )
    .run(
      randomUUID(),
      intencaoFalhaSegura.id,
      operacaoFalhaSegura.id,
      "envio",
      randomUUID(),
    );
  const liberada = await chamar(
    `/api/admin/bancario/operacoes/${operacaoFalhaSegura.id}/liberar-nova-emissao`,
    colaborador,
    "POST",
  );
  assert.equal(liberada.status, 200);
  const operacaoLiberada = (await liberada.json()).operacao;
  assert.equal(operacaoLiberada.estado, "aprovada");
  assert.equal(operacaoLiberada.versao, 2);
  assert.notEqual(operacaoLiberada.idempotencia, idempotenciaAnterior);
  assert.equal(
    banco
      .prepare(
        `SELECT COUNT(*) AS n FROM bancario_auditoria_operacoes
         WHERE operacao_id=? AND acao IN
           ('Emissão com falha confirmada cancelada','Nova revisão liberada para emissão')`,
      )
      .get(operacaoFalhaSegura.id).n,
    2,
  );
  enfileirarOperacao(operacaoFalhaSegura.id, {
    id: colaborador.id,
    nome: "colaborador",
  });
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM bancario_intencoes WHERE operacao_id=?",
      )
      .get(operacaoFalhaSegura.id).n,
    2,
  );

  const faturaFalhaInconclusivaId = criarFatura("falha-inconclusiva");
  const operacaoFalhaInconclusiva = criarOperacaoDeCobranca(
    faturaFalhaInconclusivaId,
    { id: colaborador.id, nome: "colaborador" },
  ).operacao;
  enfileirarOperacao(operacaoFalhaInconclusiva.id, {
    id: colaborador.id,
    nome: "colaborador",
  });
  const intencaoFalhaInconclusiva = banco
    .prepare(
      "SELECT id FROM bancario_intencoes WHERE operacao_id=? AND operacao_versao=1",
    )
    .get(operacaoFalhaInconclusiva.id);
  banco
    .prepare("UPDATE bancario_intencoes SET estado='falhou' WHERE id=?")
    .run(intencaoFalhaInconclusiva.id);
  banco
    .prepare("UPDATE bancario_operacoes SET estado='falhou' WHERE id=?")
    .run(operacaoFalhaInconclusiva.id);
  banco
    .prepare(
      `INSERT INTO bancario_tentativas
       (id,intencao_id,operacao_id,etapa,correlacao,resultado,concluido_em)
       VALUES(?,?,?,?,?,'resultado_desconhecido',CURRENT_TIMESTAMP)`,
    )
    .run(
      randomUUID(),
      intencaoFalhaInconclusiva.id,
      operacaoFalhaInconclusiva.id,
      "envio",
      randomUUID(),
    );
  assert.throws(
    () =>
      liberarNovaEmissaoAposFalha(operacaoFalhaInconclusiva.id, {
        id: colaborador.id,
        nome: "colaborador",
      }),
    /Faça a conciliação antes de tentar novamente/,
  );

  const operacaoVencidaId = criarCobrancaRegistradaVencida(
    "encargo",
    10_000,
    "2026-10-01",
  );
  const proximaFaturaId = criarFatura("12", 20_000, "2026-12-20");
  const comEncargos = criarOperacaoDeCobranca(
    proximaFaturaId,
    { id: colaborador.id, nome: "colaborador" },
    "2026-11-02",
  );
  assert.equal(comEncargos.criada, true);
  assert.equal(comEncargos.operacao.valor_centavos, 20_455);
  assert.equal(
    comEncargos.operacao.snapshot.cobranca.valor_base_centavos,
    20_000,
  );
  assert.equal(
    comEncargos.operacao.snapshot.cobranca.encargos_atraso_centavos,
    455,
  );
  assert.deepEqual(
    {
      origem:
        comEncargos.operacao.snapshot.encargos_atraso.itens[0]
          .operacao_origem_id,
      dias: comEncargos.operacao.snapshot.encargos_atraso.itens[0].dias_atraso,
      diasJuros:
        comEncargos.operacao.snapshot.encargos_atraso.itens[0].dias_juros,
      multa:
        comEncargos.operacao.snapshot.encargos_atraso.itens[0].multa_centavos,
      juros:
        comEncargos.operacao.snapshot.encargos_atraso.itens[0].juros_centavos,
    },
    {
      origem: operacaoVencidaId,
      dias: 32,
      diasJuros: 31,
      multa: 300,
      juros: 155,
    },
  );
  const repetidaComEncargos = criarOperacaoDeCobranca(
    proximaFaturaId,
    { id: colaborador.id, nome: "colaborador" },
    "2026-11-02",
  );
  assert.equal(repetidaComEncargos.criada, false);
  assert.equal(repetidaComEncargos.operacao.id, comEncargos.operacao.id);
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM bancario_encargos_atraso WHERE operacao_origem_id=? AND estado='aplicado'",
      )
      .get(operacaoVencidaId).n,
    1,
  );

  banco
    .prepare("UPDATE bancario_operacoes SET estado='envio_pendente' WHERE id=?")
    .run(comEncargos.operacao.id);
  banco
    .prepare("UPDATE bancario_operacoes SET estado='rejeitada' WHERE id=?")
    .run(comEncargos.operacao.id);
  const faturaSubstitutaId = criarFatura("01", 30_000, "2027-01-20");
  const substituta = criarOperacaoDeCobranca(
    faturaSubstitutaId,
    { id: colaborador.id, nome: "colaborador" },
    "2026-11-02",
  );
  assert.equal(substituta.operacao.valor_centavos, 30_455);
  assert.deepEqual(
    banco
      .prepare(
        `SELECT estado,COUNT(*) AS n FROM bancario_encargos_atraso
         WHERE operacao_origem_id=? GROUP BY estado ORDER BY estado`,
      )
      .all(operacaoVencidaId)
      .map((item) => ({ ...item })),
    [
      { estado: "aplicado", n: 1 },
      { estado: "liberado", n: 1 },
    ],
  );
  const dividaSemDuplicarEncargo = obterApuracaoDeDividas(
    banco,
    { uc: "123456789" },
    "2026-11-02",
  ).dividas[0];
  assert.equal(dividaSemDuplicarEncargo.principal_centavos, 10_000);
  assert.equal(dividaSemDuplicarEncargo.encargos_centavos, 0);
  assert.equal(
    dividaSemDuplicarEncargo.cobrancas[0].encargos_transferidos_centavos,
    455,
  );

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
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM bancario_intencoes WHERE operacao_id=?",
      )
      .get(cobranca.operacao.id).n,
    1,
  );

  const lista = await chamar("/api/admin/bancario/operacoes", colaborador);
  assert.equal(lista.status, 200);
  assert.equal((await lista.json()).length, 6);

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

  const demonstrativoId = criarFatura("09", 12000, "2026-11-20", {
    entradas: { injecao: "100", desconto: "20", modalidade: "GDII" },
    tarifa_completa: "1.000000",
    equatorial_centavos: 5000,
    ajuste_centavos: 1000,
  });
  const preparoDemo = await chamar(
    "/api/admin/bancario/operacoes/cobrancas",
    colaborador,
    "POST",
    { documento_id: demonstrativoId },
  );
  assert.equal(preparoDemo.status, 201);
  const operacaoDemo = (await preparoDemo.json()).operacao;
  const rotaPdf = `/api/admin/bancario/operacoes/${operacaoDemo.id}/demonstrativo.pdf`;
  const previaPdf = await chamar(rotaPdf, colaborador);
  assert.equal(previaPdf.status, 200);
  assert.match(previaPdf.headers.get("content-type"), /application\/pdf/);
  assert.equal(
    (await PDFDocument.load(await previaPdf.arrayBuffer())).getPageCount(),
    2,
  );
  assert.equal((await chamar(`${rotaPdf}?final=1`, colaborador)).status, 409);
  assert.equal(
    (
      await chamar(
        `/api/admin/bancario/operacoes/${operacaoDemo.id}/enfileirar`,
        colaborador,
        "POST",
      )
    ).status,
    200,
  );
  const bancoPdf = await PDFDocument.create();
  bancoPdf.addPage([595, 842]);
  const bytesBanco = Buffer.from(await bancoPdf.save());
  banco
    .prepare(
      `INSERT INTO bancario_artefatos_cobranca
       (operacao_id,nosso_numero,pdf,pdf_sha256) VALUES(?,?,?,?)`,
    )
    .run(
      operacaoDemo.id,
      "123456",
      bytesBanco,
      createHash("sha256").update(bytesBanco).digest("hex"),
    );
  banco
    .prepare("UPDATE bancario_operacoes SET estado='registrada' WHERE id=?")
    .run(operacaoDemo.id);
  const finalPdf = await chamar(`${rotaPdf}?final=1`, colaborador);
  assert.equal(finalPdf.status, 200);
  assert.equal(
    (await PDFDocument.load(await finalPdf.arrayBuffer())).getPageCount(),
    2,
  );
  assert.equal((await chamar(rotaPdf, null)).status, 401);
  banco
    .prepare(
      "UPDATE bancario_artefatos_cobranca SET pdf_sha256=? WHERE operacao_id=?",
    )
    .run("0".repeat(64), operacaoDemo.id);
  assert.equal((await chamar(`${rotaPdf}?final=1`, colaborador)).status, 409);

  console.log(
    "OK: cobranças não exigem senha; pagamentos exigem Proprietário e a senha financeira gerida pelo Proprietário 1.",
  );
} finally {
  await new Promise((resolver) => servidor.close(resolver));
  banco.close();
}
