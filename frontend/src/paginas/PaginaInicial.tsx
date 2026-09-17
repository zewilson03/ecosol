import { Link } from "react-router-dom";

export default function PaginaInicial() {
  return (
    <main>
      <section className="hero">
        <div className="shell hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="pulse" /> UMA NOVA FORMA DE PENSAR ENERGIA
            </span>
            <h1>
              O futuro é <em>solar.</em>
              <br />e começa com você.
            </h1>
            <p>
              A Ecosol aproxima pessoas e empresas da energia gerada em nossas
              usinas solares, com uma jornada clara, acessível e feita para
              durar.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" to="/contato">
                Quero conhecer a Ecosol <span>↗</span>
              </Link>
              <Link className="text-link" to="#como-funciona">
                Entenda como funciona <span>↓</span>
              </Link>
            </div>
            <div className="hero-note">
              <div className="sun-mini">☀</div>
              <span>
                Mais possibilidades para consumir energia com consciência.
              </span>
            </div>
          </div>
          <div
            className="hero-art"
            aria-label="Ilustração abstrata do sol e de placas solares"
          >
            <div className="sun-disc">
              <div className="sun-ring" />
            </div>
            <div className="solar-panel">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="float-card">
              <span>☀</span>
              <div>
                <strong>Energia do sol</strong>
                <small>Uma escolha para o amanhã</small>
              </div>
            </div>
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
          </div>
        </div>
      </section>
      <section className="benefits">
        <div className="shell benefits-grid">
          <div>
            <span className="benefit-icon">✳</span>
            <strong>Origem solar</strong>
            <p>Energia produzida a partir de uma fonte renovável.</p>
          </div>
          <div>
            <span className="benefit-icon">↗</span>
            <strong>Jornada simples</strong>
            <p>Atendimento próximo em cada etapa da sua experiência.</p>
          </div>
          <div>
            <span className="benefit-icon">◎</span>
            <strong>Visão de futuro</strong>
            <p>Tecnologia e informação para acompanhar a evolução.</p>
          </div>
        </div>
      </section>
      <section className="section how" id="como-funciona">
        <div className="shell">
          <div className="section-heading">
            <div>
              <span className="overline">COMO FUNCIONA</span>
              <h2>
                Uma conexão mais simples
                <br />
                com a energia solar.
              </h2>
            </div>
            <p>
              Estamos construindo uma experiência em que você entende cada
              passo, do primeiro contato ao acompanhamento do seu relacionamento
              com a Ecosol.
            </p>
          </div>
          <div className="steps">
            <article>
              <span className="step-number">01</span>
              <div className="step-icon">✉</div>
              <h3>Converse com a gente</h3>
              <p>
                Conte um pouco sobre seu perfil e sua necessidade. Nossa equipe
                entra em contato para entender seu caso.
              </p>
            </article>
            <article>
              <span className="step-number">02</span>
              <div className="step-icon">◈</div>
              <h3>Conheça a proposta</h3>
              <p>
                Apresentamos as condições do serviço, o funcionamento da
                contratação e os próximos passos.
              </p>
            </article>
            <article>
              <span className="step-number">03</span>
              <div className="step-icon">☀</div>
              <h3>Acompanhe sua jornada</h3>
              <p>
                Clientes cadastrados podem acessar sua área para consultar
                informações e falar com a Ecosol.
              </p>
            </article>
          </div>
        </div>
      </section>
      <section className="about section" id="sobre">
        <div className="shell about-grid">
          <div className="about-art">
            <div className="about-sun">✳</div>
            <span className="about-label">ENERGIA QUE MOVE IDEIAS</span>
          </div>
          <div className="about-copy">
            <span className="overline">SOBRE A ECOSOL</span>
            <h2>
              Mais que energia.
              <br />
              <em>Uma nova perspectiva.</em>
            </h2>
            <p>
              Acreditamos que o acesso à energia solar pode ser mais próximo,
              transparente e descomplicado. A Ecosol trabalha para conectar
              clientes à produção de nossas usinas e construir relações de longo
              prazo.
            </p>
            <p>
              Este espaço é o começo dessa conversa. Aqui você conhece nossa
              proposta, entra em contato e acompanha sua experiência como
              cliente.
            </p>
            <Link className="button button-dark" to="/contato">
              Fale com nossa equipe <span>↗</span>
            </Link>
          </div>
        </div>
      </section>
      <section className="cta">
        <div className="shell cta-inner">
          <div>
            <span className="overline">VAMOS CONVERSAR?</span>
            <h2>
              Seu próximo passo pode
              <br />
              ser <em>movido pelo sol.</em>
            </h2>
          </div>
          <Link className="button button-light" to="/contato">
            Quero saber mais <span>↗</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
