import assert from "node:assert/strict";
import {
  pendenciasParaCalculo,
  situacaoParaEmissao,
} from "../src/admin/prontidaoFatura.ts";

const unidade = {
  id: 1,
  uc: "290318801200",
  cliente_id: 2,
  descontos: [{ inicio: "2026-09", desconto: "15" }],
};
const dados = {
  uc: unidade.uc,
  unidade_id: "1",
  cliente_id: "2",
  competencia: "2026-09",
  injecao: "100",
  modalidade: "GDI",
  origem_tarifa: "propria",
  total_equatorial: "137,03",
  ajuste_gdii: "0",
  vencimento_equatorial: "2026-10-14",
  vencimento_ecosol: "",
  unitario: "1,14",
  bandeira: "0",
};
const pendente = {
  id: 1,
  lote: "lote-1",
  status: "Pendente de revisão",
  dados,
};
assert.deepEqual(pendenciasParaCalculo(pendente, [unidade], [pendente]), []);
assert.equal(
  situacaoParaEmissao(pendente, [unidade], [pendente]).cor,
  "aguardando",
);

const incompleta = {
  ...pendente,
  dados: { ...dados, cliente_id: "", modalidade: "" },
};
assert.deepEqual(
  situacaoParaEmissao(incompleta, [unidade], [incompleta]).pendencias,
  ["cliente e UC", "modalidade"],
);
assert.equal(
  situacaoParaEmissao(incompleta, [unidade], [incompleta]).cor,
  "incompleta",
);

const semInjecao = {
  ...pendente,
  dados: {
    ...dados,
    injecao: "0",
    origem_tarifa: "",
    ajuste_gdii: "",
    unitario: "",
    bandeira: "",
  },
};
assert.deepEqual(
  pendenciasParaCalculo(semInjecao, [unidade], [semInjecao]),
  [],
);
assert.equal(
  situacaoParaEmissao(semInjecao, [unidade], [semInjecao]).texto,
  "Pronta para avaliação",
);

const semDesconto = { ...unidade, descontos: [] };
assert.deepEqual(pendenciasParaCalculo(pendente, [semDesconto], [pendente]), [
  "desconto vigente da UC",
]);

const referencia = {
  ...pendente,
  id: 2,
  status: "Aprovada — aguardando emissão",
};
const porReferencia = {
  ...pendente,
  dados: {
    ...dados,
    origem_tarifa: "referencia",
    referencia_id: "2",
    unitario: "",
    bandeira: "",
  },
};
assert.deepEqual(
  pendenciasParaCalculo(porReferencia, [unidade], [porReferencia, referencia]),
  [],
);
assert.deepEqual(
  pendenciasParaCalculo(porReferencia, [unidade], [porReferencia]),
  ["GDI de referência aprovada do mesmo lote"],
);

const calculada = { ...incompleta, status: "Calculada" };
const aprovada = { ...incompleta, status: "Aprovada — aguardando emissão" };
assert.equal(
  situacaoParaEmissao(calculada, [], []).texto,
  "Aguardando aprovação",
);
assert.equal(situacaoParaEmissao(aprovada, [], []).texto, "Aguardando emissão");
const provisoria = {
  ...unidade,
  cliente_id: null,
  cliente_provisorio_id: 5,
};
const dadosProvisorios = { ...dados, cliente_id: "" };
const faturaProvisoria = { ...pendente, dados: dadosProvisorios };
assert.deepEqual(
  pendenciasParaCalculo(faturaProvisoria, [provisoria], [faturaProvisoria]),
  ["cadastro definitivo do cliente"],
);
assert.equal(
  situacaoParaEmissao(faturaProvisoria, [provisoria], [faturaProvisoria]).cor,
  "incompleta",
);
console.log("Prontidão visual de faturas: testes concluídos.");
