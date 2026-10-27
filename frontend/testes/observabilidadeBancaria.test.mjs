import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  duracaoNoEstado,
  formatarValorBancario,
  ordenarPendencias,
  podeConciliarPendencia,
} from "../src/admin/observabilidadeBancariaApresentacao.ts";

const pendencias = ordenarPendencias([
  {
    operacao_id: "media-antiga",
    prioridade: "media",
    idade_estado_segundos: 9_000,
  },
  {
    operacao_id: "alta-recente",
    prioridade: "alta",
    idade_estado_segundos: 30,
  },
  {
    operacao_id: "alta-antiga",
    prioridade: "alta",
    idade_estado_segundos: 500,
  },
  {
    operacao_id: "informativa",
    prioridade: "informativa",
    idade_estado_segundos: null,
  },
]);
assert.deepEqual(
  pendencias.map((item) => item.operacao_id),
  ["alta-antiga", "alta-recente", "media-antiga", "informativa"],
);

assert.match(formatarValorBancario(12_345, "BRL"), /R\$\s*123,45 · BRL/);
assert.equal(formatarValorBancario(12_345, "USD"), "Moeda não suportada (USD)");
assert.equal(formatarValorBancario(12_345, "valor-inválido"), "Moeda inválida");
assert.equal(formatarValorBancario(1.5, "BRL"), "Valor inválido (BRL)");
assert.equal(duracaoNoEstado(null), "Tempo indisponível");
assert.equal(duracaoNoEstado(90), "1min neste estado");
assert.equal(duracaoNoEstado(7_200), "2h neste estado");
assert.equal(
  podeConciliarPendencia({
    acao_necessaria: "CONCILIAR_COBRANCA",
    provedor_identificado: true,
  }),
  true,
);
assert.equal(
  podeConciliarPendencia({
    acao_necessaria: "CONCILIAR_COBRANCA",
    provedor_identificado: false,
  }),
  false,
);
assert.equal(
  podeConciliarPendencia({
    acao_necessaria: "REVISAR_FALHA",
    provedor_identificado: true,
  }),
  false,
);

const componente = readFileSync(
  new URL("../src/admin/ObservabilidadeBancaria.tsx", import.meta.url),
  "utf8",
);
assert.match(componente, /\/api\/admin\/bancario\/observabilidade\?limite=50/);
assert.match(componente, /method:\s*["']POST["']/);
assert.match(componente, /consultarServidorBancario/);
assert.match(componente, /não cria uma nova\s+cobrança/);
assert.match(componente, /CONFIRMAÇÃO DE CONSULTA/);
assert.match(componente, /Histórico de conciliações/);
assert.match(componente, /CONCILIACAO_LIMITE_ATINGIDO/);
assert.match(componente, /evento\.key !== "Tab"/);
assert.match(componente, /focoAnterior\?\.focus/);
assert.match(componente, /Nenhuma pendência bancária foi encontrada/);
assert.match(componente, /priorizadas por\s+urgência/);

console.log(
  "Observabilidade visual: prioridade, moeda e conciliação manual validadas.",
);
