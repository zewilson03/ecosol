import { useMemo, useState } from "react";
import type { Sessao } from "../dadosDaAplicacao";
import {
  CabecalhoDoModulo,
  EstadoDaConsulta,
  ListaVazia,
} from "./ComponentesDoPainel";
import {
  alterarDados,
  consultarServidor,
  formatarData,
  formatarDinheiro,
  usarConsulta,
} from "./comunicacaoComServidor";
import type { Documento } from "./tiposFaturamento";
import "./estilosBancarios.css";

type Operacao = {
  id: string;
  tipo: string;
  ambiente: string;
  origem_id: string;
  valor_centavos: number;
  vencimento: string;
  estado: string;
  criado_em: string;
  atualizado_em: string;
  preparador_nome: string;
  aprovador_nome: string | null;
  total_tentativas: number;
};

type Detalhe = Operacao & {
  snapshot: {
    origem: { nome: string };
    cliente: { nome: string; documento: string };
    unidade: { uc: string; competencia: string };
    cobranca: { valor_centavos: number; vencimento: string };
  };
  intencao: null | {
    estado: string;
    tentativas: number;
    atualizado_em: string;
  };
  tentativas: Array<{
    id: string;
    etapa: string;
    correlacao: string;
    resultado: string | null;
    codigo: string | null;
    iniciado_em: string;
  }>;
  auditoria: Array<{
    ator_nome: string;
    acao: string;
    estado_anterior: string | null;
    estado_novo: string;
    criado_em: string;
  }>;
};

type Executor = {
  modo_configurado: string;
  ambiente: string;
  pausado: boolean;
  alterado_por_nome: string | null;
  alterado_em: string;
};

const nomesEstados: Record<string, string> = {
  aguardando_aprovacao: "Aguardando aprovação",
  aprovada: "Aprovada",
  envio_pendente: "Na fila",
  resultado_desconhecido: "Conferência necessária",
  registrada: "Registrada no simulador",
  rejeitada: "Rejeitada",
  liquidada: "Liquidada",
  falhou: "Falhou",
};
const dataHora = (valor: string) =>
  new Date(
    valor.replace(" ", "T") + (valor.includes("Z") ? "" : "Z"),
  ).toLocaleString("pt-BR");

