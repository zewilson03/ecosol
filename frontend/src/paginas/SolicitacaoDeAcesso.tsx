import { Link, useSearchParams } from "react-router-dom";

export default function SolicitacaoDeAcesso() {
  const [parametros] = useSearchParams();
  const tipo = parametros.get("tipo");
  const status = parametros.get("status");
  const reset = tipo === "recuperar";
  return (
    <main className="inner-page">
      <div className="shell narrow">
        <Link className="back" to="/entrar">
          ← Voltar ao login
        </Link>
        <div className="form-card">
          <span className="overline">ACESSO SEGURO</span>
          <h1>{reset ? "Recuperar senha" : "Criar minha senha"}</h1>
          <p>
            Informe o CPF e o email previamente cadastrados na Ecosol. Se os
            dados corresponderem ao cadastro, enviaremos um link válido por 30
            minutos.
          </p>
          {status === "solicitado" && (
            <div className="alert success" role="status">
              Se os dados estiverem cadastrados, você receberá um link para
              continuar.
              {import.meta.env.DEV && (
                <>
                  {" "}
                  Para o teste local, consulte{" "}
                  <Link to="/dev/links">a caixa de links</Link>.
                </>
              )}
            </div>
          )}
          {status === "expirado" && (
            <div className="alert error">
              Link inválido ou expirado. Solicite outro.
            </div>
          )}
          <form
            method="post"
            action="/api/acesso/solicitar"
            className="field-stack"
          >
            <input
              type="hidden"
              name="purpose"
              value={reset ? "reset" : "activate"}
            />
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
              Email cadastrado
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="voce@exemplo.com"
              />
            </label>
            <button className="button button-primary" type="submit">
              Enviar link <span>↗</span>
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
