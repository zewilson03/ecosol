import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-operacoes-"));
process.env.NODE_ENV = "test";
process.env.SICOOB_AMBIENTE = "homologacao";
process.env.SICOOB_CONTA_REFERENCIA = "conta-teste";
process.env.BANCARIO_MFA_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { resumoCriptografico, protegerSenha } =
  await import("../servidor/autenticacao.mjs");
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { prepararBancario } = await import("../servidor/bancario/esquema.mjs");
const { rotasAdministrativas } =
  await import("../servidor/rotasAdministrativas.mjs");
const { gerarSegredoTotp, cifrarSegredoTotp, codigoTotp } =
  await import("../servidor/bancario/totp.mjs");
const banco = obterBanco();
const senhaDeTeste = "Senha bancaria de teste 2026";
const hashDeTeste = await protegerSenha(senhaDeTeste);
const segredosPorCookie = new Map();
prepararBancario(banco);

function criarPessoa(nome, nivel, papeis = []) {
  const id = Number(
    banco
      .prepare(
        "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,?)",
      )
      .run(nome, `${nome}@teste.local`, hashDeTeste, nivel).lastInsertRowid,
  );
  for (const papel of papeis)
    banco
      .prepare(
        "INSERT INTO bancario_papeis_equipe(staff_id,papel,concedido_por) VALUES(?,?,?)",
      )
      .run(id, papel, 9999);
  const token = randomBytes(32).toString("hex");
  banco
    .prepare(
      "INSERT INTO sessions(staff_id,token_hash,role,expires_at) VALUES(?,?,?,?)",
    )
    .run(id, resumoCriptografico(token), "staff", Date.now() + 60_000);
  const cookie = `ecosol_session=${token}`;
  const segredo = gerarSegredoTotp();
  banco
    .prepare(
      "INSERT INTO bancario_mfa_equipe(staff_id,segredo_cifrado,ativado_em) VALUES(?,?,CURRENT_TIMESTAMP)",
    )
    .run(id, cifrarSegredoTotp(segredo, id));
  segredosPorCookie.set(cookie, segredo);
  return { id, cookie };
}

const preparador = criarPessoa("preparador", 3, [
  "operador_financeiro",
  "aprovador_financeiro",
]);
const aprovador = criarPessoa("aprovador", 3, ["aprovador_financeiro"]);
const auditor = criarPessoa("auditor", 1, ["consulta_auditoria"]);
const administradorIntegracao = criarPessoa("administrador-integracao", 3, [
  "administrador_integracao",
]);
const semPapel = criarPessoa("sem-papel", 3);

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
         VALUES(?,?,?,?,?,?,?,?,?,?,'Aprovada — aguardando emissão','fatura','cobranca',?)`,
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
        7,
      ).lastInsertRowid,
  );
}

const aplicacao = express();
aplicacao.use(express.json(), rotasAdministrativas);
const servidor = aplicacao.listen(0, "127.0.0.1");
await new Promise((resolver) => servidor.once("listening", resolver));
const base = `http://127.0.0.1:${servidor.address().port}`;
process.env.APP_URL = base;
const confirmacoes = new Map();
const confirmacoesPendentes = new Map();

