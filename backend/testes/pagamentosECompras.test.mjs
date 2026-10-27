import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ECOSOL_DATA_DIR = mkdtempSync(join(tmpdir(), "ecosol-pagamentos-"));
process.env.NODE_ENV = "test";

const { protegerSenha } = await import("../servidor/autenticacao.mjs");
const { obterBanco } = await import("../servidor/bancoDeDados.mjs");
const {
  aprovarSolicitacao,
  baixarPagamentoExterno,
  criarProduto,
  criarSolicitacaoPagamento,
  criarTipoProduto,
  enviarParaAprovacao,
  listarPagamentosECompras,
} = await import("../servidor/financeiro/pagamentos.mjs");
const { salvarCredencialConfirmacao } =
  await import("../servidor/bancario/credencialConfirmacao.mjs");

const banco = obterBanco();
const hash = await protegerSenha("Senha de acesso 2026");
function pessoa(nome, nivel = 2) {
  const id = Number(
    banco
      .prepare(
        "INSERT INTO staff_users(name,email,password_hash,access_level) VALUES(?,?,?,?)",
      )
      .run(nome, `${nome}@teste.local`, hash, nivel).lastInsertRowid,
  );
  return { id, nome };
}

const operador = pessoa("operador");
const proprietarioUm = pessoa("proprietario-1", 3);
const proprietarioDois = pessoa("proprietario-2", 3);
const guardiao = pessoa("guardiao", 3);
for (const proprietario of [proprietarioUm, proprietarioDois])
  banco
    .prepare(
      "INSERT INTO equipe_papeis_criticos(staff_id,papel) VALUES(?,'proprietario')",
    )
    .run(proprietario.id);
banco
  .prepare(
    "INSERT INTO equipe_papeis_criticos(staff_id,papel) VALUES(?,'guardiao_recuperacao')",
  )
  .run(guardiao.id);

const senhaFinanceira = "Confirmacao financeira 2026";
await salvarCredencialConfirmacao(proprietarioUm, null, senhaFinanceira);

const tipo = criarTipoProduto(
  { nome: "Material de escritório", categoria: "interno" },
  proprietarioUm,
);
const produto = criarProduto(
  { tipo_id: tipo.id, nome: "Resma A4", unidade: "resma" },
  proprietarioUm,
);
const compra = criarSolicitacaoPagamento(
  {
    origem: "produtos",
    descricao: "Reposição de papel",
    favorecido: "Papelaria teste",
    forma_pagamento: "dinheiro",
    vencimento: "2026-11-10",
    itens: [
      {
        produto_id: produto.id,
        quantidade: "2.500",
        valor_unitario: "30.00",
      },
    ],
  },
  operador,
);
assert.equal(compra.status, "rascunho");
assert.equal(compra.valor_centavos, 7500);
assert.equal(
  enviarParaAprovacao(compra.id, operador).status,
  "aguardando_aprovacao",
);

await assert.rejects(
  aprovarSolicitacao(compra.id, guardiao, senhaFinanceira),
  /Somente Proprietário 1 ou Proprietário 2/,
);
await assert.rejects(
  aprovarSolicitacao(compra.id, proprietarioUm, "senha incorreta"),
  /Senha de confirmação incorreta/,
);
assert.equal(
  (await aprovarSolicitacao(compra.id, proprietarioDois, senhaFinanceira))
    .status,
  "aprovada",
);
await assert.rejects(
  baixarPagamentoExterno(
    compra.id,
    { senha: senhaFinanceira, pago_em: "2026-10-26" },
    guardiao,
  ),
  /Somente Proprietário 1 ou Proprietário 2/,
);
assert.equal(
  (
    await baixarPagamentoExterno(
      compra.id,
      {
        senha: senhaFinanceira,
        pago_em: "2026-10-26",
        referencia_pagamento: "Recibo interno 1",
      },
      proprietarioUm,
    )
  ).status,
  "paga",
);

const energia = criarSolicitacaoPagamento(
  {
    origem: "energia",
    descricao: "Fatura de energia da usina",
    favorecido: "Distribuidora",
    vencimento: "2026-11-12",
    valor: "123.45",
  },
  operador,
);
assert.equal(energia.valor_centavos, 12345);
assert.equal(listarPagamentosECompras().produtos.length, 1);
assert.equal(
  banco
    .prepare(
      "SELECT COUNT(*) AS total FROM financeiro_auditoria_pagamentos WHERE solicitacao_id=?",
    )
    .get(compra.id).total,
  4,
);

console.log(
  "OK: catálogo e solicitações usam valores exatos; apenas Proprietários 1 e 2 aprovam com senha financeira.",
);
