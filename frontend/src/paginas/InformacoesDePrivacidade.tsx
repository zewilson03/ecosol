import { Link } from "react-router-dom";
export default function InformacoesDePrivacidade() {
  return (
    <main className="inner-page">
      <div className="shell narrow prose">
        <span className="overline">TRANSPARÊNCIA</span>
        <h1>Privacidade</h1>
        <div className="alert error">
          Texto provisório para desenvolvimento. A política definitiva deve ser
          validada pela Ecosol antes da publicação.
        </div>
        <p>
          Usamos os dados enviados pelo formulário de contato para responder às
          solicitações. Para clientes cadastrados, utilizamos CPF e email para
          localizar a conta e verificar solicitações de acesso. A senha é
          armazenada de forma protegida, sem exibição à equipe.
        </p>
        <p>
          O acesso às informações é restrito às pessoas autorizadas. A Ecosol
          deverá definir os prazos de retenção, as bases legais aplicáveis e os
          canais oficiais de atendimento aos titulares antes do lançamento.
        </p>
        <p>
          Para dúvidas sobre seus dados, utilize o{" "}
          <Link to="/contato">formulário de contato</Link>.
        </p>
      </div>
    </main>
  );
}
