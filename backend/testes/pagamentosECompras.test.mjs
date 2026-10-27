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
  cadastrarFaturaParaPagamento,
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

const documentoPagamento = Number(
  banco
    .prepare(
      `INSERT INTO faturamento_documentos
        (hash,nome,lote,pdf,texto,extracao,dados,status,classificacao,finalidade,versao)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "fatura-pagamento-teste",
      "fatura-usina.pdf",
      "outubro-2026",
      Buffer.from("pdf"),
      "fatura",
      JSON.stringify({
        finalidade: { motivo: "grandezas_contratadas_com_demanda" },
      }),
      JSON.stringify({
        uc: "123456789012",
        competencia: "2026-10",
        vencimento_equatorial: "2026-11-20",
        total_equatorial: "17512.57",
      }),
      "Recebida",
      "fatura",
      "pagamento",
      3,
    ).lastInsertRowid,
);
const cadastrada = cadastrarFaturaParaPagamento(documentoPagamento, operador);
assert.equal(cadastrada.status, "rascunho");
assert.equal(cadastrada.valor_centavos, 1751257);
assert.equal(cadastrada.vencimento, "2026-11-20");
assert.equal(
  banco
    .prepare(
      "SELECT descricao FROM financeiro_solicitacoes_pagamento WHERE id=?",
    )
    .get(cadastrada.id).descricao,
  "Fatura Equatorial — UC 123456789012 — competência 2026-10",
);
const repetida = cadastrarFaturaParaPagamento(documentoPagamento, operador);
assert.equal(repetida.existente, true);
assert.equal(repetida.id, cadastrada.id);
assert.equal(
  banco
    .prepare(
      "SELECT COUNT(*) AS total FROM financeiro_solicitacoes_pagamento WHERE faturamento_documento_id=?",
    )
    .get(documentoPagamento).total,
  1,
);
function corrigirFaturaPagamento(total, vencimento) {
  const atual = banco
    .prepare("SELECT dados FROM faturamento_documentos WHERE id=?")
    .get(documentoPagamento);
  const dados = JSON.parse(atual.dados);
  banco
    .prepare(
      "UPDATE faturamento_documentos SET dados=?,versao=versao+1 WHERE id=?",
    )
    .run(
      JSON.stringify({
        ...dados,
        total_equatorial: total,
        vencimento_equatorial: vencimento,
      }),
      documentoPagamento,
    );
}
corrigirFaturaPagamento("17400.00", "2026-11-21");
assert.throws(
  () => enviarParaAprovacao(cadastrada.id, operador),
  /A fatura mudou após o cadastro/,
);
const atualizada = cadastrarFaturaParaPagamento(documentoPagamento, operador);
assert.equal(atualizada.atualizada, true);
assert.equal(atualizada.valor_centavos, 1740000);
assert.equal(atualizada.vencimento, "2026-11-21");
assert.equal(
  enviarParaAprovacao(cadastrada.id, operador).status,
  "aguardando_aprovacao",
);
corrigirFaturaPagamento("17300.00", "2026-11-22");
await assert.rejects(
  aprovarSolicitacao(cadastrada.id, proprietarioUm, senhaFinanceira),
  /A fatura mudou após o cadastro/,
);
const revalidada = cadastrarFaturaParaPagamento(documentoPagamento, operador);
assert.equal(revalidada.status, "rascunho");
assert.equal(revalidada.valor_centavos, 1730000);
assert.equal(
  enviarParaAprovacao(cadastrada.id, operador).status,
  "aguardando_aprovacao",
);
assert.equal(
  (await aprovarSolicitacao(cadastrada.id, proprietarioUm, senhaFinanceira))
    .status,
  "aprovada",
);
corrigirFaturaPagamento("17200.00", "2026-11-23");
await assert.rejects(
  baixarPagamentoExterno(
    cadastrada.id,
    { senha: senhaFinanceira, pago_em: "2026-11-23" },
    proprietarioUm,
  ),
  /A fatura mudou após o cadastro/,
);
assert.equal(
  cadastrarFaturaParaPagamento(documentoPagamento, operador).status,
  "rascunho",
);
const documentoCobranca = Number(
  banco
    .prepare(
      `INSERT INTO faturamento_documentos
        (hash,nome,lote,pdf,texto,extracao,dados,status,classificacao,finalidade,versao)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "fatura-cobranca-e-pagamento-teste",
      "fatura-cliente.pdf",
      "outubro-2026",
      Buffer.from("pdf"),
      "fatura",
      JSON.stringify({}),
      JSON.stringify({
        uc: "999999999999",
        competencia: "2026-10",
        vencimento_equatorial: "2026-11-25",
        total_equatorial: "302.40",
      }),
      "Aprovada — aguardando emissão",
      "fatura",
      "cobranca",
      4,
    ).lastInsertRowid,
);
const obrigacaoDaCobranca = cadastrarFaturaParaPagamento(
  documentoCobranca,
  operador,
);
assert.equal(obrigacaoDaCobranca.valor_centavos, 30240);
assert.equal(obrigacaoDaCobranca.vencimento, "2026-11-25");
const documentoDuplicado = Number(
  banco
    .prepare(
      `INSERT INTO faturamento_documentos
        (hash,nome,lote,pdf,texto,extracao,dados,status,classificacao,finalidade,versao)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "fatura-mesma-uc-competencia-outro-pdf",
      "segunda-via.pdf",
      "outubro-2026",
      Buffer.from("outro-pdf"),
      "segunda via",
      JSON.stringify({}),
      JSON.stringify({
        uc: "999999999999",
        competencia: "2026-10",
        vencimento_equatorial: "2026-11-25",
        total_equatorial: "302.40",
      }),
      "Aprovada — aguardando emissão",
      "fatura",
      "cobranca",
      1,
    ).lastInsertRowid,
);
assert.throws(
  () => cadastrarFaturaParaPagamento(documentoDuplicado, operador),
  /UNIQUE constraint failed/,
);
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
