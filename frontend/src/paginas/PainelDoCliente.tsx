import { Navigate } from "react-router-dom";
import { Sessao, usarDados } from "../dadosDaAplicacao";

export default function PainelDoCliente() {
  const { dados: sessao, carregando } = usarDados<Sessao>("/api/sessao");
  if (carregando)
    return <main className="inner-page shell">Carregando sua área...</main>;
  if (sessao?.perfil !== "cliente") return <Navigate to="/entrar" replace />;

  const cliente = sessao.cliente;

  return (
    <main className="dashboard">
      <div className="shell">
        <div className="dash-header">
          <div>
            <span className="overline">ÁREA DO CLIENTE</span>
            <h1>
              Olá, {cliente.name.split(" ")[0]} <span>✳</span>
            </h1>
            <p>Este é o seu espaço na Ecosol.</p>
          </div>
          <form method="post" action="/api/sair">
            <button className="button button-outline">Sair da conta</button>
          </form>
        </div>

        <div className="dash-grid">
          <section className="dash-card highlight">
            <span className="overline">BEM-VINDO</span>
            <h2>Uma jornada mais clara começa aqui.</h2>
            <p>
              Estamos preparando novas formas de acompanhar sua experiência com
              a Ecosol.
            </p>
            <a className="button button-light" href="/contato">
              Falar com a equipe ↗
            </a>
          </section>
          <section className="dash-card">
            <span className="overline">SEUS DADOS</span>
            <h2>Cadastro</h2>
            <dl>
              <dt>Nome</dt>
              <dd>{cliente.name}</dd>
              <dt>CPF</dt>
              <dd>***.***.***-{cliente.cpf.slice(-2)}</dd>
              <dt>Email</dt>
              <dd>{cliente.email}</dd>
            </dl>
          </section>
        </div>
      </div>
    </main>
  );
}
