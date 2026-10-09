import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-transfer-"));
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const { rotasFaturamento } = await import("../servidor/faturamento/rotas.mjs");
const { usinaDaUnidadeNaCompetencia, modalidadeVigenteDaUsina } =
  await import("../servidor/faturamento/vinculosUsinas.mjs");
const banco = obterBanco();
const cookies = {};
for (const nivel of [2, 3]) {
  const staffId = Number(
    banco
      .prepare(
        "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,?)",
      )
      .run(
        `Teste nível ${nivel}`,
        `transf${nivel}@example.test`,
        "teste",
        nivel,
      ).lastInsertRowid,
  );
  const token = randomBytes(32).toString("hex");
  banco
    .prepare(
      "INSERT INTO sessions(staff_id,token_hash,role,expires_at) VALUES(?,?,?,?)",
    )
    .run(
      staffId,
      createHash("sha256").update(token).digest("hex"),
      "staff",
      Date.now() + 3600000,
    );
  cookies[nivel] = `ecosol_session=${token}`;
}
const usina = (nome, modalidade) => {
  const id = Number(
    banco
      .prepare("INSERT INTO usinas(nome,localizacao) VALUES(?,?)")
      .run(nome, "A confirmar").lastInsertRowid,
  );
  banco
    .prepare(
      "INSERT INTO usinas_modalidades(usina_id,inicio,modalidade) VALUES(?,?,?)",
    )
    .run(id, "2020-01", modalidade);
  return id;
};
const origem = usina("Origem Solar", "GDI");
const destino = usina("Destino Solar", "GDII");
const provisoria = usina("ecosol", "GDI");
const unidade = (uc, usinaId = origem) =>
  Number(
    banco
      .prepare(
        "INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento,usina_id) VALUES(?,?,?,?,?,?)",
      )
      .run(uc, `Cliente ${uc}`, "", "", 0, usinaId).lastInsertRowid,
  );
