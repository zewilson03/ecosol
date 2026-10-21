import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";
import { calcularCobranca } from "../servidor/faturamento/regras.mjs";
import { normalizarDadosFinanceiros } from "../servidor/faturamento/normalizacaoFinanceira.mjs";
import {
  referencias,
  referenciasArredondamento,
  referenciasClassico,
  pendenciasComplementares,
  fonteCentral,
  sha256Central,
  origem,
  pendenciasOperacionais,
  referenciasPlanilhasAtuais,
  pendenciasPlanilhasAtuais,
} from "./referenciasCentral.mjs";

// Adaptador EXCLUSIVO DE TESTE: replica o contrato de células da Central.
// Não é importado pelo servidor nem substitui a fórmula operacional.
const D = Decimal.clone({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });
function referenciaDecimal(caso) {
  const c = (letra) => new D(caso.celulas[letra] ?? "0");
  let total;
  if (caso.modelo === "classico") {
    const tarifa = c("H").plus(c("I"));
    total = c("E")
      .times(tarifa)
      .times(new D(1).minus(c("M")))
      .plus(c("F").minus(c("E")).times(tarifa))
      .plus(c("O"));
  } else {
    total = c("E")
      .times(c("F"))
      .times(new D(1).minus(c("G")))
      .plus(c("H"))
      .minus(c("I"))
      .minus(c("J"))
      .minus(c("K"));
  }
  return (caso.pix ?? []).reduce((s, v) => s.plus(v), total);
}

if (process.argv.includes("--verificar-central")) {
  const casosOracle = [
    ...referencias,
    ...referenciasArredondamento,
    ...referenciasClassico,
  ];
  const execucao = spawnSync(
    process.env.PYTHON ?? "python",
    [
      fileURLToPath(
        new URL("./verificarReferenciaCentral.py", import.meta.url),
      ),
    ],
    {
      input: JSON.stringify({ fonte: fonteCentral, casos: casosOracle }),
      encoding: "utf8",
    },
  );
  assert.equal(execucao.status, 0, execucao.stderr || execucao.error?.message);
  const oraculo = JSON.parse(execucao.stdout);
  assert.equal(
    oraculo.sha256,
    sha256Central,
    "Fonte original mudou: revisar a proveniência antes de atualizar referências",
  );
  assert.equal(
    oraculo.resultados.length,
    casosOracle.filter((c) => c.celulas).length,
  );
  for (const resultado of oraculo.resultados) {
    const caso = casosOracle.find((c) => c.id === resultado.id);
    assert.ok(
      new D(resultado.bruto).eq(caso.bruto),
      `${caso.id}: bruto da Central`,
    );
    assert.equal(
      resultado.esperado,
      caso.esperado.replace(".", ","),
      `${caso.id}: formatação da Central`,
    );
  }
  console.log(`Referências confirmadas na Central SHA256 ${oraculo.sha256}`);
}

