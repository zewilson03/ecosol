import { useEffect, useRef, useState } from "react";
import {
  consultarServidorBancario,
  formatarData,
  usarConsulta,
} from "./comunicacaoComServidor";
import { EstadoDaConsulta, ListaVazia } from "./ComponentesDoPainel";
import {
  duracaoNoEstado,
  formatarValorBancario,
  ordenarPendencias,
  podeConciliarPendencia,
} from "./observabilidadeBancariaApresentacao";

type Contagens = Record<string, number>;

type PendenciaBancaria = {
  operacao_id: string;
  tipo: string;
  ambiente: string;
  moeda: string;
  valor_centavos: number;
  vencimento: string;
  estado: string;
  idade_estado_segundos: number | null;
  atualizado_em: string;
  provedor_identificado: boolean;
  ultima_tentativa: null | {
    resultado: string | null;
    codigo: string | null;
    iniciado_em: string;
  };
  reconciliacao: null | {
    estado: string;
    codigo: string | null;
    tentativa: number;
    posse_expirada: boolean;
  };
  historico_conciliacao: Array<{
    estado: string;
    estado_anterior: string;
    estado_observado: string | null;
    codigo: string | null;
    tentativa: number;
    solicitado_por: string;
    iniciado_em: string;
    concluido_em: string | null;
  }>;
  acao_necessaria: string | null;
  prioridade: "alta" | "media" | "informativa";
};

type Observabilidade = {
  gerado_em: string;
  ambiente: string;
  executor: {
    pausado: boolean;
    modo: string;
    alterado_em: string | null;
  };
  resumo: {
    operacoes_por_estado: Contagens;
    intencoes_por_estado: Contagens;
    reconciliacoes_por_estado: Contagens;
    pendencias_total: number;
    pendencias_listadas: number;
    exigem_intervencao: number;
    resultado_limitado: boolean;
  };
  pendencias: PendenciaBancaria[];
  limite: number;
};

const nomesDasAcoes: Record<string, string> = {
  APROVAR_OPERACAO: "Aprovar operação",
  ENFILEIRAR_OPERACAO: "Enfileirar operação",
  CONCILIAR_COBRANCA: "Conciliar cobrança",
  REVISAR_FALHA: "Revisar falha",
  ACOMPANHAR_CANCELAMENTO: "Acompanhar cancelamento",
  ACOMPANHAR_PAGAMENTO: "Acompanhar pagamento",
  RECUPERAR_CONCILIACAO: "Recuperar conciliação",
  REVISAR_CONCILIACAO: "Revisar conciliação",
  ACOMPANHAR_ENVIO: "Acompanhar envio",
};

const nomesDosEstados: Record<string, string> = {
  aguardando_aprovacao: "Aguardando aprovação",
  aprovada: "Aprovada",
  envio_pendente: "Na fila",
  resultado_desconhecido: "Resultado desconhecido",
  registrada: "Registrada",
  rejeitada: "Rejeitada",
  liquidada: "Liquidada",
  falhou: "Falhou",
};

function total(contagens: Contagens) {
  return Object.values(contagens).reduce(
    (soma, quantidade) => soma + quantidade,
    0,
  );
}

function dataHora(valor: string) {
  return new Date(valor).toLocaleString("pt-BR");
}

function mensagemDaFalha(falha: Error & { codigo?: string }) {
  const mensagens: Record<string, string> = {
    CONCILIACAO_EM_ANDAMENTO:
      "Esta cobrança já está sendo consultada. Atualize a central em instantes.",
    CONCILIACAO_SEM_NOSSO_NUMERO:
      "A cobrança não possui identificador bancário seguro para consulta.",
    CONCILIACAO_LIMITE_ATINGIDO:
      "O limite de consultas desta cobrança foi atingido. Aguarde 15 minutos.",
    CONCILIACAO_MANUAL_INDISPONIVEL:
      "A consulta manual está indisponível neste ambiente.",
    SIM_CONSULTA_INDISPONIVEL:
      "O simulador está indisponível. A cobrança não foi alterada e a tentativa ficou registrada.",
    CONCILIACAO_FALHA_INTERNA:
      "A consulta falhou de forma inesperada. A cobrança não foi alterada.",
  };
  return mensagens[falha.codigo ?? ""] ?? falha.message;
}