const uc1 = unidade("900001001");
const uc2 = unidade("900001002");
const dataAtual = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
}).formatToParts(new Date());
const mes = `${dataAtual.find((p) => p.type === "year").value}-${dataAtual.find((p) => p.type === "month").value}`;
const proximo = (() => {
  const [ano, numero] = mes.split("-").map(Number);
  return numero === 12
    ? `${ano + 1}-01`
    : `${ano}-${String(numero + 1).padStart(2, "0")}`;
})();
const memoriaAprovada = JSON.stringify({ contrato: { modalidade: "GDI" } });
banco
  .prepare(
    "INSERT INTO faturamento_documentos(hash,nome,pdf,lote,texto,extracao,dados,memoria,unidade_id,competencia,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  )
  .run(
    "hash-transferencia-aprovada",
    "aprovada.pdf",
    Buffer.from("%PDF-1.4"),
    "teste",
    "",
    "{}",
    "{}",
    memoriaAprovada,
    uc1,
    mes,
    "Aprovada — aguardando emissão",
  );

const app = express();
app.use(express.json({ limit: "20kb" }), rotasFaturamento);
const servidor = app.listen(0, "127.0.0.1");
await new Promise((resolve) => servidor.once("listening", resolve));
const base = `http://127.0.0.1:${servidor.address().port}/api/admin/faturamento`;
async function chamar(caminho, dados, nivel = 3) {
  const resposta = await fetch(base + caminho, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(nivel ? { Cookie: cookies[nivel] } : {}),
    },
    body: JSON.stringify(dados),
  });
  return { status: resposta.status, dados: await resposta.json() };
}
const rota = "/usinas/transferencias";
try {
  const selecao = {
    origem_id: origem,
    destino_id: destino,
    unidades: [
      { id: uc1, versao: 1 },
      { id: uc2, versao: 1 },
    ],
  };
  assert.equal((await chamar(`${rota}/previa`, selecao, 0)).status, 401);
  assert.equal((await chamar(`${rota}/previa`, selecao, 2)).status, 403);
  assert.equal(
    (await chamar(`${rota}/previa`, { ...selecao, destino_id: provisoria }))
      .status,
    409,
  );
  assert.equal(
    (
      await chamar(`${rota}/previa`, {
        ...selecao,
        unidades: [selecao.unidades[0], selecao.unidades[0]],
      })
    ).status,
    400,
  );
  const previa = await chamar(`${rota}/previa`, selecao);
  assert.equal(previa.status, 200, JSON.stringify(previa.dados));
  assert.equal(previa.dados.linhas.find((l) => l.id === uc1).inicio, proximo);
  assert.equal(previa.dados.linhas.find((l) => l.id === uc2).inicio, mes);
  const chave = randomUUID();
  const confirmacao = {
    chave,
    origem_id: origem,
    destino_id: destino,
    destino_versao: previa.dados.destino.versao,
    linhas: previa.dados.linhas,
    confirmado: true,
  };
  const transferida = await chamar(`${rota}/confirmar`, confirmacao);
  assert.equal(transferida.status, 200, JSON.stringify(transferida.dados));
  assert.equal(transferida.dados.quantidade, 2);
  const repetida = await chamar(`${rota}/confirmar`, confirmacao);
  assert.equal(repetida.status, 200);
  assert.equal(repetida.dados.ja_concluida, true);
  assert.equal(
    (await chamar(`${rota}/confirmar`, { ...confirmacao, destino_id: origem }))
      .status,
    409,
  );
  assert.equal(
    banco
      .prepare("SELECT usina_id FROM faturamento_unidades WHERE id=?")
      .get(uc1).usina_id,
    destino,
  );
  assert.equal(usinaDaUnidadeNaCompetencia(banco, uc1, mes), origem);
  assert.equal(usinaDaUnidadeNaCompetencia(banco, uc1, proximo), destino);
  assert.equal(
    modalidadeVigenteDaUsina(
      banco,
      usinaDaUnidadeNaCompetencia(banco, uc1, mes),
      mes,
    ).modalidade,
    "GDI",
  );
  assert.equal(
    modalidadeVigenteDaUsina(
      banco,
      usinaDaUnidadeNaCompetencia(banco, uc1, proximo),
      proximo,
    ).modalidade,
    "GDII",
  );
  assert.equal(
    banco
      .prepare("SELECT memoria FROM faturamento_documentos WHERE unidade_id=?")
      .get(uc1).memoria,
    memoriaAprovada,
  );
  assert.equal(
    banco
      .prepare("SELECT count(*) AS n FROM faturamento_historico WHERE acao=?")
      .get("Transferência de UC entre usinas").n,
    2,
  );
  const respostaUnidades = await fetch(base + "/unidades", {
    headers: { Cookie: cookies[3] },
  });
  assert.equal(respostaUnidades.status, 200);
  const unidadesListadas = await respostaUnidades.json();
  const historicoListagem = unidadesListadas.find(
    (u) => u.id === uc1,
  ).vinculos_usina;
  assert.deepEqual(
    historicoListagem.map((v) => [v.inicio, v.usina_id]),
    [
      [proximo, destino],
      ["0000-01", origem],
    ],
  );
  assert.equal(
    (
      await chamar(`${rota}/previa`, {
        origem_id: destino,
        destino_id: origem,
        unidades: [{ id: uc1, versao: 2 }],
      })
    ).status,
    409,
  );

  const uc3 = unidade("900001003");
  const uc4 = unidade("900001004");
  const previaConcorrente = await chamar(`${rota}/previa`, {
    origem_id: origem,
    destino_id: destino,
    unidades: [
      { id: uc3, versao: 1 },
      { id: uc4, versao: 1 },
    ],
  });
  assert.equal(previaConcorrente.status, 200);
  banco
    .prepare("UPDATE faturamento_unidades SET versao=versao+1 WHERE id=?")
    .run(uc4);
  const falhaConcorrente = await chamar(`${rota}/confirmar`, {
    chave: randomUUID(),
    origem_id: origem,
    destino_id: destino,
    destino_versao: previaConcorrente.dados.destino.versao,
    linhas: previaConcorrente.dados.linhas,
    confirmado: true,
  });
  assert.equal(falhaConcorrente.status, 409);
  assert.equal(
    banco
      .prepare("SELECT usina_id FROM faturamento_unidades WHERE id=?")
      .get(uc3).usina_id,
    origem,
  );
  assert.equal(
    banco
      .prepare(
        "SELECT count(*) AS n FROM faturamento_vinculos_usina WHERE unidade_id=?",
      )
      .get(uc3).n,
    0,
  );

  const ucPendente = unidade("900001005", provisoria);
  const previaPendente = await chamar(`${rota}/previa`, {
    origem_id: provisoria,
    destino_id: destino,
    unidades: [{ id: ucPendente, versao: 1 }],
  });
  assert.equal(previaPendente.status, 200);
  const respostaPendente = await chamar(`${rota}/confirmar`, {
    chave: randomUUID(),
    origem_id: provisoria,
    destino_id: destino,
    destino_versao: previaPendente.dados.destino.versao,
    linhas: previaPendente.dados.linhas,
    confirmado: true,
  });
  assert.equal(respostaPendente.status, 200);
  assert.equal(usinaDaUnidadeNaCompetencia(banco, ucPendente, mes), destino);
  const modalidadeOrigemRetroativa = await chamar(
    `/usinas/${origem}/modalidades`,
    { modalidade: "GDII", inicio: mes, versao: 1 },
  );
  assert.equal(modalidadeOrigemRetroativa.status, 409);
  const modalidadeDestinoSemFaturaAprovada = await chamar(
    `/usinas/${destino}/modalidades`,
    { modalidade: "GDI", inicio: mes, versao: 1 },
  );
  assert.equal(
    modalidadeDestinoSemFaturaAprovada.status,
    201,
    JSON.stringify(modalidadeDestinoSemFaturaAprovada.dados),
  );
  assert.equal(
    banco.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  console.log(
    "OK: transferência em lote, vigência, histórico, autorização, repetição e concorrência.",
  );
} finally {
  servidor.close();
  banco.close();
}
