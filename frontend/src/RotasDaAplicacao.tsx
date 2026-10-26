import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import EstruturaAdministrativa from "./admin/EstruturaAdministrativa";
import EstruturaDoSite from "./EstruturaDoSite";

const Usinas = lazy(() => import("./admin/Usinas"));
const DetalheDaUsina = lazy(() => import("./admin/DetalheDaUsina"));
const Faturas = lazy(() => import("./admin/Faturas"));
const Clientes = lazy(() => import("./admin/Clientes"));
const Financeiro = lazy(() => import("./admin/Financeiro"));
const PagamentosECompras = lazy(() => import("./admin/PagamentosECompras"));
const Gmail = lazy(() => import("./admin/Gmail"));
const Bancario = lazy(() => import("./admin/Bancario"));
const PaginaInicial = lazy(() => import("./paginas/PaginaInicial"));
const FormularioDeContato = lazy(() => import("./paginas/FormularioDeContato"));
const EntradaDoCliente = lazy(() => import("./paginas/EntradaDoCliente"));
const CadastroDoCliente = lazy(() => import("./paginas/CadastroDoCliente"));
const SolicitacaoDeAcesso = lazy(() => import("./paginas/SolicitacaoDeAcesso"));
const DefinicaoDeSenha = lazy(() => import("./paginas/DefinicaoDeSenha"));
const PainelDoCliente = lazy(() => import("./paginas/PainelDoCliente"));
const PainelDaEquipe = lazy(() => import("./paginas/PainelDaEquipe"));
const CaixaDeLinksDeTeste = lazy(() => import("./paginas/CaixaDeLinksDeTeste"));
const InformacoesDePrivacidade = lazy(
  () => import("./paginas/InformacoesDePrivacidade"),
);

function CarregamentoDeRota() {
  return (
    <main className="inner-page shell" aria-live="polite" aria-busy="true">
      Carregando…
    </main>
  );
}

export default function RotasDaAplicacao() {
  return (
    <BrowserRouter>
      <Suspense fallback={<CarregamentoDeRota />}>
        <Routes>
          <Route path="/admin" element={<EstruturaAdministrativa />}>
            <Route index element={<Navigate to="usinas" replace />} />
            <Route path="usinas" element={<Usinas />} />
            <Route path="usinas/:id" element={<DetalheDaUsina />} />
            <Route path="faturas" element={<Faturas />} />
            <Route
              path="calculos"
              element={<Navigate to="/admin/faturas?etapa=calcular" replace />}
            />
            <Route path="clientes" element={<Clientes />} />
            <Route path="financeiro" element={<Financeiro />} />
            <Route path="pagamentos" element={<PagamentosECompras />} />
            <Route path="bancario" element={<Bancario />} />
            <Route path="gmail" element={<Gmail />} />
            <Route path="*" element={<Navigate to="/admin/usinas" replace />} />
          </Route>
          <Route element={<EstruturaDoSite />}>
            <Route path="/" element={<PaginaInicial />} />
            <Route path="/contato" element={<FormularioDeContato />} />
            <Route path="/entrar" element={<EntradaDoCliente />} />
            <Route path="/cadastro" element={<CadastroDoCliente />} />
            <Route path="/acesso" element={<SolicitacaoDeAcesso />} />
            <Route path="/definir-senha" element={<DefinicaoDeSenha />} />
            <Route path="/minha-area" element={<PainelDoCliente />} />
            <Route path="/equipe" element={<PainelDaEquipe />} />
            <Route
              path="/equipe/cadastros"
              element={<Navigate to="/admin/clientes" replace />}
            />
            <Route path="/dev/links" element={<CaixaDeLinksDeTeste />} />
            <Route path="/privacidade" element={<InformacoesDePrivacidade />} />
            <Route
              path="*"
              element={
                <main className="inner-page shell">
                  <h1>Página não encontrada</h1>
                </main>
              }
            />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
