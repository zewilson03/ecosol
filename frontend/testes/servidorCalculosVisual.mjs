// Ambiente visual isolado: respostas simuladas e dados sintéticos, somente em memória.
// Não importa banco, configurações, sessões reais ou integrações externas.
// Executar depois de npm run build; parar com Ctrl+C.
import express from "express";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { criarFixturesCalculos } from "./fixturesCalculos.mjs";
import { calcularCobranca } from "../../backend/servidor/faturamento/regras.mjs";

const app = express();
const { documentos, unidades } = criarFixturesCalculos();
const nivel = Number(process.env.ECOSOL_TEST_NIVEL || 3);
const base = "/api/admin/faturamento";
app.use(express.json());
app.get("/api/sessao", (_req, res) =>
  res.json({
    perfil: "equipe",
    administrador: { id: 1, nome: "Teste isolado — Cálculos", nivel },
  }),
);
app.get(`${base}/documentos`, (_req, res) => res.json(documentos));
app.get(`${base}/unidades`, (_req, res) => res.json(unidades));
app.get(`${base}/documentos/:id`, (req, res) =>
  res.json(documentos.find((d) => d.id === Number(req.params.id))),
);
app.post(`${base}/documentos/:id/:acao`, (req, res) => {
  const d = documentos.find((item) => item.id === Number(req.params.id));
  if (!d || d.versao !== req.body.versao)
    return res.status(409).json({ erro: "Versão de teste desatualizada." });
  if (d.status.startsWith("Aprovada"))
    return res.status(409).json({ erro: "Fatura de teste já aprovada." });
  const acao = req.params.acao;
  if (acao === "aprovar") {
    if (nivel < 3 || !req.body.conferido || d.status !== "Calculada")
      return res.status(403).json({ erro: "Aprovação indisponível." });
    d.status = "Aprovada — aguardando emissão";
    d.versao++;
    return res.json(d);
  }
  const dados = req.body.dados;
  const u = unidades.find((item) => item.id === Number(dados?.unidade_id));
  if (!u || u.cliente_operacional_id)
    return res.status(422).json({ erro: "Cadastro pendente." });
  const modalidade = u.modalidades_usina[0].modalidade;
  const desconto = u.descontos[0].desconto;
  const memoria = {
    ...calcularCobranca({ ...dados, modalidade, desconto }),
    unidade: structuredClone(u),
    contrato: { modalidade, desconto, inicio: dados.competencia },
    competencia: dados.competencia,
    vencimento_equatorial: dados.vencimento_equatorial,
    vencimento_ecosol: dados.vencimento_ecosol || dados.vencimento_equatorial,
    fonte: { tipo: "propria", documento_id: d.id },
  };
  const hash = createHash("sha256")
    .update(JSON.stringify(memoria))
    .digest("hex");
  if (acao === "previa") return res.json({ memoria, hash, versao: d.versao });
  if (
    acao !== "calcular" ||
    nivel < 2 ||
    !req.body.conferido ||
    req.body.previa_hash !== hash
  )
    return res.status(409).json({ erro: "Confirme uma prévia válida." });
  d.dados = dados;
  d.memoria = memoria;
  d.status = "Calculada";
  d.versao++;
  return res.json(d);
});
app.use("/api", (_req, res) =>
  res.status(404).json({ erro: "Recurso fora do cenário visual de teste." }),
);
app.use(express.static(resolve("frontend/dist")));
app.get("/{*path}", (_req, res) =>
  res.sendFile(resolve("frontend/dist/index.html")),
);
app.listen(4317, "127.0.0.1", () =>
  console.log("Teste visual isolado: http://127.0.0.1:4317/admin/calculos"),
);
