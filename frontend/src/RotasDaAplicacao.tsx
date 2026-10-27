import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
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

function RotaCarregavel({ children }: { children: ReactNode }) {
  return <Suspense fallback={<CarregamentoDeRota />}>{children}</Suspense>;
}

export default function RotasDaAplicacao() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<EstruturaAdministrativa />}>
          <Route index element={<Navigate to="usinas" replace />} />
          <Route
            path="usinas"
            element={
              <RotaCarregavel>
                <Usinas />
              </RotaCarregavel>
            }
          />
          <Route
            path="usinas/:id"
            element={
              <RotaCarregavel>
                <DetalheDaUsina />
              </RotaCarregavel>
            }
          />
          <Route
            path="faturas"
            element={
              <RotaCarregavel>
                <Faturas />
              </RotaCarregavel>
            }
          />
          <Route
            path="calculos"
            element={<Navigate to="/admin/faturas?etapa=calcular" replace />}
          />
          <Route
            path="clientes"
            element={
              <RotaCarregavel>
                <Clientes />
              </RotaCarregavel>
            }
          />
          <Route
            path="financeiro"
            element={
              <RotaCarregavel>
                <Financeiro />
              </RotaCarregavel>
            }
          />
          <Route
            path="pagamentos"
            element={
              <RotaCarregavel>
                <PagamentosECompras />
              </RotaCarregavel>
            }
          />
          <Route
            path="bancario"
            element={
              <RotaCarregavel>
                <Bancario />
              </RotaCarregavel>
            }
          />
          <Route
            path="gmail"
            element={
              <RotaCarregavel>
                <Gmail />
              </RotaCarregavel>
            }
          />
          <Route path="*" element={<Navigate to="/admin/usinas" replace />} />
        </Route>
        <Route element={<EstruturaDoSite />}>
          <Route
            path="/"
            element={
              <RotaCarregavel>
                <PaginaInicial />
              </RotaCarregavel>
            }
          />
          <Route
            path="/contato"
            element={
              <RotaCarregavel>
                <FormularioDeContato />
              </RotaCarregavel>
            }
          />
          <Route
            path="/entrar"
            element={
              <RotaCarregavel>
                <EntradaDoCliente />
              </RotaCarregavel>
            }
          />
          <Route
            path="/cadastro"
            element={
              <RotaCarregavel>
                <CadastroDoCliente />
              </RotaCarregavel>
            }
          />
          <Route
            path="/acesso"
            element={
              <RotaCarregavel>
                <SolicitacaoDeAcesso />
              </RotaCarregavel>
            }
          />
          <Route
            path="/definir-senha"
            element={
              <RotaCarregavel>
                <DefinicaoDeSenha />
              </RotaCarregavel>
            }
          />
          <Route
            path="/minha-area"
            element={
              <RotaCarregavel>
                <PainelDoCliente />
              </RotaCarregavel>
            }
          />
          <Route
            path="/equipe"
            element={
              <RotaCarregavel>
                <PainelDaEquipe />
              </RotaCarregavel>
            }
          />
          <Route
            path="/equipe/cadastros"
            element={<Navigate to="/admin/clientes" replace />}
          />
          <Route
            path="/dev/links"
            element={
              <RotaCarregavel>
                <CaixaDeLinksDeTeste />
              </RotaCarregavel>
            }
          />
          <Route
            path="/privacidade"
            element={
              <RotaCarregavel>
                <InformacoesDePrivacidade />
              </RotaCarregavel>
            }
          />
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
    </BrowserRouter>
  );
}
