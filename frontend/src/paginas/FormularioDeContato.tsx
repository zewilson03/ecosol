import { Link, useSearchParams } from "react-router-dom";

export default function FormularioDeContato() {
  const [parametros] = useSearchParams();
  const status = parametros.get("status");
  return (
    <main className="inner-page">
      <div className="shell form-layout">
        <div className="form-intro">
          <span className="overline">FALE COM A ECOSOL</span>
          <h1>
            Vamos começar uma <em>boa conversa?</em>
          </h1>
          <p>
            Preencha os dados ao lado e nossa equipe entrará em contato para
            entender como a Ecosol pode ajudar você.
          </p>
          <div className="info-box">
            <span>✳</span>
            <div>
              <strong>Atendimento próximo</strong>
              <p>
                Seu contato será registrado para que nossa equipe possa
                acompanhar a solicitação.
              </p>
            </div>
          </div>
        </div>
        <div className="form-card">
          <h2>Conte sobre você</h2>
          <p>Todos os campos são necessários para responder sua solicitação.</p>
          {status === "enviado" && (
            <div className="alert success" role="status">
              Mensagem recebida! A equipe Ecosol entrará em contato.
            </div>
          )}
          {status === "erro" && (
            <div className="alert error" role="alert">
              Confira os dados e tente novamente.
            </div>
          )}
          <form method="post" action="/api/contatos" className="field-stack">
            <label>
              Nome completo
              <input
                name="name"
                autoComplete="name"
                maxLength={120}
                required
                placeholder="Seu nome"
              />
            </label>
            <div className="field-row">
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={180}
                  required
                  placeholder="voce@exemplo.com"
                />
              </label>
              <label>
                Telefone
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  maxLength={30}
                  required
                  placeholder="(00) 00000-0000"
                />
              </label>
            </div>
            <label>
              Cidade / Estado
              <input
                name="city"
                maxLength={100}
                required
                placeholder="Onde você está?"
              />
            </label>
            <label>
              Como podemos ajudar?
              <textarea
                name="message"
                maxLength={1500}
                required
                rows={5}
                placeholder="Conte um pouco sobre o que você procura"
              />
            </label>
            <input
              name="website"
              className="honey"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
            />
            <button className="button button-primary" type="submit">
              Enviar mensagem <span>↗</span>
            </button>
            <small>
              Ao enviar, você concorda com o tratamento dos dados para retorno
              do contato. Leia nossa{" "}
              <Link to="/privacidade">política de privacidade</Link>.
            </small>
          </form>
        </div>
      </div>
    </main>
  );
}