async function chamar(caminho, cookie, metodo = "GET", corpo) {
  if (
    metodo !== "GET" &&
    caminho.startsWith("/api/admin/bancario/") &&
    cookie
  ) {
    if (!confirmacoes.has(cookie)) {
      if (!confirmacoesPendentes.has(cookie))
        confirmacoesPendentes.set(
          cookie,
          (async () => {
            const confirmacao = await fetch(
              base + "/api/admin/bancario/confirmar-identidade",
              {
                method: "POST",
                headers: {
                  Cookie: cookie,
                  Origin: base,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  senha: senhaDeTeste,
                  codigo: codigoTotp(
                    segredosPorCookie.get(cookie),
                    Math.floor(Date.now() / 30_000),
                  ),
                }),
              },
            );
            assert.equal(confirmacao.status, 200);
            confirmacoes.set(cookie, (await confirmacao.json()).prova);
          })(),
        );
      await confirmacoesPendentes.get(cookie);
    }
  }
  return fetch(base + caminho, {
    method: metodo,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(metodo !== "GET" ? { Origin: base } : {}),
      ...(confirmacoes.has(cookie)
        ? { "X-Ecosol-Confirmacao-Bancaria": confirmacoes.get(cookie) }
        : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
}

try {
  const faturaId = criarFatura("10");
  assert.equal(
    (
      await chamar(
        "/api/admin/bancario/operacoes/cobrancas",
        semPapel.cookie,
        "POST",
        { documento_id: faturaId },
      )
    ).status,
    403,
  );

  const criacoes = await Promise.all(
    [1, 2].map(() =>
      chamar(
        "/api/admin/bancario/operacoes/cobrancas",
        preparador.cookie,
        "POST",
        { documento_id: faturaId },
      ),
    ),
  );
  assert.deepEqual(
    criacoes.map((resposta) => resposta.status).sort(),
    [200, 201],
  );
  const resultados = await Promise.all(
    criacoes.map((resposta) => resposta.json()),
  );
  assert.equal(resultados[0].operacao.id, resultados[1].operacao.id);
  const operacaoId = resultados[0].operacao.id;
  assert.equal(resultados[0].operacao.estado, "aguardando_aprovacao");
  assert.equal(resultados[0].operacao.valor_centavos, 12345);
  assert.equal(
    banco.prepare("SELECT COUNT(*) AS n FROM bancario_operacoes").get().n,
    1,
  );

  assert.equal(
    (
      await chamar(
        `/api/admin/bancario/operacoes/${operacaoId}/enfileirar`,
        preparador.cookie,
        "POST",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await chamar(
        `/api/admin/bancario/operacoes/${operacaoId}/aprovar`,
        preparador.cookie,
        "POST",
      )
    ).status,
    409,
  );

  const aprovada = await (
    await chamar(
      `/api/admin/bancario/operacoes/${operacaoId}/aprovar`,
      aprovador.cookie,
      "POST",
    )
  ).json();
  assert.equal(aprovada.alterada, true);
  assert.equal(aprovada.operacao.estado, "aprovada");
  const repetida = await (
    await chamar(
      `/api/admin/bancario/operacoes/${operacaoId}/aprovar`,
      aprovador.cookie,
      "POST",
    )
  ).json();
  assert.equal(repetida.alterada, false);
  assert.equal(
    banco.prepare("SELECT COUNT(*) AS n FROM bancario_aprovacoes").get().n,
    1,
  );

  assert.equal(
    (
      await chamar(
        `/api/admin/bancario/operacoes/${operacaoId}/enfileirar`,
        aprovador.cookie,
        "POST",
      )
    ).status,
    403,
  );
  const fila = await (
    await chamar(
      `/api/admin/bancario/operacoes/${operacaoId}/enfileirar`,
      preparador.cookie,
      "POST",
    )
  ).json();
  assert.equal(fila.criada, true);
  assert.equal(fila.operacao.estado, "envio_pendente");
  assert.equal(fila.operacao.intencao.estado, "pendente");
  const filaRepetida = await (
    await chamar(
      `/api/admin/bancario/operacoes/${operacaoId}/enfileirar`,
      preparador.cookie,
      "POST",
    )
  ).json();
  assert.equal(filaRepetida.criada, false);
  assert.equal(
    banco.prepare("SELECT COUNT(*) AS n FROM bancario_intencoes").get().n,
    1,
  );

  assert.equal(
    (await chamar("/api/admin/bancario/operacoes", semPapel.cookie)).status,
    403,
  );
  assert.equal(
    (
      await chamar(
        "/api/admin/bancario/operacoes",
        administradorIntegracao.cookie,
      )
    ).status,
    403,
  );
  const lista = await (
    await chamar("/api/admin/bancario/operacoes", auditor.cookie)
  ).json();
  assert.equal(lista.length, 1);
  assert.equal("snapshot" in lista[0], false);
  const detalhe = await (
    await chamar(`/api/admin/bancario/operacoes/${operacaoId}`, auditor.cookie)
  ).json();
  assert.equal(detalhe.snapshot.cobranca.valor_centavos, 12345);
  assert.equal(detalhe.snapshot.cliente.documento, "*******4705");

  assert.throws(
    () =>
      banco
        .prepare("UPDATE bancario_operacoes SET estado='liquidada' WHERE id=?")
        .run(operacaoId),
    /Transição bancária inválida/,
  );

  const faturaAlteradaId = criarFatura("11", 54321);
  const nova = await (
    await chamar(
      "/api/admin/bancario/operacoes/cobrancas",
      preparador.cookie,
      "POST",
      { documento_id: faturaAlteradaId },
    )
  ).json();
  await chamar(
    `/api/admin/bancario/operacoes/${nova.operacao.id}/aprovar`,
    aprovador.cookie,
    "POST",
  );
  banco
    .prepare("UPDATE faturamento_documentos SET versao=versao+1 WHERE id=?")
    .run(faturaAlteradaId);
  assert.equal(
    (
      await chamar(
        `/api/admin/bancario/operacoes/${nova.operacao.id}/enfileirar`,
        preparador.cookie,
        "POST",
      )
    ).status,
    409,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT COUNT(*) AS n FROM bancario_intencoes WHERE operacao_id=?",
      )
      .get(nova.operacao.id).n,
    0,
  );

  const faturaPapelRevogadoId = criarFatura("12", 22222);
  const papelRevogado = await (
    await chamar(
      "/api/admin/bancario/operacoes/cobrancas",
      preparador.cookie,
      "POST",
      { documento_id: faturaPapelRevogadoId },
    )
  ).json();
  await chamar(
    `/api/admin/bancario/operacoes/${papelRevogado.operacao.id}/aprovar`,
    aprovador.cookie,
    "POST",
  );
  banco
    .prepare(
      "DELETE FROM bancario_papeis_equipe WHERE staff_id=? AND papel='aprovador_financeiro'",
    )
    .run(aprovador.id);
  assert.equal(
    (
      await chamar(
        `/api/admin/bancario/operacoes/${papelRevogado.operacao.id}/enfileirar`,
        preparador.cookie,
        "POST",
      )
    ).status,
    409,
  );

  const faturaCadastroPendenteId = criarFatura("01", 11111);
  banco
    .prepare(
      "UPDATE faturamento_unidades SET pendencia_cadastro='Documento sintético' WHERE id=?",
    )
    .run(unidadeId);
  assert.equal(
    (
      await chamar(
        "/api/admin/bancario/operacoes/cobrancas",
        preparador.cookie,
        "POST",
        { documento_id: faturaCadastroPendenteId },
      )
    ).status,
    409,
  );
  assert.equal(
    banco
      .prepare("SELECT COUNT(*) AS n FROM bancario_auditoria_operacoes")
      .get().n,
    7,
  );
  banco
    .prepare(
      "UPDATE faturamento_unidades SET pendencia_cadastro=NULL WHERE id=?",
    )
    .run(unidadeId);
  banco
    .prepare(
      "INSERT INTO equipe_papeis_criticos(staff_id,papel) VALUES(?,'proprietario')",
    )
    .run(semPapel.id);
  banco
    .prepare(
      "INSERT INTO equipe_papeis_criticos(staff_id,papel) VALUES(?,'proprietario')",
    )
    .run(administradorIntegracao.id);
  assert.throws(
    () =>
      banco
        .prepare(
          "INSERT INTO equipe_papeis_criticos(staff_id,papel) VALUES(?,'proprietario')",
        )
        .run(preparador.id),
    /Limite de contas/,
  );
  assert.throws(
    () =>
      banco
        .prepare("UPDATE staff_users SET access_level=2 WHERE id=?")
        .run(semPapel.id),
    /Remova o papel crítico/,
  );
  const faturaProprietarioId = criarFatura("proprietario", 33333);
  const propria = await (
    await chamar(
      "/api/admin/bancario/operacoes/cobrancas",
      semPapel.cookie,
      "POST",
      { documento_id: faturaProprietarioId },
    )
  ).json();
  assert.equal(
    (
      await chamar(
        `/api/admin/bancario/operacoes/${propria.operacao.id}/aprovar`,
        semPapel.cookie,
        "POST",
      )
    ).status,
    400,
  );
  const autoaprovada = await (
    await chamar(
      `/api/admin/bancario/operacoes/${propria.operacao.id}/aprovar`,
      semPapel.cookie,
      "POST",
      { confirmacao_autoaprovacao: true },
    )
  ).json();
  assert.equal(autoaprovada.operacao.estado, "aprovada");
  assert.equal(autoaprovada.operacao.autoaprovada, 1);
  assert.equal(autoaprovada.operacao.aprovador_id, semPapel.id);
  assert.equal(
    banco
      .prepare("SELECT COUNT(*) AS n FROM bancario_autoaprovacoes_proprietario")
      .get().n,
    1,
  );
  banco
    .prepare("DELETE FROM equipe_papeis_criticos WHERE staff_id=?")
    .run(semPapel.id);
  assert.equal(
    (
      await chamar(
        `/api/admin/bancario/operacoes/${propria.operacao.id}/enfileirar`,
        preparador.cookie,
        "POST",
      )
    ).status,
    409,
  );
  banco
    .prepare(
      "INSERT INTO equipe_papeis_criticos(staff_id,papel) VALUES(?,'proprietario')",
    )
    .run(semPapel.id);
  assert.equal(
    (
      await chamar(
        `/api/admin/bancario/operacoes/${propria.operacao.id}/enfileirar`,
        semPapel.cookie,
        "POST",
      )
    ).status,
    200,
  );
  const guardiao = criarPessoa("guardiao-recuperacao", 1);
  banco
    .prepare(
      "INSERT INTO equipe_papeis_criticos(staff_id,papel) VALUES(?,'guardiao_recuperacao')",
    )
    .run(guardiao.id);
  assert.equal(
    (await chamar("/api/admin/usinas", guardiao.cookie)).status,
    403,
  );
  assert.equal(
    (await chamar("/api/admin/bancario/operacoes", guardiao.cookie)).status,
    403,
  );
  assert.throws(
    () =>
      banco
        .prepare(
          "INSERT INTO equipe_papeis_criticos(staff_id,papel) VALUES(?,'guardiao_recuperacao')",
        )
        .run(preparador.id),
    /Limite de contas/,
  );
  console.log(
    "OK: snapshot, aprovação segregada, autoaprovação restrita ao Proprietário, fila e bloqueio por versão.",
  );
} finally {
  await new Promise((resolver) => servidor.close(resolver));
  banco.close();
}
