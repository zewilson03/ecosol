import { Link, Outlet } from "react-router-dom";

export default function EstruturaDoSite() {
  return (
    <>
      <header className="header">
        <div className="shell nav">
          <Link className="brand" to="/" aria-label="Ecosol, início">
            <span className="brand-icon">✳</span> ecosol
            <span className="brand-dot">.</span>
          </Link>

          <nav aria-label="Menu principal">
            <Link to="/#como-funciona">Como funciona</Link>
            <Link to="/#sobre">Sobre nós</Link>
            <Link to="/contato">Fale com a Ecosol</Link>
          </nav>

          <div className="nav-actions">
            <Link
              className="nav-login"
              to="/entrar"
              aria-label="Entrar na área do cliente"
            >
              <span className="nav-label-full">Área do cliente</span>
              <span className="nav-label-short" aria-hidden="true">
                Cliente
              </span>
              <span className="nav-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
            <Link
              className="nav-login nav-login-admin"
              to="/equipe"
              aria-label="Entrar na área do administrador"
            >
              <span className="nav-label-full">Área do administrador</span>
              <span className="nav-label-short" aria-hidden="true">
                Admin
              </span>
              <span className="nav-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          </div>
        </div>
      </header>

      <Outlet />

      <footer className="footer">
        <div className="shell footer-grid">
          <div>
            <Link className="brand" to="/">
              ✳ ecosol<span className="brand-dot">.</span>
            </Link>
            <p>Energia solar para transformar possibilidades em movimento.</p>
          </div>
          <div>
            <strong>Explore</strong>
            <Link to="/#como-funciona">Como funciona</Link>
            <Link to="/#sobre">Sobre a Ecosol</Link>
            <Link to="/contato">Contato</Link>
          </div>
          <div>
            <strong>Informações</strong>
            <Link to="/privacidade">Privacidade</Link>
            <Link to="/entrar">Área do cliente</Link>
            <Link to="/equipe">Área do administrador</Link>
          </div>
        </div>
        <div className="shell footer-bottom">
          © {new Date().getFullYear()} Ecosol · Projeto demonstrativo
        </div>
      </footer>
    </>
  );
}
