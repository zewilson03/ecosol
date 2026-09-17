import { Link, useSearchParams } from "react-router-dom";
import CampoDeCpf from "../componentes/CampoDeCpf";

export default function CadastroDoCliente() {
  const [parametros] = useSearchParams();
  const status = parametros.get("status");
  return (
    <main className="inner-page">
      <div className="shell narrow">
        <Link className="back" to="/entrar">
          ← Voltar ao login
        </Link>
        <div className="form-card">
          <span className="overline">CADASTRO DE TESTE</span>
          <h1>Crie seu acesso</h1>
          <p>
            Informe um CPF válido que ainda não esteja cadastrado e escolha sua
            senha. Este cadastro direto funciona apenas no ambiente local de
            desenvolvimento.
          </p>
          {status === "cpf-invalido" && (
            <div className="alert error" role="alert">
              CPF inválido. Confira o formato e os dígitos verificadores.
            </div>
          )}
          {status === "cpf-existente" && (
            <div className="alert error" role="alert">
              Este CPF já está no banco de dados. Entre na conta existente ou
              use outro CPF de teste.
            </div>
          )}
          {status === "erro" && (
            <div className="alert error" role="alert">
              Confira nome, email e senha. A senha deve ter pelo menos 8
              caracteres e ser igual à confirmação.
            </div>
          )}
          <form
            method="post"
            action="/api/clientes/cadastro"
            className="field-stack"
          >
            <label>
              Nome completo
              <input name="name" autoComplete="name" maxLength={120} required />
            </label>
            <CampoDeCpf id="cpf-cadastro" gerarTeste />
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                maxLength={180}
                required
              />
            </label>
            <label>
              Crie uma senha
              <input
                name="password"
                type="password"
                autoComplete="new-password"
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
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
            </label>
            <button className="button button-primary">
              Cadastrar e ir para o login ↗
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
