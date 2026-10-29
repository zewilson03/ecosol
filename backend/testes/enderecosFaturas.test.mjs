import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { extrairEnderecoDaFatura } from "../servidor/faturamento/extracao.mjs";
import { prepararFaturamento } from "../servidor/faturamento/esquema.mjs";
import {
  registrarEnderecoDaFatura,
  vincularEnderecosPendentesDaUc,
} from "../servidor/faturamento/enderecosFaturas.mjs";

const texto = [
  "ENDERECO DE ENTREGA",
  "Rua que não é do titular",
  "CNPJ/CPF: 529.982.247-25",
  "RUA DAS FLORES 15",
  "CENTRO",
  "CEP: 75086-012 ANAPOLIS GO",
].join("\n");
const endereco = extrairEnderecoDaFatura(texto);
assert.deepEqual(endereco, {
  documento_titular: "52998224725",
  logradouro: "RUA DAS FLORES 15",
  bairro: "CENTRO",
  cep: "75086012",
  cidade: "ANAPOLIS",
  uf: "GO",
});
assert.equal(extrairEnderecoDaFatura("ENDERECO DE ENTREGA\nRUA X"), null);

const banco = new DatabaseSync(":memory:");
try {
  banco.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, cpf TEXT);
  `);
  prepararFaturamento(banco);
  let proximoHash = 0;
  const novoDocumento = () =>
    Number(
      banco
        .prepare(
          `INSERT INTO faturamento_documentos(hash,nome,pdf,lote,texto,extracao,dados)
           VALUES(?,?,?,?,?,?,?)`,
        )
        .run(
          `documento-${++proximoHash}`,
          "teste.pdf",
          Buffer.from("%PDF"),
          "teste",
          texto,
          "{}",
          "{}",
        ).lastInsertRowid,
    );
  const observar = (documentoId, observacao = endereco) =>
    registrarEnderecoDaFatura(banco, documentoId, {
      dados: { uc: "123456789012" },
      endereco_fatura: observacao,
    });
  const primeiro = novoDocumento();
  assert.equal(observar(primeiro).situacao, "pendente_cadastro");
  const clienteId = Number(
    banco
      .prepare("INSERT INTO customers(name,cpf) VALUES(?,?)")
      .run("Cliente Teste", endereco.documento_titular).lastInsertRowid,
  );
  banco
    .prepare(
      `INSERT INTO faturamento_unidades(uc,nome,documento,email,dia_vencimento,cliente_id)
       VALUES(?,?,?,?,?,?)`,
    )
    .run(
      "123456789012",
      "UC Teste",
      endereco.documento_titular,
      "",
      10,
      clienteId,
    );
  const unidadeId = banco
    .prepare("SELECT id FROM faturamento_unidades WHERE uc=?")
    .get("123456789012").id;
  banco
    .prepare(
      "INSERT INTO faturamento_unidades_aliases(unidade_id,uc,origem) VALUES(?,?,?)",
    )
    .run(unidadeId, "999999999999", "teste");
  assert.equal(vincularEnderecosPendentesDaUc(banco, "123456789012"), 1);
  assert.equal(
    banco
      .prepare(
        "SELECT situacao,cliente_id FROM faturamento_enderecos_faturas WHERE documento_id=?",
      )
      .get(primeiro).situacao,
    "vinculado",
  );
  const repetido = novoDocumento();
  assert.equal(observar(repetido).situacao, "vinculado");
  assert.equal(observar(repetido).situacao, "vinculado");
  const alterado = novoDocumento();
  assert.equal(
    observar(alterado, { ...endereco, logradouro: "RUA NOVA 20" }).situacao,
    "endereco_divergente",
  );
  const divergente = novoDocumento();
  assert.equal(
    observar(divergente, { ...endereco, documento_titular: "11144477735" })
      .situacao,
    "documento_divergente",
  );
  assert.equal(
    banco
      .prepare(
        "SELECT cliente_id FROM faturamento_enderecos_faturas WHERE documento_id=?",
      )
      .get(divergente).cliente_id,
    null,
  );
  assert.equal(vincularEnderecosPendentesDaUc(banco, "123456789012"), 0);
  const antiga = novoDocumento();
  assert.equal(
    registrarEnderecoDaFatura(banco, antiga, {
      dados: { uc: "999999999999" },
      endereco_fatura: endereco,
    }).situacao,
    "vinculado",
  );
} finally {
  banco.close();
}

console.log("Endereços das faturas: OK");
