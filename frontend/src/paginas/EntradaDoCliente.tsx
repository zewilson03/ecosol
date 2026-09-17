import { Link, useSearchParams } from "react-router-dom";

export default function EntradaDoCliente() {
  const [parametros] = useSearchParams();
  const status = parametros.get("status");
  return (
    <main className="inner-page auth-page">
      <div className="shell auth-layout">
        <div className="auth-side">
          <span className="overline">ÁREA DO CLIENTE</span>
          <h1>
            Sua energia,
            <br />
            <em>seu espaço.</em>
          </h1>
          <p>
            Entre para acessar suas informações e acompanhar sua jornada com a
            Ecosol.
          </p>
          <div className="auth-decoration">✳</div>
        </div>
        <div className="form-card">
          <h2>Bem-vindo de volta</h2>
          <p>Entre com o CPF cadastrado e sua senha.</p>
          {status === "erro" && (
            <div className="alert error" role="alert">
              CPF ou senha inválidos. Tente novamente.
            </div>
          )}
          {status === "senha-definida" && (
            <div className="alert success" role="status">
              Senha definida. Agora você pode entrar.
            </div>
          )}
          {status === "cadastro-criado" && (
            <div className="alert success" role="status">
              Cadastro concluído. Entre com o CPF e a senha que você escolheu.
            </div>
          )}
          <form
            method="post"
            action="/api/clientes/login"
            className="field-stack"
          >
            <label>
              CPF
              <input
                name="cpf"
                inputMode="numeric"
                autoComplete="username"
                required
                placeholder="000.000.000-00"
              />
            </label>
            <label>
              Senha
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="Sua senha"
              />
            </label>
            <button className="button button-primary" type="submit">
              Entrar na minha área <span>↗</span>
            </button>
          </form>
          <div className="form-links">
            {import.meta.env.DEV && (
              <Link to="/cadastro">Cadastrar novo CPF</Link>
            )}
            <Link to="/acesso?tipo=ativar">Ativar cadastro existente</Link>
            <Link to="/acesso?tipo=recuperar">Esqueci minha senha</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