const contagens = { aprovado: 0, divergente: 0, sem_referencia_suficiente: 0 };
for (const caso of referenciasClassico) {
  const c = caso.celulas;
  const entrada = {
    modelo_calculo: "classico",
    injecao: c.E,
    consumo_total: c.F,
    unitario: c.H,
    bandeira: c.I,
    desconto: new D(c.M).times(100).toFixed(),
    iluminacao: c.O,
  };
  const atual = calcularCobranca(entrada);
  assert.equal(
    new D(atual.total_centavos).div(100).toFixed(2),
    caso.esperado,
    caso.id,
  );
  assert.ok(new D(atual.total_bruto).eq(caso.bruto), caso.id);
  assert.equal(atual.precisao.arredondamento, "ROUND_HALF_EVEN");
  assert.equal(atual.regra, "ecosol-classico-v1-central");
  assert.equal(atual.entradas.unitario, new D(c.H).toFixed(6));
  assert.deepEqual(
    calcularCobranca(entrada),
    atual,
    "Repetição do cálculo não acumula parcelas",
  );
  assert.throws(
    () => calcularCobranca({ ...entrada, iluminacao: "inválido" }),
    /iluminação/,
  );
  assert.throws(
    () => calcularCobranca({ ...entrada, juros: "1" }),
    /correspondência comprovada/,
  );
}
assert.throws(
  () => calcularCobranca({ modelo_calculo: "somente_energia" }),
  /Modelo/,
);
assert.throws(
  () => calcularCobranca({ ajustes_pix: [] }),
  /PIX não habilitado/,
);
for (const pendencia of pendenciasComplementares) {
  assert.equal(pendencia.classificacao, "pendente");
  assert.equal(pendencia.esperadoHomologado, null);
  assert.ok(pendencia.comprovado && pendencia.necessario);
}
console.log(
  `Modelo clássico: ${referenciasClassico.length} casos equivalentes ao código original; homologação operacional pendente.`,
);
for (const caso of referencias) {
  if (caso.celulas) {
    const referencia = referenciaDecimal(caso);
    assert.ok(referencia.eq(caso.bruto), `${caso.id}: resultado bruto`);
    assert.equal(
      referencia.toFixed(2),
      caso.esperado,
      `${caso.id}: referência em centavos`,
    );
  } else
    assert.equal(
      caso.esperado,
      null,
      "Ausência de referência não pode ganhar resultado presumido",
    );
  if (!caso.jose) {
    assert.equal(caso.classificacao, "sem_referencia_suficiente");
  } else if (caso.rejeicao) {
    assert.throws(() => calcularCobranca(caso.jose), new RegExp(caso.rejeicao));
    assert.equal(caso.classificacao, "divergente");
    assert.equal(
      caso.diferenca,
      null,
      "Rejeição não tem diferença monetária calculável",
    );
  } else if (caso.id === "empate-arredondamento") {
    // Preservar a divergência histórica, mas exigir a correção atual.
    assert.equal(caso.diferenca, "0.01");
    assert.equal(caso.classificacao, "divergente");
    assert.equal(calcularCobranca(caso.jose).total_centavos, 3100);
  } else if (caso.id === "tarifa-final") {
    // Referência histórica de nove casas preservada; nova escala rejeita sem truncar.
    assert.equal(caso.esperado, "119.88");
    assert.throws(() => calcularCobranca(caso.jose), /até 6 casas/);
  } else {
    const resultado = calcularCobranca(caso.jose);
    assert.ok(Number.isSafeInteger(resultado.total_centavos));
    const jose = new D(String(resultado.total_centavos)).div(100);
    const diferenca = jose.minus(caso.esperado);
    assert.equal(
      diferenca.toFixed(2),
      caso.diferenca,
      `${caso.id}: José menos Central`,
    );
    assert.equal(
      caso.classificacao,
      diferenca.isZero() ? "aprovado" : "divergente",
    );
  }
  contagens[caso.classificacao]++;
  console.log(
    `Histórico ${caso.classificacao}: ${caso.id}; Central=${caso.esperado ?? "sem referência"}; diferença José−Central=${caso.diferenca ?? "não calculável"}; ${caso.motivo}`,
  );
}
assert.equal(new Set(referencias.map((c) => c.id)).size, referencias.length);
for (const caso of referenciasArredondamento) {
  const resultado = calcularCobranca({
    injecao: "1",
    tarifa_total: caso.celulas.F,
    desconto: "0",
    total_equatorial: "0",
    juros: "0",
    multa: "0",
    ajuste_gdii: "0",
    modalidade: "GDI",
  });
  assert.equal(
    new D(resultado.total_centavos).div(100).toFixed(2),
    caso.esperado,
    caso.id,
  );
  assert.ok(new D(resultado.total_bruto).eq(caso.bruto));
  assert.equal(resultado.tarifa_completa, caso.celulas.F);
  assert.equal(resultado.precisao.arredondamento, "ROUND_HALF_EVEN");
  assert.equal(resultado.regra, "ecosol-v4-arredondamento-central");
}
console.log(
  `Arredondamento atual: ${referenciasArredondamento.length} referências equivalentes à Central.`,
);
// Referências operacionais incompletas não podem ser promovidas a homologadas
// nem ganhar valores presumidos a partir dos dados extraídos no relatório.
for (const pendencia of pendenciasOperacionais) {
  assert.equal(pendencia.classificacao, "pendente");
  assert.equal(pendencia.esperado, null);
  assert.ok(pendencia.origem && pendencia.necessario);
}
console.log(
  `Operacionais: 0 homologadas; ${pendenciasOperacionais.length} grupos pendentes de evidência.`,
);
console.log(
  JSON.stringify({ casos: referencias.length, ...contagens, origem }),
);
// Planilhas atuais: cache e fórmula são evidências distintas. Não usar o
// resultado da fórmula para preencher um cache ausente ou substituir constante.
for (const caso of referenciasPlanilhasAtuais) {
  const bruto = referenciaDecimal({ ...caso, modelo: "fixa" });
  assert.ok(bruto.eq(caso.bruto), `${caso.id}: cálculo exato nas células XML`);
  const cache = new D(caso.armazenado);
  assert.equal(cache.toFixed(2, Decimal.ROUND_HALF_UP), caso.esperado);
  if (caso.formula)
    assert.equal(bruto.toFixed(2, Decimal.ROUND_HALF_UP), caso.esperado);
  else
    assert.notEqual(
      bruto.toFixed(2),
      caso.esperado,
      "Constante não pode ser homologada como fórmula fixa",
    );
  const entrada = (normalizar) => ({
    injecao: caso.celulas.E,
    tarifa_total: normalizar
      ? new D(caso.celulas.F).toFixed(6)
      : caso.celulas.F,
    desconto: new D(caso.celulas.G).times(100).toFixed(),
    total_equatorial: normalizar
      ? new D(caso.celulas.H).toFixed(2, Decimal.ROUND_HALF_UP)
      : caso.celulas.H,
    ajuste_gdii: normalizar
      ? new D(caso.celulas.K).toFixed(2, Decimal.ROUND_HALF_UP)
      : caso.celulas.K,
    modalidade: new D(caso.celulas.K).isZero() ? "GDI" : "GDII",
  });
  if (caso.rejeicaoBruta)
    assert.throws(
      () => calcularCobranca(entrada(false)),
      new RegExp(caso.rejeicaoBruta),
    );
  else
    assert.equal(
      new D(calcularCobranca(entrada(false)).total_centavos)
        .div(100)
        .toFixed(2),
      caso.joseEsperado,
    );
  const jose = new D(calcularCobranca(entrada(true)).total_centavos).div(100);
  assert.equal(jose.toFixed(2), caso.joseEsperado);
  assert.equal(
    jose.minus(cache.toFixed(2, Decimal.ROUND_HALF_UP)).toFixed(2),
    caso.diferenca,
  );
  console.log(
    `Planilha atual ${caso.id}: cache=${caso.esperado}; José normalizado=${caso.joseEsperado}; diferença=${caso.diferenca}; entrada bruta=${caso.rejeicaoBruta ? "rejeitada por precisão" : "aceita"}; ${caso.confiabilidade}`,
  );
}
assert.equal(
  new Set(referenciasPlanilhasAtuais.map((c) => c.id)).size,
  referenciasPlanilhasAtuais.length,
);
for (const pendencia of pendenciasPlanilhasAtuais) {
  assert.equal(pendencia.esperado, null);
  assert.ok(pendencia.motivo);
}
// Regressão posterior à correção: manter acima a caracterização histórica
// sem encargos e comparar agora com TODOS os campos da fórmula fixa.
for (const caso of referenciasPlanilhasAtuais) {
  const c = caso.celulas;
  const bruto = {
    injecao: c.E,
    tarifa_total: c.F,
    desconto: new D(c.G).times(100).toFixed(),
    total_equatorial: c.H,
    ajuste_gdii: c.K,
    juros: c.I,
    multa: c.J,
    modalidade: new D(c.K).isZero() ? "GDI" : "GDII",
  };
  const { dados, registros } = normalizarDadosFinanceiros(bruto, {
    origem: "referencia_planilha_anonimizada",
    tipo: "numero",
  });
  for (const [campo, registro] of Object.entries(registros)) {
    assert.equal(registro.bruto, bruto[campo]);
    assert.equal(registro.normalizado, dados[campo]);
    assert.ok(["exato", "residuo_ieee754"].includes(registro.situacao));
  }
  const atual = new D(calcularCobranca(dados).total_centavos).div(100);
  const esperado = caso.formula ? caso.esperado : caso.joseEsperado;
  assert.equal(
    atual.toFixed(2),
    esperado,
    `${caso.id}: regressão após encargos`,
  );
  const diferenca = atual.minus(caso.esperado).toFixed(2);
  assert.equal(diferenca, caso.id === "OUT-D" ? "-95.07" : "0.00");
  console.log(
    `Após correção ${caso.id}: José=${atual.toFixed(2)}; diferença=${diferenca}${caso.id === "OUT-D" ? "; exceção manual pendente" : ""}`,
  );
}
for (const id of ["juros", "multa", "encargos-gdii", "sem-injecao-com-juros"]) {
  const caso = referencias.find((c) => c.id === id);
  const atual = calcularCobranca({
    ...caso.jose,
    juros: caso.celulas.I,
    multa: caso.celulas.J,
  });
  assert.equal(
    new D(atual.total_centavos).div(100).toFixed(2),
    caso.esperado,
    id,
  );
}
console.log(
  `Planilhas atuais: ${referenciasPlanilhasAtuais.length} casos caracterizados; ${pendenciasPlanilhasAtuais.length} comportamentos pendentes. Não equivalem a snapshots históricos.`,
);
