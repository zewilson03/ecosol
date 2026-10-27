import { lazy, Suspense, useEffect } from "react";
import { CabecalhoDoModulo } from "./ComponentesDoPainel";
import { Link, useSearchParams } from "react-router-dom";

const PreparacaoFaturas = lazy(() => import("./PreparacaoFaturas"));
const Calculos = lazy(() => import("./Calculos"));
const LotesFaturamento = lazy(() => import("./LotesFaturamento"));

export default function Faturas() {
  const [parametros] = useSearchParams();
  const solicitada = parametros.get("etapa");
  const etapa = [
    "receber",
    "conferir",
    "calcular",
    "aprovar",
    "lotes",
  ].includes(solicitada ?? "")
    ? solicitada!
    : parametros.has("documento")
      ? "conferir"
      : "receber";

  useEffect(() => {
    if (etapa !== "receber" && etapa !== "conferir") return;
    const quadro = requestAnimationFrame(() => {
      document
        .getElementById(
          etapa === "receber"
            ? "faturamento-receber"
            : "faturamento-conferencia",
        )
        ?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(quadro);
  }, [etapa]);

  const etapas = [
    { id: "lotes", nome: "Lotes" },
    { id: "receber", nome: "Receber PDF" },
    { id: "conferir", nome: "Conferir dados" },
    { id: "calcular", nome: "Calcular" },
    { id: "aprovar", nome: "Aprovar" },
  ];

  return (
    <>
      <CabecalhoDoModulo
        titulo="Faturas e cobranças"
        descricao="Receba o PDF, confira os dados, calcule e aprove a cobrança em um único fluxo."
      />
      <nav aria-label="Etapas de Faturas">
        <ol className="faturamento-etapas faturamento-navegacao-etapas">
          {etapas.map((item, indice) => (
            <li className={etapa === item.id ? "atual" : ""} key={item.id}>
              <Link
                to={`/admin/faturas?etapa=${item.id}`}
                aria-current={etapa === item.id ? "step" : undefined}
              >
                <span>{indice + 1}</span>
                <strong>{item.nome}</strong>
              </Link>
            </li>
          ))}
        </ol>
      </nav>
      <Suspense
        fallback={
          <section aria-live="polite" aria-busy="true">
            Carregando etapa…
          </section>
        }
      >
        {etapa === "lotes" ? (
          <LotesFaturamento />
        ) : etapa === "calcular" || etapa === "aprovar" ? (
          <Calculos incorporado modo={etapa} />
        ) : (
          <PreparacaoFaturas />
        )}
      </Suspense>
    </>
  );
}
