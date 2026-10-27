import assert from "node:assert/strict";
import { criarRepositorioLeituraFaturamento } from "../servidor/faturamento/repositorioLeitura.mjs";

const consultas = [];
const banco = {
  prepare(sql) {
    consultas.push(sql);
    return {
      all() {
        if (sql.includes("FROM faturamento_unidades u LEFT JOIN"))
          return [
            {
              id: 7,
              uc: "700",
              nome: "UC teste",
              usina_id: 3,
              usina_nome: "Solar Norte",
              saida_carteira: '{"inicio":"2026-10","destino_externo":"X"}',
            },
          ];
        if (sql.includes("faturamento_unidades_aliases"))
          return [{ unidade_id: 7, uc: "699" }];
        if (sql.includes("faturamento_vinculos_usina")) return [];
        if (sql.includes("faturamento_descontos_uc"))
          return [{ id: 2, unidade_id: 7, inicio: "2026-10", desconto: "20" }];
        if (sql.includes("faturamento_contratos"))
          return [
            {
              id: 4,
              unidade_id: 7,
              inicio: "2026-10",
              modalidade: "GDII",
              desconto: "20",
            },
          ];
        if (sql.includes("usinas_modalidades"))
          return [{ usina_id: 3, inicio: "2026-01", modalidade: "GDII" }];
        if (sql.includes("FROM faturamento_documentos"))
          return [
            {
              id: 3,
              dados: '{"uc_geradora":"123"}',
              extracao: '{"dados":{},"avisos":[],"evidencias":{}}',
              memoria: null,
            },
            {
              id: 2,
              dados: "{}",
              extracao: '{"dados":{},"avisos":[],"evidencias":{}}',
              memoria: null,
            },
            {
              id: 1,
              dados: "{}",
              extracao: '{"dados":{},"avisos":[],"evidencias":{}}',
              memoria: null,
            },
          ];
        if (sql.includes("usinas_identificadores_geracao"))
          return [{ numero: "123", id: 8, nome: "Solar Sul" }];
        assert.fail(`Consulta inesperada: ${sql}`);
      },
    };
  },
};

const unidades =
  criarRepositorioLeituraFaturamento(banco).listarUnidadesDetalhadas();
assert.equal(consultas.length, 6);
assert.deepEqual(unidades[0].ucs_antigas, ["699"]);
assert.deepEqual(unidades[0].modalidades_usina, [
  { inicio: "2026-01", modalidade: "GDII" },
]);
assert.equal(unidades[0].vinculos_usina[0].inicio, "0000-01");
assert.equal("unidade_id" in unidades[0].vinculos_usina[0], false);
assert.deepEqual(unidades[0].descontos, [
  { id: 2, inicio: "2026-10", desconto: "20" },
]);
assert.deepEqual(unidades[0].saida_carteira, {
  inicio: "2026-10",
  destino_externo: "X",
});

const pagina = criarRepositorioLeituraFaturamento(banco).listarDocumentosResumo(
  { limite: 2 },
);
assert.equal(consultas.length, 8);
assert.equal(pagina.itens.length, 2);
assert.equal(pagina.proximoCursor, 2);
assert.deepEqual(pagina.itens[0].usina_geradora, {
  numero: "123",
  situacao: "identificada",
  usina: { id: 8, nome: "Solar Sul" },
  candidatas: [{ id: 8, nome: "Solar Sul" }],
});

console.log(
  "OK: leitura de UCs usa seis consultas fixas e preserva o contrato.",
);
