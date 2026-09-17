import { useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useOutletContext,
} from "react-router-dom";
import { Sessao } from "../dadosDaAplicacao";
import { nomesDosNiveis, usarConsulta } from "./comunicacaoComServidor";
import "./estilosAdministrativos.css";

type AdministradorConectado = {
  id: number | null;
  nome: string;
  nivel: number;
};

export function usarAdministrador() {
  return useOutletContext<AdministradorConectado>();
}

export default function EstruturaAdministrativa() {
  const {
    dados: sessao,
    carregando,
    erro,
    atualizar,
  } = usarConsulta<Sessao>("/api/sessao");
  const [menuAberto, definirMenuAberto] = useState(false);
  if (carregando)
    return (
      <main className="admin-carregando" role="status">
        Preparando seu painel…
      </main>
    );
  if (erro)
    return (
      <main className="admin-carregando">
        <p role="alert">{erro}</p>
        <button onClick={atualizar}>Tentar novamente</button>
      </main>
    );
  if (sessao?.perfil !== "equipe") return <Navigate to="/equipe" replace />;

  const administrador = sessao.administrador;
  const itens = [
    { rota: "usinas", nome: "Usinas", simbolo: "☀" },
    { rota: "faturas", nome: "Faturas", simbolo: "▤" },
    { rota: "clientes", nome: "Clientes", simbolo: "◎" },
    ...(administrador.nivel >= 2
      ? [{ rota: "financeiro", nome: "Financeiro", simbolo: "↗" }]
      : []),
  ];

  return (
    <div className="admin-aplicacao">
      <aside className={"admin-lateral" + (menuAberto ? " aberto" : "")}>
        <Link className="admin-marca" to="/">
          ☀ ecosol<span>.</span>
        </Link>
        <span className="admin-legenda">ESPAÇO DE GESTÃO</span>
        <nav aria-label="Módulos administrativos">
          {itens.map((item) => (
            <NavLink
              key={item.rota}
              to={"/admin/" + item.rota}
              onClick={() => definirMenuAberto(false)}
            >
              <span aria-hidden="true">{item.simbolo}</span>
              {item.nome}
            </NavLink>
          ))}
        </nav>
        <div className="admin-perfil">
          <span className="admin-avatar">
            {administrador.nome.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{administrador.nome}</strong>
            <small>
              Nível {administrador.nivel} ·{" "}
              {nomesDosNiveis[administrador.nivel]}
            </small>
          </div>
        </div>
        <form method="post" action="/api/sair">
          <button className="admin-sair">Sair da conta ↗</button>
        </form>
      </aside>
      <div className="admin-principal">
        <header className="admin-cabecalho">
          <button
            className="admin-menu-mobile"
            onClick={() => definirMenuAberto(!menuAberto)}
            aria-expanded={menuAberto}
            aria-label="Abrir ou fechar menu"
          >
            ☰
          </button>
          <span>
            Ecosol <span className="admin-separador">/</span> Administração
          </span>
          <span className="admin-etiqueta">Energia que conecta ☀</span>
        </header>
        <main className="admin-conteudo">
          <Outlet context={administrador} />
        </main>
      </div>
    </div>
  );
}
