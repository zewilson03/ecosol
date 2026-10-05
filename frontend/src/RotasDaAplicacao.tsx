import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import EstruturaAdministrativa from "./admin/EstruturaAdministrativa";
import Usinas from "./admin/Usinas";
import Faturas from "./admin/Faturas";
import Clientes from "./admin/Clientes";
import Financeiro from "./admin/Financeiro";
import Gmail from "./admin/Gmail";
import EstruturaDoSite from "./EstruturaDoSite";
import PaginaInicial from "./paginas/PaginaInicial";
import FormularioDeContato from "./paginas/FormularioDeContato";
import EntradaDoCliente from "./paginas/EntradaDoCliente";
import CadastroDoCliente from "./paginas/CadastroDoCliente";
import SolicitacaoDeAcesso from "./paginas/SolicitacaoDeAcesso";
import DefinicaoDeSenha from "./paginas/DefinicaoDeSenha";
import PainelDoCliente from "./paginas/PainelDoCliente";
import PainelDaEquipe from "./paginas/PainelDaEquipe";
import CaixaDeLinksDeTeste from "./paginas/CaixaDeLinksDeTeste";
import InformacoesDePrivacidade from "./paginas/InformacoesDePrivacidade";

export default function RotasDaAplicacao() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<EstruturaAdministrativa />}>
          <Route index element={<Navigate to="usinas" replace />} />
          <Route path="usinas" element={<Usinas />} />
          <Route path="faturas" element={<Faturas />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="financeiro" element={<Financeiro />} />
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
    </BrowserRouter>
  );
}
