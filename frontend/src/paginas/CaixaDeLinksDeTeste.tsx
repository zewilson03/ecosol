import { Navigate } from "react-router-dom";
import { usarDados } from "../dadosDaAplicacao";

type LinkDeTeste = {
  recipient: string;
  subject: string;
  url: string;
  created_at: string;
};

export default function CaixaDeLinksDeTeste() {
  const { dados: links, carregando } =
    usarDados<LinkDeTeste[]>("/api/dev/links");
  if (!import.meta.env.DEV) return <Navigate to="/" replace />;

  return (
    <main className="inner-page">
      <div className="shell narrow">
        <div className="form-card">
          <span className="overline">SOMENTE DESENVOLVIMENTO</span>
          <h1>Links de acesso</h1>
          <p>
            Esta caixa simula o recebimento de email para testar o projeto
            localmente.
          </p>
          {carregando && <p>Carregando links...</p>}
          {links?.map((link, indice) => (
            <div className="dev-link" key={indice}>
              <strong>{link.subject}</strong>
              <small>
                {link.recipient} · {link.created_at}
              </small>
              <a href={link.url}>Abrir link ↗</a>
            </div>
          ))}
          {links?.length === 0 && <p>Nenhum link enviado ainda.</p>}
        </div>
      </div>
    </main>
  );
}
