import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { criarRepositorioLeituraFaturamento } from "../servidor/faturamento/repositorioLeitura.mjs";
import { criarRotasLeituraFaturamento } from "../servidor/faturamento/rotasLeitura.mjs";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-leitura-"));
const { obterBanco, fecharBanco } =
  await import("../servidor/bancoDeDados.mjs");
const { exigirNivel } = await import("../servidor/permissoesDaEquipe.mjs");
const { iniciarSessao } = await import("../servidor/autenticacao.mjs");
const banco = obterBanco();
const repositorio = criarRepositorioLeituraFaturamento(banco);
const admin = banco
  .prepare(
    "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES('Teste','teste@example.test','fixture',1)",
  )
  .run().lastInsertRowid;
let cookie;
iniciarSessao(
  {
    setHeader: (_nome, valor) => {
      cookie = valor.split(";")[0];
    },
  },
  "staff",
  admin,
);
const inserir = banco.prepare(`INSERT INTO faturamento_documentos
  (id,hash,nome,pdf,lote,texto,extracao,dados,classificacao,finalidade,excluido_em)
  VALUES(?,?,?,X'00','teste','texto privado','{}','{}',?,?,?)`);
for (const id of [1, 2, 3, 4, 5])
  inserir.run(id, `hash-${id}`, `${id}.pdf`, "fatura", "cobranca", null);
inserir.run(6, "hash-6", "pagamento.pdf", "fatura", "pagamento", null);
inserir.run(7, "hash-7", "triagem.pdf", "triagem", "cobranca", null);
inserir.run(8, "hash-8", "excluido.pdf", "fatura", "cobranca", "2026-10-26");

let leituras = 0;
const app = express();
app.use(
  "/leitura",
  exigirNivel(1),
  criarRotasLeituraFaturamento({
    obterRepositorio: () => {
      leituras++;
      return repositorio;
    },
  }),
);
app.use((erro, _req, res, _next) =>
  res.status(erro.status ?? 500).json({ erro: erro.message }),
);
const servidor = app.listen(0, "127.0.0.1");
await new Promise((resolve) => servidor.once("listening", resolve));
const base = `http://127.0.0.1:${servidor.address().port}/leitura`;
const chamar = (path) => fetch(base + path, { headers: { Cookie: cookie } });
try {
  assert.equal((await fetch(base + "/documentos")).status, 401);
  assert.equal(leituras, 0, "Autorização deve preceder a persistência");
  const legada = await (await chamar("/documentos")).json();
  assert.deepEqual(
    legada.map((d) => d.id),
    [5, 4, 3, 2, 1],
  );
  assert.ok(legada.every((d) => !("pdf" in d) && !("texto" in d)));
  const primeira = await (await chamar("/documentos?limite=2")).json();
  assert.deepEqual(primeira.itens, legada.slice(0, 2));
  assert.equal(primeira.proximo_cursor, 4);
  // Inserção concorrente não desloca o cursor nem duplica itens já lidos.
  inserir.run(9, "hash-9", "novo.pdf", "fatura", "cobranca", null);
  const segunda = await (await chamar("/documentos?limite=2&cursor=4")).json();
  const terceira = await (await chamar("/documentos?limite=2&cursor=2")).json();
  assert.deepEqual(
    [...primeira.itens, ...segunda.itens, ...terceira.itens].map((d) => d.id),
    [5, 4, 3, 2, 1],
  );
  assert.equal(terceira.proximo_cursor, null);
  assert.deepEqual(
    await (await chamar("/documentos?limite=2&cursor=1")).json(),
    { itens: [], proximo_cursor: null },
  );
  for (const query of [
    "limite=0",
    "limite=-1",
    "limite=abc",
    "limite=1.5",
    "limite=2&cursor=0",
  ]) {
    const antes = leituras;
    assert.equal((await chamar("/documentos?" + query)).status, 400);
    assert.equal(leituras, antes, "Entrada inválida não deve consultar dados");
  }
  assert.deepEqual(await (await chamar("/unidades")).json(), []);
} finally {
  await new Promise((resolve) => servidor.close(resolve));
  fecharBanco();
}
console.log(
  "OK: leitura HTTP/SQLite preserva autorização, contrato, filtros e cursor diante de novas inserções.",
);
