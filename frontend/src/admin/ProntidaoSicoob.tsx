import { EstadoDaConsulta } from "./ComponentesDoPainel";
import { usarConsulta } from "./comunicacaoComServidor";
import {
  estadoDaProntidao,
  nomeDaPendenciaSicoob,
} from "./prontidaoSicoobApresentacao";

type Prontidao = {
  estado: string;
  ambiente: string | null;
  contrato_versao?: string;
  executor_modo?: string;
  executor_pausado: boolean;
  configuracao_consulta_completa: boolean;
  configuracao_emissao_completa: boolean;
  executor_real_disponivel: boolean;
  producao_habilitada?: boolean;
  configuracao?: {
    conta_referencia: boolean;
    api: boolean;
    oauth: boolean;
    escopo_oauth: boolean;
    mtls: boolean;
    convenio_consulta: boolean;
    convenio_emissao: boolean;
  };
  pendencias: string[];
};

const nomesDosItens: Record<string, string> = {
  conta_referencia: "Referência da conta",
  api: "API oficial",
  oauth: "OAuth",
  escopo_oauth: "Escopos",
  mtls: "Certificado mTLS",
  convenio_consulta: "Convênio para consulta",
  convenio_emissao: "Convênio para emissão",
};

export default function ProntidaoSicoob() {
  const consulta = usarConsulta<Prontidao>("/api/admin/bancario/prontidao");
  const dados = consulta.dados;
  const estado = dados
    ? estadoDaProntidao({
        configuracaoConsultaCompleta: dados.configuracao_consulta_completa,
        configuracaoEmissaoCompleta: dados.configuracao_emissao_completa,
        executorRealDisponivel: dados.executor_real_disponivel,
        executorPausado: dados.executor_pausado,
        producaoHabilitada: dados.producao_habilitada === true,
      })
    : null;

  return (
    <section className="bancario-prontidao" aria-labelledby="prontidao-titulo">
      <header className="bancario-prontidao-cabecalho">
        <div>
          <span className="admin-legenda">PORTÕES DE LIBERAÇÃO</span>
          <h2 id="prontidao-titulo">Prontidão Sicoob</h2>
          <p>
            Verifica somente a presença e a suficiência das configurações. Os
            valores e segredos nunca são exibidos.
          </p>
        </div>
        <button
          className="admin-botao secundario"
          onClick={consulta.atualizar}
          disabled={consulta.carregando}
        >
          {consulta.carregando ? "Verificando…" : "Verificar novamente"}
        </button>
      </header>

      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
      {dados && estado && (
        <>
          <div className="bancario-prontidao-estado">
            <div>
              <span>Situação</span>
              <strong className={estado.nivel}>{estado.rotulo}</strong>
            </div>
            <div>
              <span>Ambiente</span>
              <strong>{dados.ambiente ?? "Não identificado"}</strong>
              <small>
                Produção:{" "}
                {dados.producao_habilitada ? "autorizada" : "bloqueada"}
              </small>
            </div>
            <div>
              <span>Contrato</span>
              <strong>{dados.contrato_versao ?? "Não informado"}</strong>
            </div>
            <div>
              <span>Executor</span>
              <strong>
                {dados.executor_real_disponivel
                  ? dados.executor_pausado
                    ? "Pausado"
                    : "Ativo"
                  : "Não implementado"}
              </strong>
            </div>
          </div>

          <div className="bancario-prontidao-portoes">
            {Object.entries(dados.configuracao ?? {}).map(
              ([chave, completo]) => (
                <div key={chave} className={completo ? "completo" : "pendente"}>
                  <span aria-hidden="true">{completo ? "✓" : "!"}</span>
                  <div>
                    <strong>{nomesDosItens[chave] ?? chave}</strong>
                    <small>{completo ? "Configurado" : "Pendente"}</small>
                  </div>
                </div>
              ),
            )}
          </div>

          <div className="bancario-prontidao-avisos">
            <div>
              <h3>Pendências</h3>
              {dados.pendencias.length ? (
                <ul>
                  {dados.pendencias.map((codigo) => (
                    <li key={codigo}>{nomeDaPendenciaSicoob(codigo)}</li>
                  ))}
                </ul>
              ) : (
                <p>Nenhuma pendência de configuração foi detectada.</p>
              )}
            </div>
            <div className="bancario-prontidao-bloqueio">
              <strong>
                {dados.producao_habilitada
                  ? "Produção habilitada com controle operacional"
                  : "Produção permanece bloqueada"}
              </strong>
              <p>
                {dados.producao_habilitada
                  ? "A fila continua dependente do estado pausado e da liberação humana antes do primeiro envio."
                  : "Configuração completa não autoriza emissão. O executor real e a liberação humana continuam sendo portões independentes."}
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