export default function Bancario() {
  const sessao = usarConsulta<Sessao>("/api/sessao");
  const papeis =
    sessao.dados?.perfil === "equipe" ? sessao.dados.papeis_bancarios : [];
  const podeConsultar = papeis.some((papel) =>
    [
      "consulta_auditoria",
      "operador_financeiro",
      "aprovador_financeiro",
    ].includes(papel),
  );
  const operador = papeis.includes("operador_financeiro");
  const aprovador = papeis.includes("aprovador_financeiro");
  const gestor = papeis.includes("administrador_integracao");
  const operacoes = usarConsulta<Operacao[]>(
    podeConsultar ? "/api/admin/bancario/operacoes" : null,
  );
  const documentos = usarConsulta<Documento[]>(
    operador ? "/api/admin/faturamento/documentos" : null,
  );
  const executor = usarConsulta<Executor>(
    gestor ? "/api/admin/bancario/executor" : null,
  );
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const detalhe = usarConsulta<Detalhe>(
    selecionado ? `/api/admin/bancario/operacoes/${selecionado}` : null,
  );
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");

  const prontas = useMemo(() => {
    const usados = new Set(
      (operacoes.dados ?? []).map((item) => item.origem_id),
    );
    return (documentos.dados ?? []).filter(
      (item) =>
        item.status === "Aprovada — aguardando emissão" &&
        !usados.has(String(item.id)),
    );
  }, [documentos.dados, operacoes.dados]);

  async function executar(acao: () => Promise<unknown>, sucesso: string) {
    if (ocupado) return;
    setOcupado(true);
    setMensagem("");
    setErro("");
    try {
      await acao();
      setMensagem(sucesso);
      operacoes.atualizar();
      detalhe.atualizar();
      executor.atualizar();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const operacao = detalhe.dados;
  return (
    <>
      <CabecalhoDoModulo
        titulo="Banco · homologação"
        descricao="Prepare, aprove e acompanhe cobranças em ambiente seguro, sem comunicação real com o Sicoob."
      >
        <button
          className="admin-botao secundario"
          onClick={operacoes.atualizar}
          disabled={ocupado}
        >
          Atualizar
        </button>
      </CabecalhoDoModulo>

      <div className="bancario-faixa-seguranca">
        <strong>Ambiente de homologação</strong>
        <span>Nenhum boleto real é emitido por esta tela.</span>
      </div>
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
      <EstadoDaConsulta {...sessao} repetir={sessao.atualizar} />

      {gestor && executor.dados && (
        <section className="bancario-executor">
          <div>
            <span className="admin-legenda">EXECUTOR SIMULADO</span>
            <h2>{executor.dados.pausado ? "Pausado" : "Em execução"}</h2>
            <p>
              Modo: {executor.dados.modo_configurado} · ambiente:{" "}
              {executor.dados.ambiente}.
              {executor.dados.modo_configurado === "desligado" &&
                " O processo não está habilitado na configuração local."}
            </p>
          </div>
          <button
            className="admin-botao"
            disabled={
              ocupado || executor.dados.modo_configurado === "desligado"
            }
            onClick={() =>
              executar(
                () =>
                  alterarDados(
                    "/api/admin/bancario/executor",
                    { pausado: !executor.dados!.pausado },
                    "PATCH",
                  ),
                executor.dados!.pausado
                  ? "Executor retomado."
                  : "Executor pausado.",
              )
            }
          >
            {executor.dados.pausado ? "Retomar simulador" : "Pausar simulador"}
          </button>
        </section>
      )}
      {gestor && (
        <EstadoDaConsulta {...executor} repetir={executor.atualizar} />
      )}

      {operador && (
        <section className="bancario-preparar">
          <div>
            <span className="admin-legenda">COBRANÇAS APROVADAS</span>
            <h2>Preparar para aprovação bancária</h2>
            <p>
              O sistema congela uma cópia dos valores aprovados e impede a
              emissão duplicada.
            </p>
          </div>
          <EstadoDaConsulta {...documentos} repetir={documentos.atualizar} />
          {!documentos.carregando &&
            !documentos.erro &&
            prontas.length === 0 && (
              <p>Nenhuma fatura aprovada aguarda preparação.</p>
            )}
          <div className="bancario-documentos">
            {prontas.map((documento) => (
              <div key={documento.id}>
                <span>
                  <strong>{documento.nome}</strong>
                  <small>Documento #{documento.id}</small>
                </span>
                <button
                  className="admin-botao"
                  disabled={ocupado}
                  onClick={() =>
                    executar(async () => {
                      const resposta = await consultarServidor<{
                        operacao: Operacao;
                      }>("/api/admin/bancario/operacoes/cobrancas", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ documento_id: documento.id }),
                      });
                      setSelecionado(resposta.operacao.id);
                    }, "Cobrança preparada. Outra pessoa deve aprová-la.")
                  }
                >
                  Preparar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {podeConsultar ? (
        <div className="bancario-grade">
          <section className="bancario-lista">
            <div className="bancario-secao-titulo">
              <div>
                <span className="admin-legenda">OPERAÇÕES</span>
                <h2>Fila bancária</h2>
              </div>
              <span>{operacoes.dados?.length ?? 0} registros</span>
            </div>
            <EstadoDaConsulta {...operacoes} repetir={operacoes.atualizar} />
            {!operacoes.carregando &&
              !operacoes.erro &&
              operacoes.dados?.length === 0 && (
                <ListaVazia texto="Prepare uma cobrança aprovada para iniciar a homologação." />
              )}
            {operacoes.dados?.map((item) => (
              <button
                key={item.id}
                className={`bancario-operacao${selecionado === item.id ? " ativo" : ""}`}
                onClick={() => setSelecionado(item.id)}
              >
                <span>
                  <strong>{formatarDinheiro(item.valor_centavos)}</strong>
                  <small>Vence {formatarData(item.vencimento)}</small>
                </span>
                <span>
                  <b className={`bancario-status ${item.estado}`}>
                    {nomesEstados[item.estado] ?? item.estado}
                  </b>
                  <small>{item.preparador_nome}</small>
                </span>
              </button>
            ))}
          </section>

          <section className="bancario-detalhe">
            {!selecionado ? (
              <div className="admin-vazio">
                <span aria-hidden="true">▣</span>
                <h3>Selecione uma operação</h3>
                <p>Veja valores, responsáveis, tentativas e histórico.</p>
              </div>
            ) : (
              <>
                <EstadoDaConsulta {...detalhe} repetir={detalhe.atualizar} />
                {operacao && (
                  <>
                    <div className="bancario-secao-titulo">
                      <div>
                        <span className="admin-legenda">DETALHES</span>
                        <h2>{operacao.snapshot.origem.nome}</h2>
                      </div>
                      <b className={`bancario-status ${operacao.estado}`}>
                        {nomesEstados[operacao.estado] ?? operacao.estado}
                      </b>
                    </div>
                    <dl className="bancario-resumo">
                      <div>
                        <dt>Cliente</dt>
                        <dd>{operacao.snapshot.cliente.nome}</dd>
                      </div>
                      <div>
                        <dt>Documento protegido</dt>
                        <dd>{operacao.snapshot.cliente.documento}</dd>
                      </div>
                      <div>
                        <dt>UC</dt>
                        <dd>{operacao.snapshot.unidade.uc}</dd>
                      </div>
                      <div>
                        <dt>Competência</dt>
                        <dd>{operacao.snapshot.unidade.competencia}</dd>
                      </div>
                      <div>
                        <dt>Valor</dt>
                        <dd>{formatarDinheiro(operacao.valor_centavos)}</dd>
                      </div>
                      <div>
                        <dt>Vencimento</dt>
                        <dd>{formatarData(operacao.vencimento)}</dd>
                      </div>
                      <div>
                        <dt>Preparado por</dt>
                        <dd>{operacao.preparador_nome}</dd>
                      </div>
                      <div>
                        <dt>Aprovado por</dt>
                        <dd>
                          {operacao.aprovador_nome ?? "Ainda não aprovado"}
                        </dd>
                      </div>
                    </dl>
                    <div className="bancario-acoes">
                      {aprovador &&
                        operacao.estado === "aguardando_aprovacao" && (
                          <button
                            className="admin-botao"
                            disabled={ocupado}
                            onClick={() =>
                              executar(
                                () =>
                                  consultarServidor(
                                    `/api/admin/bancario/operacoes/${operacao.id}/aprovar`,
                                    { method: "POST" },
                                  ),
                                "Operação aprovada.",
                              )
                            }
                          >
                            Aprovar operação
                          </button>
                        )}
                      {operador && operacao.estado === "aprovada" && (
                        <button
                          className="admin-botao"
                          disabled={ocupado}
                          onClick={() =>
                            executar(
                              () =>
                                consultarServidor(
                                  `/api/admin/bancario/operacoes/${operacao.id}/enfileirar`,
                                  { method: "POST" },
                                ),
                              "Operação colocada na fila simulada.",
                            )
                          }
                        >
                          Enviar à fila simulada
                        </button>
                      )}
                    </div>
                    <div className="bancario-historicos">
                      <div>
                        <h3>Tentativas técnicas</h3>
                        {operacao.tentativas.length === 0 ? (
                          <p>Nenhuma tentativa realizada.</p>
                        ) : (
                          operacao.tentativas.map((item) => (
                            <p key={item.id}>
                              <strong>{item.etapa}</strong> ·{" "}
                              {item.resultado ?? "em andamento"}
                              <small>
                                {item.codigo ?? "Sem código"} ·{" "}
                                {dataHora(item.iniciado_em)}
                              </small>
                            </p>
                          ))
                        )}
                      </div>
                      <div>
                        <h3>Trilha de auditoria</h3>
                        {operacao.auditoria.map((item, indice) => (
                          <p key={`${item.criado_em}-${indice}`}>
                            <strong>{item.acao}</strong>
                            <small>
                              {item.ator_nome} · {dataHora(item.criado_em)}
                            </small>
                          </p>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      ) : (
        !sessao.carregando && (
          <p className="admin-aviso">
            Sua função permite administrar o executor, mas não visualizar dados
            financeiros das operações.
          </p>
        )
      )}
    </>
  );
}
