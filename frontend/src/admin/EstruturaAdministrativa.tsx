import { CSSProperties, useEffect, useState } from "react";
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

function IconeModulo({ modulo }: { modulo: string }) {
  const tracos: Record<string, React.ReactNode> = {
    usinas: (
      <>
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
      </>
    ),
    faturas: (
      <>
        <path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    clientes: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M17 6a3 3 0 0 1 0 6m1.5 3a5 5 0 0 1 2 4v1" />
      </>
    ),
    financeiro: (
      <>
        <path d="M3 19h18M5 16l5-5 4 3 5-7" />
        <path d="M15 7h4v4" />
      </>
    ),
    gmail: (
      <>
        <rect x="2.5" y="5" width="19" height="14" rx="2" />
        <path d="m3 7 9 7 9-7" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {tracos[modulo]}
    </svg>
  );
}

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
  const [lateralRecolhida, definirLateralRecolhida] = useState(false);
  const [lateralTemporaria, definirLateralTemporaria] = useState(false);
  const [progresso, definirProgresso] = useState(0);
  useEffect(() => {
    let quadro = 0;
    const atualizarProgresso = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        const limite =
          document.documentElement.scrollHeight - window.innerHeight;
        definirProgresso(limite > 0 ? Math.min(1, window.scrollY / limite) : 0);
      });
    };
    atualizarProgresso();
    window.addEventListener("scroll", atualizarProgresso, { passive: true });
    window.addEventListener("resize", atualizarProgresso);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener("scroll", atualizarProgresso);
      window.removeEventListener("resize", atualizarProgresso);
    };
  }, []);
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
  const lateralExpandida = !lateralRecolhida || lateralTemporaria;
  const itens = [
    { rota: "usinas", nome: "Usinas" },
    { rota: "faturas", nome: "Faturas" },
    { rota: "clientes", nome: "Cadastros" },
    ...(administrador.nivel >= 2
      ? [{ rota: "financeiro", nome: "Financeiro" }]
      : []),
    ...(administrador.nivel >= 3
      ? [{ rota: "gmail", nome: "Integração Gmail" }]
      : []),
  ];

  return (
    <div
      className={`admin-aplicacao${lateralExpandida ? "" : " admin-aplicacao--recolhida"}`}
    >
      <aside
        className={"admin-lateral" + (menuAberto ? " aberto" : "")}
        onMouseEnter={() => {
          if (lateralRecolhida) definirLateralTemporaria(true);
        }}
        onMouseLeave={() => definirLateralTemporaria(false)}
        onFocusCapture={() => {
          if (lateralRecolhida) definirLateralTemporaria(true);
        }}
        onBlurCapture={(evento) => {
          if (!evento.currentTarget.contains(evento.relatedTarget))
            definirLateralTemporaria(false);
        }}
      >
        <div className="admin-lateral-topo">
          <Link className="admin-marca" to="/" aria-label="Ecosol, início">
            ☀ ecosol<span>.</span>
          </Link>
          <button
            type="button"
            className="admin-recolher"
            aria-label={
              lateralRecolhida ? "Fixar menu aberto" : "Recolher menu"
            }
            aria-expanded={lateralExpandida}
            aria-controls="admin-modulos"
            title={lateralRecolhida ? "Fixar menu aberto" : "Recolher menu"}
            onClick={() => {
              definirLateralRecolhida((atual) => !atual);
              definirLateralTemporaria(false);
            }}
          >
            <span aria-hidden="true">{lateralRecolhida ? "»" : "«"}</span>
          </button>
        </div>
        <span className="admin-legenda">ESPAÇO DE GESTÃO</span>
        <nav id="admin-modulos" aria-label="Módulos administrativos">
          {itens.map((item) => (
            <NavLink
              key={item.rota}
              to={"/admin/" + item.rota}
              aria-label={item.nome}
              title={lateralExpandida ? undefined : item.nome}
              onClick={() => definirMenuAberto(false)}
            >
              <span className="admin-nav-icone">
                <IconeModulo modulo={item.rota} />
              </span>
              <span className="admin-nav-texto">{item.nome}</span>
            </NavLink>
          ))}
        </nav>
        <div className="admin-perfil">
          <span className="admin-avatar">
            {administrador.nome.slice(0, 1).toUpperCase()}
          </span>
          <div className="admin-perfil-texto">
            <strong>{administrador.nome}</strong>
            <small>
              Nível {administrador.nivel} ·{" "}
              {nomesDosNiveis[administrador.nivel]}
            </small>
          </div>
        </div>
        <form method="post" action="/api/sair">
          <button
            className="admin-sair"
            aria-label="Sair da conta"
            title={lateralExpandida ? undefined : "Sair da conta"}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 16l4-4-4-4M19 12H9" />
            </svg>
            <span>Sair da conta</span>
          </button>
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
      <div className="admin-orbita-scroll" aria-hidden="true">
        <span
          className="admin-sol-scroll"
          style={{ "--progresso-scroll": progresso } as CSSProperties}
        />
      </div>
    </div>
  );
}
