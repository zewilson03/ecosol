import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { criarFixturesCalculos } from "./fixturesCalculos.mjs";

const vite = await createServer({
  configFile: resolve("frontend/vite.config.ts"),
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { prepararLinhaCalculo, resumirCalculos } = await vite.ssrLoadModule(
    "/src/admin/painelCalculos.ts",
  );
  const { default: Demonstrativo } = await vite.ssrLoadModule(
    "/src/admin/DemonstrativoCalculo.tsx",
  );
  const { unidades, documentos } = criarFixturesCalculos();
  const original = structuredClone({ unidades, documentos });
  const linhas = documentos.map((d) =>
    prepararLinhaCalculo(
      d,
      unidades,
      documentos,
      new Date("2026-10-13T15:00:00Z"),
    ),
  );
  assert.equal(linhas[0].situacao, "pronta");
  assert.equal(linhas[0].dados.unidade_id, "1");
  assert.equal(linhas[0].dados.cliente_id, "10");
  assert.equal(linhas[0].dados.modalidade, "GDI");
  assert.equal(linhas[0].dados.ajuste_gdii, "0");
  assert.equal(linhas[0].dados.vencimento_ecosol, ""); // usa Equatorial no servidor
  assert.equal(linhas[1].dados.ajuste_gdii, "290.71");
  assert.equal(linhas[2].situacao, "pronta");
  assert.ok(!linhas[2].pendencias.includes("documentação real do cliente"));
  const aprovadaOperacional = prepararLinhaCalculo(
    {
      ...documentos[2],
      status: "Aprovada — aguardando emissão",
      memoria: { ...documentos[3].memoria, unidade: unidades[2] },
    },
    unidades,
    documentos,
  );
  assert.equal(aprovadaOperacional.situacao, "aprovada_bloqueada");
  assert.ok(
    aprovadaOperacional.pendenciasEmissao.includes(
      "documentação real do cliente",
    ),
  );
  assert.deepEqual(
    { unidades, documentos },
    original,
    "Preparar a lista não grava nem altera seus dados de origem",
  );
  assert.deepEqual(resumirCalculos(linhas), {
    quantidade: 5,
    pendentes: 0,
    prontas: 3,
    calculadas: 2,
    aguardandoAprovacao: 1,
    aprovadas: 1,
    totalCentavos: 322731,
  });
  assert.equal(
    resumirCalculos(linhas.slice(0, 3)).totalCentavos,
    0,
    "Prévias e campos preenchidos não entram no total salvo",
  );

  const transferida = {
    ...unidades[0],
    usina_id: 2,
    usina_nome: "Destino novo",
    vinculos_usina: [
      {
        inicio: "2026-11",
        usina_id: 2,
        usina_nome: "Destino novo",
        modalidades: [{ inicio: "2026-11", modalidade: "GDII" }],
      },
      {
        inicio: "2026-09",
        usina_id: 1,
        usina_nome: "Usina anterior",
        modalidades: [{ inicio: "2026-09", modalidade: "GDI" }],
      },
    ],
  };
  const outubro = prepararLinhaCalculo(
    documentos[0],
    [transferida],
    documentos,
  );
  assert.equal(outubro.usinaId, 1);
  assert.equal(outubro.modalidade, "GDI");
  const novembro = prepararLinhaCalculo(
    {
      ...documentos[0],
      dados: { ...documentos[0].dados, competencia: "2026-11" },
    },
    [transferida],
    documentos,
  );
  assert.equal(novembro.usinaId, 2);
  assert.equal(novembro.modalidade, "GDII");
  assert.ok(novembro.pendencias.includes("ajuste GDII"));
  const salva = prepararLinhaCalculo(documentos[3], [transferida], documentos);
  assert.equal(
    salva.usinaNome,
    "Usina de teste GDI",
    "Cálculo salvo preserva a usina da memória",
  );
  assert.strictEqual(salva.memoria, documentos[3].memoria);

  const divergente = prepararLinhaCalculo(
    { ...documentos[0], dados: { ...documentos[0].dados, unidade_id: "999" } },
    unidades,
    documentos,
  );
  assert.equal(divergente.dados.unidade_id, "999");
  assert.ok(
    divergente.pendencias.includes("cliente e UC"),
    "Vínculo divergente precisa de conferência",
  );
  const comDia = { ...unidades[0], dia_vencimento: 5 };
  const jaVinculada = {
    ...documentos[0],
    dados: { ...documentos[0].dados, unidade_id: "1", cliente_id: "10" },
  };
  const hoje = new Date("2026-10-13T15:00:00Z");
  assert.equal(
    prepararLinhaCalculo(jaVinculada, [comDia], documentos, hoje).dados
      .vencimento_ecosol,
    "",
    "Campo salvo vazio preserva vencimento Equatorial",
  );
  assert.equal(
    prepararLinhaCalculo(documentos[0], [comDia], documentos, hoje).dados
      .vencimento_ecosol,
    "2026-11-05",
    "Primeira vinculação pode sugerir dia preferido",
  );
  const corrigida = {
    ...jaVinculada,
    dados: { ...jaVinculada.dados, uc_divergente_confirmada: "sim" },
    extracao: {
      ...jaVinculada.extracao,
      dados: { ...jaVinculada.extracao.dados, uc: "999999999" },
    },
  };
  const correcao = prepararLinhaCalculo(corrigida, unidades, documentos, hoje);
  assert.equal(correcao.cliente, unidades[0].nome);
  assert.equal(correcao.usinaId, 1);
  assert.equal(
    correcao.situacao,
    "pronta",
    "Identificação manual salva prevalece sobre sugestão antiga",
  );
  const gdiHtml = renderToStaticMarkup(
    createElement(Demonstrativo, { memoria: linhas[3].memoria }),
  );
  assert.ok(gdiHtml.includes("1.759,01"));
  assert.ok(!gdiHtml.includes("− Ajuste GDII"));
  const gdiiHtml = renderToStaticMarkup(
    createElement(Demonstrativo, { memoria: linhas[4].memoria, previa: true }),
  );
  assert.ok(gdiiHtml.includes("− Ajuste GDII"));
  assert.ok(gdiiHtml.includes("1.468,30"));
  assert.ok(gdiiHtml.includes("não salva"));
  const memoriaEncargos = {
    ...linhas[3].memoria,
    juros_centavos: 7,
    multa_centavos: 149,
    total_centavos: linhas[3].memoria.total_centavos - 156,
  };
  const htmlEncargos = renderToStaticMarkup(
    createElement(Demonstrativo, { memoria: memoriaEncargos }),
  );
  assert.ok(htmlEncargos.includes("− Juros Equatorial"));
  assert.ok(htmlEncargos.includes("− Multa Equatorial"));
  assert.ok(htmlEncargos.includes("1.757,45"));
  const htmlPrecisao = renderToStaticMarkup(
    createElement(Demonstrativo, {
      memoria: {
        ...linhas[3].memoria,
        tarifa_completa: "1.200000",
        consumo_bruto: "0.66666600333333",
        precisao: {
          tarifa: 6,
          moeda: 2,
          arredondamento: "ROUND_HALF_UP",
          etapa: "total",
        },
      },
    }),
  );
  assert.ok(htmlPrecisao.includes("1,200000"));
  assert.ok(htmlPrecisao.includes("0,66666600333333"));
  assert.ok(htmlPrecisao.includes("Somente o total"));
  assert.ok(htmlPrecisao.includes("(HALF_UP)")); // Memória histórica intacta.
  const htmlCentral = renderToStaticMarkup(
    createElement(Demonstrativo, {
      memoria: {
        ...linhas[3].memoria,
        precisao: {
          tarifa: 6,
          moeda: 2,
          arredondamento: "ROUND_HALF_EVEN",
          etapa: "total",
        },
      },
    }),
  );
  assert.ok(htmlCentral.includes("(HALF_EVEN)"));
  assert.ok(!htmlCentral.includes("(HALF_UP)"));
  console.log(
    "Cálculos: sugestões, pendências, histórico por competência, totais salvos e demonstrativos validados.",
  );
} finally {
  await vite.close();
}