export default function ObservabilidadeBancaria({
  podeConciliar = false,
}: {
  podeConciliar?: boolean;
}) {
  const consulta = usarConsulta<Observabilidade>(
    "/api/admin/bancario/observabilidade?limite=50",
  );
  const dados = consulta.dados;
  const pendenciasOrdenadas = dados ? ordenarPendencias(dados.pendencias) : [];
  const [processando, setProcessando] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [confirmacao, setConfirmacao] = useState<PendenciaBancaria | null>(
    null,
  );
  const painelConfirmacao = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!confirmacao) return;
    const focoAnterior =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controlarTeclado = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        evento.preventDefault();
        setConfirmacao(null);
        return;
      }
      if (evento.key !== "Tab" || !painelConfirmacao.current) return;
      const elementos = Array.from(
        painelConfirmacao.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!elementos.length) return;
      const primeiro = elementos[0];
      const ultimo = elementos[elementos.length - 1];
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    };
    window.addEventListener("keydown", controlarTeclado);
    return () => {
      window.removeEventListener("keydown", controlarTeclado);
      document.body.style.overflow = overflowAnterior;
      focoAnterior?.focus();
    };
  }, [confirmacao]);

  async function conciliar(operacaoId: string) {
    if (processando) return;
    setProcessando(operacaoId);
    setMensagem("");
    setErro("");
    try {
      const resposta = await consultarServidorBancario<{
        resultado: string;
        estado_atual?: string;
        codigo: string;
      }>(`/api/admin/bancario/operacoes/${operacaoId}/conciliar`, {
        method: "POST",
      });
      if (resposta.resultado === "concluida")
        setMensagem(
          `Consulta concluída. Estado atual: ${nomesDosEstados[resposta.estado_atual ?? ""] ?? resposta.estado_atual}.`,
        );
      else if (resposta.codigo === "CONCILIACAO_PROVEDOR_DIVERGENTE")
        setMensagem(
          "O identificador retornado diverge do cadastro. Nenhum estado financeiro foi alterado.",
        );
      else if (resposta.codigo === "SIM_NAO_ENCONTRADA")
        setMensagem(
          "A cobrança não foi encontrada no simulador. Ela permaneceu pendente para conferência.",
        );
      else if (resposta.codigo === "CONCILIACAO_POSSE_PERDIDA")
        setMensagem(
          "Outra consulta assumiu esta cobrança. A central foi atualizada sem aplicar a resposta antiga.",
        );
      else
        setMensagem(
          "A cobrança não foi confirmada pelo simulador e permaneceu pendente para revisão.",
        );
      await consulta.atualizar();
    } catch (falha) {
      setErro(mensagemDaFalha(falha as Error & { codigo?: string }));
      await consulta.atualizar();
    } finally {
      setProcessando(null);
    }
  }

  return (
    <section
      className="bancario-observabilidade"
      aria-labelledby="observabilidade-titulo"
    >
      <header className="bancario-observabilidade-cabecalho">
        <div>
          <span className="admin-legenda">VISÃO OPERACIONAL</span>
          <h2 id="observabilidade-titulo">Saúde da integração</h2>
          <p>
            Acompanhe pendências e, com permissão reforçada, consulte novamente
            uma cobrança sem emitir um novo boleto.
          </p>
        </div>
        <button
          className="admin-botao secundario"
          onClick={consulta.atualizar}
          disabled={consulta.carregando}
        >
          {consulta.carregando ? "Atualizando…" : "Atualizar visão"}
        </button>
      </header>

      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
      {confirmacao && (
        <div className="bancario-confirmacao-fundo" role="presentation">
          <section
            ref={painelConfirmacao}
            className="bancario-confirmacao"
            role="dialog"
            aria-modal="true"
            aria-labelledby="conciliacao-confirmacao-titulo"
          >
            <span className="admin-legenda">CONFIRMAÇÃO DE CONSULTA</span>
            <h3 id="conciliacao-confirmacao-titulo">
              Consultar esta cobrança?
            </h3>
            <p>
              Confira os dados antes de confirmar. A ação consulta o simulador e
              não emite outro boleto.
            </p>
            <dl>
              <div>
                <dt>Valor</dt>
                <dd>
                  {formatarValorBancario(
                    confirmacao.valor_centavos,
                    confirmacao.moeda,
                  )}
                </dd>
              </div>
              <div>
                <dt>Vencimento</dt>
                <dd>{formatarData(confirmacao.vencimento)}</dd>
              </div>
              <div>
                <dt>Estado atual</dt>
                <dd>
                  {nomesDosEstados[confirmacao.estado] ?? confirmacao.estado}
                </dd>
              </div>
              <div>
                <dt>Operação local</dt>
                <dd>{confirmacao.operacao_id.slice(0, 8)}</dd>
              </div>
            </dl>
            <div className="bancario-confirmacao-acoes">
              <button
                className="admin-botao secundario"
                onClick={() => setConfirmacao(null)}
                autoFocus
              >
                Cancelar
              </button>
              <button
                className="admin-botao"
                onClick={() => {
                  const id = confirmacao.operacao_id;
                  setConfirmacao(null);
                  window.setTimeout(() => void conciliar(id), 0);
                }}
              >
                Confirmar e autenticar
              </button>
            </div>
          </section>
        </div>
      )}
      {mensagem && (
        <p className="admin-aviso sucesso" role="status">
          {mensagem}
        </p>
      )}
      {erro && (
        <p className="admin-aviso erro" role="alert">
          {erro}
        </p>
      )}
      {dados && (
        <>
          <div className="bancario-observabilidade-resumo">
            <article>
              <span>Executor</span>
              <strong className={dados.executor.pausado ? "alerta" : "estavel"}>
                {dados.executor.pausado ? "Pausado" : "Em execução"}
              </strong>
              <small>
                {dados.executor.modo} · {dados.ambiente}
              </small>
            </article>
            <article>
              <span>Operações</span>
              <strong>{total(dados.resumo.operacoes_por_estado)}</strong>
              <small>em todos os estados</small>
            </article>
            <article>
              <span>Conciliações</span>
              <strong>{total(dados.resumo.reconciliacoes_por_estado)}</strong>
              <small>registradas localmente</small>
            </article>
            <article>
              <span>Exigem intervenção</span>
              <strong
                className={
                  dados.resumo.exigem_intervencao ? "critico" : "estavel"
                }
              >
                {dados.resumo.exigem_intervencao}
              </strong>
              <small>entre {dados.resumo.pendencias_total} pendências</small>
            </article>
          </div>

          <div className="bancario-observabilidade-lista">
            <div className="bancario-secao-titulo">
              <div>
                <span className="admin-legenda">PRIORIDADES</span>
                <h3>Pendências operacionais</h3>
              </div>
              <small>Gerado em {dataHora(dados.gerado_em)}</small>
            </div>
            {dados.resumo.resultado_limitado && (
              <p className="bancario-observabilidade-limite" role="status">
                Exibindo {dados.resumo.pendencias_listadas} de{" "}
                {dados.resumo.pendencias_total} pendências, priorizadas por
                urgência.
              </p>
            )}
            {pendenciasOrdenadas.length === 0 ? (
              <ListaVazia texto="Nenhuma pendência bancária foi encontrada." />
            ) : (
              pendenciasOrdenadas.map((item) => (
                <article
                  className={`bancario-pendencia prioridade-${item.prioridade}`}
                  key={item.operacao_id}
                >
                  <div className="bancario-pendencia-principal">
                    <span className={`bancario-prioridade ${item.prioridade}`}>
                      {item.prioridade === "alta"
                        ? "Alta"
                        : item.prioridade === "media"
                          ? "Média"
                          : "Informativa"}
                    </span>
                    <div>
                      <strong>
                        {nomesDasAcoes[item.acao_necessaria ?? ""] ??
                          "Acompanhar operação"}
                      </strong>
                      <small>
                        {nomesDosEstados[item.estado] ?? item.estado} ·{" "}
                        {duracaoNoEstado(item.idade_estado_segundos)}
                      </small>
                    </div>
                  </div>
                  <dl>
                    <div>
                      <dt>Valor</dt>
                      <dd>
                        {formatarValorBancario(item.valor_centavos, item.moeda)}
                      </dd>
                    </div>
                    <div>
                      <dt>Vencimento</dt>
                      <dd>{formatarData(item.vencimento)}</dd>
                    </div>
                    <div>
                      <dt>Operação</dt>
                      <dd title={item.operacao_id}>
                        {item.operacao_id.slice(0, 8)}
                      </dd>
                    </div>
                    <div>
                      <dt>Provedor</dt>
                      <dd>
                        {item.provedor_identificado
                          ? "Identificado"
                          : "Sem identificação"}
                      </dd>
                    </div>
                  </dl>
                  {(item.reconciliacao || item.ultima_tentativa?.codigo) && (
                    <p className="bancario-pendencia-contexto">
                      {item.reconciliacao &&
                        `Conciliação: ${item.reconciliacao.estado}${item.reconciliacao.posse_expirada ? " · posse expirada" : ""}. `}
                      {item.ultima_tentativa?.codigo &&
                        `Código: ${item.ultima_tentativa.codigo}.`}
                    </p>
                  )}
                  {item.historico_conciliacao.length > 0 && (
                    <details className="bancario-conciliacao-historico">
                      <summary>
                        Histórico de conciliações (
                        {item.historico_conciliacao.length})
                      </summary>
                      <ol>
                        {item.historico_conciliacao.map((registro) => (
                          <li
                            key={`${registro.tentativa}-${registro.iniciado_em}`}
                          >
                            <strong>Tentativa {registro.tentativa}</strong>
                            <span>
                              {registro.solicitado_por} ·{" "}
                              {dataHora(registro.iniciado_em)}
                            </span>
                            <span>
                              {registro.estado_anterior} →{" "}
                              {registro.estado_observado ?? registro.estado} ·{" "}
                              {registro.codigo ?? "sem código"}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                  {podeConciliar && podeConciliarPendencia(item) && (
                    <div className="bancario-pendencia-acoes">
                      <button
                        className="admin-botao secundario"
                        disabled={Boolean(processando)}
                        onClick={() => setConfirmacao(item)}
                      >
                        {processando === item.operacao_id
                          ? "Consultando…"
                          : "Consultar no simulador"}
                      </button>
                      <small>
                        Exige senha e MFA; não cria uma nova cobrança.
                      </small>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
