import { Navigate, useSearchParams } from "react-router-dom";
import { Sessao, usarDados } from "../dadosDaAplicacao";

export default function PainelDaEquipe() {
  const [parametros] = useSearchParams();
  const status = parametros.get("status");
  const { dados: sessao, carregando } = usarDados<Sessao>("/api/sessao");

  if (carregando)
    return <main className="inner-page shell">Carregando...</main>;

  if (sessao?.perfil !== "equipe") {
    return (
      <main className="inner-page">
        <div className="shell narrow">
          <div className="form-card">
            <span className="overline">ACESSO DA EQUIPE</span>
            <h1>Área administrativa</h1>
            <p>
              Entre com seu email e senha para acessar o painel administrativo.
            </p>
            {status === "erro" && (
              <div className="alert error">Email ou senha inválidos.</div>
            )}
            {status === "bootstrap-erro" && (
              <div className="alert error">
                A senha inicial não confere ou o primeiro administrador já foi
                criado. Confira ADMIN_PASSWORD no arquivo backend/.env.local.
              </div>
            )}

            <form
              method="post"
              action="/api/equipe/login"
              className="field-stack"
            >
              <label>
                Email do administrador
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Senha
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <button className="button button-primary">
                Entrar como administrador ↗
              </button>
            </form>

            <details className="bootstrap-access">
              <summary>Primeiro acesso com senha do projeto</summary>
              <p>
                Use ADMIN_PASSWORD do arquivo backend/.env.local para criar seu
                primeiro administrador.
              </p>
              <form
                method="post"
                action="/api/equipe/entrada-inicial"
                className="field-stack"
              >
                <label>
                  Senha inicial da equipe
                  <input name="password" type="password" required />
                </label>
                <button className="button button-outline">
                  Entrar com senha inicial
                </button>
              </form>
            </details>
          </div>
        </div>
      </main>
    );
  }

  return <Navigate to="/admin/usinas" replace />;
}
