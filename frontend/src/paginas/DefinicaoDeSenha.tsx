import { useSearchParams, Link } from "react-router-dom";
import { usarDados } from "../dadosDaAplicacao";

export default function DefinicaoDeSenha() {
  const [parametros] = useSearchParams();
  const token = parametros.get("token") ?? "";
  const status = parametros.get("status");
  const { dados, carregando } = usarDados<{ valido: boolean }>(
    `/api/acesso/validar?token=${encodeURIComponent(token)}`,
  );

  return (
    <main className="inner-page">
      <div className="shell narrow">
        <div className="form-card">
          <span className="overline">ACESSO SEGURO</span>
          <h1>Definir senha</h1>

          {carregando ? (
            <p>Verificando seu link...</p>
          ) : !dados?.valido ? (
            <>
              <p>Este link é inválido ou expirou. Solicite um novo link.</p>
              <Link className="button button-primary" to="/acesso">
                Solicitar novo link ↗
              </Link>
            </>
          ) : (
            <>
              <p>Escolha uma senha com pelo menos 8 caracteres.</p>
              {status === "erro" && (
                <div className="alert error" role="alert">
                  As senhas devem ser iguais e ter entre 8 e 128 caracteres.
                </div>
              )}
              <form
                method="post"
                action="/api/acesso/definir-senha"
                className="field-stack"
              >
                <input type="hidden" name="token" value={token} />
                <label>
                  Nova senha
                  <input
                    name="password"
                    type="password"
                    minLength={8}
                    maxLength={128}
                    required
                  />
                </label>
                <label>
                  Confirme a senha
                  <input
                    name="confirm"
                    type="password"
                    minLength={8}
                    maxLength={128}
                    required
                  />
                </label>
                <button className="button button-primary">
                  Salvar senha ↗
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
