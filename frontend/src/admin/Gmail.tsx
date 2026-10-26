import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  alterarDados,
  consultarServidor,
  formatarData,
  usarConsulta,
} from "./comunicacaoComServidor";
import {
  CabecalhoDoModulo,
  EstadoDaConsulta,
  ListaVazia,
} from "./ComponentesDoPainel";
import { usarAdministrador } from "./EstruturaAdministrativa";

type ContaGmail = {
  id: number;
  email: string;
  data_inicio: string;
  status_autorizacao: "nao_conectada" | "conectada" | "reconectar";
  pausada: boolean | number;
  identidade_verificada?: string | boolean | null;
};

type ContasGmail = { contas: ContaGmail[]; configurado: boolean };
type RetornoOAuth = "conectada" | "recusada" | "expirada" | "falha";
type Contagem = { estado: string; quantidade: number };
type ProgressoGmail = {
  fase: "inicial" | "historico" | "revarredura";
  ultimaConclusaoEm: number | null;
  ultimaExecucaoEm: number | null;
  ultimoErroCodigo: string | null;
  emAndamento: boolean;
  mensagens: Contagem[];
  anexos: Contagem[];
};
type PendenciaGmail = {
  id: number;
  estado: string;
  erroCodigo: string | null;
  nome?: string;
};
type PendenciasGmail = {
  mensagens: PendenciaGmail[];
  anexos: PendenciaGmail[];
  proximaMensagem: number | null;
  proximoAnexo: number | null;
};
type ItemTriagemGmail = {
  id: number;
  nome: string;
  classificacao: "triagem" | "nao_fatura";
  versao: number;
};
type PaginaTriagemGmail = {
  itens: ItemTriagemGmail[];
  proximoAntes: number | null;
  contagens: { classificacao: string; quantidade: number }[];
};
type ItemConferenciaGmail = {
  id: number;
  anexoId: number;
  messageId: string;
  recebidoEm: string;
  nome: string;
  uc: string | null;
  competencia: string | null;
  vencimento: string | null;
  cliente: string | null;
  usina: string | null;
  unidadeId: number | null;
  nomeProposto: string | null;
  situacao: "vinculo_seguro" | "revisar";
  versao: number;
  previaCentralDisponivel: boolean;
  metodo: string;
};
type SimulacaoCentral = {
  documento: number;
  situacao: "simulada" | "revisar";
  motivos?: string[];
  motivo?: string;
  ucNova?: string;
  ucAntiga?: string;
  cliente?: string;
  usina?: string;
  competencia?: string;
  mesFaturamento?: string;
  planilha?: string;
  aba?: string;
  linha?: number;
  dadosFatura?: { energia?: string; tarifa?: string };
  descontoContratual?: string;
  valorBoleto?: string;
};
type PreviaPeriodoGmail = {
  inicio: string;
  fim: string;
  fuso: string;
  emails: number;
  anexos: number;
};
type CapturaPeriodo = {
  id: number;
  estado: "em_andamento" | "concluida" | "falha";
  emails: number;
  anexos: number;
  capturados: number;
  duplicados: number;
  triagem: number;
  falhas: number;
  erro_codigo?: string | null;
  proxima_tentativa_em?: number | null;
};
type ItemPreparacaoCentral = {
  id: number;
  nome: string;
  classificacao: string;
  competencia: string | null;
  situacao: "preparado" | "revisar";
  modo: "financeiro" | "documental" | null;
  motivos: string[];
  simulacao?: SimulacaoCentral | null;
  documental?: {
    situacao: "pronto" | "revisar";
    motivo?: string;
    nomeFinal?: string;
  } | null;
};
type PreparacaoCentralLote = {
  resumo: {
    totalCapturado: number;
    documentosNoLote: number;
    identificadosDocumentalmente: number;
    documentosDocumentaisProntos: number;
    revisaoDocumental: number;
    financeiramenteAptos: number;
    revisaoFinanceira: number;
    elegiveis: number;
    preparados: number;
    revisar: number;
    processados: number;
    falhas: number;
    pdfsProntosParaImpressao: number;
  };
  itens: ItemPreparacaoCentral[];
};

function quantidade(estados: Contagem[], estado: string) {
  return estados.find((item) => item.estado === estado)?.quantidade ?? 0;
}

function instante(valor: number | null) {
  return valor ? new Date(valor).toLocaleString("pt-BR") : "Ainda não ocorreu";
}

const base = "/api/admin/gmail/contas";
function moeda(valor?: string) {
  return valor === undefined ? "não encontrado" : `R$ ${valor}`;
}
function motivoCurto(motivos: string[]) {
  const motivo = motivos[0] ?? "revisao_necessaria";
  if (motivo.startsWith("localizacao_central_indisponivel"))
    return "Localização temporariamente indisponível";
  if (motivo.includes("vinculo_cadastral_incompleto"))
    return "Vínculo cadastral incompleto";
  if (motivo.startsWith("linha_da_uc_ambigua"))
    return "Linha da UC não confirmada";
  if (motivo.startsWith("planilha_da_usina_ambigua"))
    return "Planilha da usina requer revisão";
  if (motivo.startsWith("modalidade_operacional_nao_confirmada"))
    return "Modalidade operacional não confirmada";
  if (motivo.startsWith("simulacao_central")) return "Simulação requer revisão";
  if (motivo.startsWith("anexo_nao_disponivel"))
    return "PDF indisponível nesta captura";
  return "Revisar dados da fatura";
}
const avisosDeRetorno: Record<RetornoOAuth, { texto: string; erro: boolean }> =
  {
    conectada: {
      texto:
        "Conta Gmail autorizada. Confira a identidade abaixo; a conta permanece pausada até você reativá-la.",
      erro: false,
    },
    recusada: {
      texto:
        "A autorização foi recusada. Nenhuma conta foi conectada; você pode tentar novamente.",
      erro: true,
    },
    expirada: {
      texto:
        "A autorização ou a sessão expirou. Entre novamente, se necessário, e reinicie a conexão.",
      erro: true,
    },
    falha: {
      texto:
        "Não foi possível concluir a autorização. Confira a configuração e tente novamente.",
      erro: true,
    },
  };

export default function Gmail() {
  const { nivel } = usarAdministrador();
  if (nivel < 3)
    return (
      <section className="admin-cartao">
        <h1>Acesso restrito</h1>
        <p>Somente administradores de nível 3 podem configurar o Gmail.</p>
        <Link to="/admin/usinas">Voltar às usinas</Link>
      </section>
    );
  return <PainelGmail />;
}

function PainelGmail() {
  const consulta = usarConsulta<ContasGmail>(base);
  const [parametros, definirParametros] = useSearchParams();
  const retorno = parametros.get("oauth") as RetornoOAuth | null;
  const [avisoRetorno] = useState(
    retorno && Object.hasOwn(avisosDeRetorno, retorno)
      ? avisosDeRetorno[retorno]
      : null,
  );
  const [ocupado, definirOcupado] = useState<number | "cadastro" | null>(null);
  const [erro, definirErro] = useState("");
  const [mensagem, definirMensagem] = useState("");

  useEffect(() => {
    if (retorno) definirParametros({}, { replace: true });
  }, [retorno, definirParametros]);

  async function cadastrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    definirErro("");
    definirMensagem("");
    definirOcupado("cadastro");
    const formulario = evento.currentTarget;
    const campos = new FormData(formulario);
    try {
      await alterarDados(base, {
        email: String(campos.get("email") || "").trim(),
        dataInicio: String(campos.get("dataInicio") || ""),
      });
      formulario.reset();
      definirMensagem(
        "Conta registrada. A conexão só será ativada após autorização e verificação da identidade no Google.",
      );
      consulta.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirOcupado(null);
    }
  }

  async function conectar(contaId: number) {
    definirErro("");
    definirMensagem("");
    definirOcupado(contaId);
    try {
      const { url } = await consultarServidor<{ url: string }>(
        `${base}/${contaId}/conectar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      const destino = new URL(url);
      if (destino.origin !== "https://accounts.google.com")
        throw new Error(
          "O servidor retornou um endereço de autorização inválido.",
        );
      window.location.assign(destino.href);
    } catch (falha) {
      definirErro((falha as Error).message);
      definirOcupado(null);
    }
  }

  async function pausar(contaId: number, pausada: boolean) {
    definirErro("");
    definirMensagem("");
    definirOcupado(contaId);
    try {
      await alterarDados(`${base}/${contaId}/pausa`, { pausada });
      definirMensagem(
        pausada
          ? "Conta pausada. A coleta futura não deverá usar esta conta até você reativá-la."
          : "Conta reativada para a coleta futura.",
      );
      consulta.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirOcupado(null);
    }
  }

  const contas = consulta.dados?.contas ?? [];

  return (
    <>
      <CabecalhoDoModulo
        titulo="Integração Gmail"
        descricao="Conecte a caixa de faturas, acompanhe a captura de PDFs e confira cada documento antes de calcular."
      >
        <button
          className="admin-botao secundario"
          type="button"
          onClick={consulta.atualizar}
          disabled={consulta.carregando || ocupado !== null}
        >
          Atualizar estados
        </button>
      </CabecalhoDoModulo>

      {avisoRetorno && (
        <p
          className={`admin-aviso ${avisoRetorno.erro ? "erro" : "sucesso"}`}
          role={avisoRetorno.erro ? "alert" : "status"}
        >
          {avisoRetorno.texto}
        </p>
      )}
      {erro && (
        <p className="admin-aviso erro" role="alert">
          {erro}
        </p>
      )}
      {mensagem && (
        <p className="admin-aviso sucesso" role="status">
          {mensagem}
        </p>
      )}
      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
      {consulta.dados && !consulta.dados.configurado && (
        <p className="admin-aviso" role="note">
          A conexão Google ainda não está configurada no servidor. Um
          responsável técnico precisa configurar as credenciais e a chave de
          proteção antes da autorização. Não informe essas credenciais nesta
          página.
        </p>
      )}

      <section className="admin-cartao gmail-configuracao">
        <h2>Registrar caixa de entrada</h2>
        <p>
          Informe o endereço Gmail e escolha a data inicial da busca. A coleta
          só acontece depois da autorização e da reativação da conta.
        </p>
        <form
          className="admin-formulario gmail-formulario"
          onSubmit={cadastrar}
        >
          <fieldset className="admin-campos" disabled={ocupado !== null}>
            <label>
              Endereço Gmail
              <input
                name="email"
                type="email"
                placeholder="faturas@gmail.com"
                maxLength={320}
                autoComplete="email"
                required
              />
            </label>
            <label>
              Buscar a partir de
              <input name="dataInicio" type="date" required />
            </label>
          </fieldset>
          <button className="admin-botao" disabled={ocupado !== null}>
            {ocupado === "cadastro" ? "Registrando…" : "Registrar conta"}
          </button>
        </form>
      </section>

      <section className="admin-cartao">
        <div className="admin-barra">
          <h2>Contas registradas</h2>
          <span className="admin-status">{contas.length} conta(s)</span>
        </div>
        {!consulta.carregando && !consulta.erro && !contas.length && (
          <ListaVazia texto="Registre uma conta Gmail para iniciar a autorização." />
        )}
        <div className="gmail-contas">
          {contas.map((conta) => {
            const conectada = conta.status_autorizacao === "conectada";
            const pausada = Boolean(conta.pausada);
            const identidade =
              typeof conta.identidade_verificada === "string"
                ? conta.identidade_verificada
                : conta.identidade_verificada === true
                  ? conta.email
                  : null;
            const estado = conectada
              ? pausada
                ? "Pausada"
                : "Conectada"
              : conta.status_autorizacao === "reconectar"
                ? "Reconexão necessária"
                : "Não conectada";
            return (
              <article className="gmail-conta" key={conta.id}>
                <div className="gmail-conta-cabecalho">
                  <div>
                    <span className="admin-sobretitulo">Conta #{conta.id}</span>
                    <h3>{conta.email}</h3>
                  </div>
                  <span
                    className={`admin-status ${conectada && !pausada ? "pago" : ""}`}
                  >
                    {estado}
                  </span>
                </div>
                <dl className="gmail-conta-dados">
                  <div>
                    <dt>Identidade Google</dt>
                    <dd>{identidade ?? "Aguardando verificação"}</dd>
                  </div>
                  <div>
                    <dt>Data inicial escolhida</dt>
                    <dd>{formatarData(conta.data_inicio)}</dd>
                  </div>
                </dl>
                <div className="gmail-conta-acoes">
                  <button
                    className="admin-botao"
                    type="button"
                    onClick={() => conectar(conta.id)}
                    disabled={ocupado !== null || !consulta.dados?.configurado}
                  >
                    {conectada ? "Reconectar" : "Conectar ao Google"}
                  </button>
                  {conectada && (
                    <button
                      className="admin-botao secundario"
                      type="button"
                      onClick={() => pausar(conta.id, !pausada)}
                      disabled={ocupado !== null}
                    >
                      {pausada ? "Reativar" : "Pausar"}
                    </button>
                  )}
                </div>
                {conectada && (
                  <AcompanhamentoGmail
                    contaId={conta.id}
                    email={conta.email}
                    ativo={!pausada}
                  />
                )}
                <details className="gmail-recursos-secundarios">
                  <summary>Triagem e documentos históricos</summary>
                  <TriagemGmail contaId={conta.id} />
                </details>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

function AcompanhamentoGmail({
  contaId,
  email,
  ativo,
}: {
  contaId: number;
  email: string;
  ativo: boolean;
}) {
  const consulta = usarConsulta<ProgressoGmail>(`${base}/${contaId}/progresso`);
  const pendencias = usarConsulta<PendenciasGmail>(
    `${base}/${contaId}/pendencias`,
  );
  const [iniciando, definirIniciando] = useState(false);
  const [periodo, definirPeriodo] = useState({ inicio: "", fim: "" });
  const [previaPeriodo, definirPreviaPeriodo] =
    useState<PreviaPeriodoGmail | null>(null);
  const [consultandoPeriodo, definirConsultandoPeriodo] = useState(false);
  const [capturaPeriodo, definirCapturaPeriodo] =
    useState<CapturaPeriodo | null>(null);
  const [documentosPeriodo, definirDocumentosPeriodo] = useState<number[]>([]);
  const [preparacaoCentral, definirPreparacaoCentral] =
    useState<PreparacaoCentralLote | null>(null);
  const [preparandoCentral, definirPreparandoCentral] = useState(false);
  const [etapa, definirEtapa] = useState<"capturar" | "preparar" | "conferir">(
    "capturar",
  );
  const [buscaPreparacao, definirBuscaPreparacao] = useState("");
  const [filtroSituacao, definirFiltroSituacao] = useState("todos");
  const [filtroUsina, definirFiltroUsina] = useState("todas");
  const [paginaPreparacao, definirPaginaPreparacao] = useState(1);
  const [erro, definirErro] = useState("");
  const [maisPendencias, definirMaisPendencias] = useState<PendenciasGmail>({
    mensagens: [],
    anexos: [],
    proximaMensagem: null,
    proximoAnexo: null,
  });
  const [cursoresPendencias, definirCursoresPendencias] = useState({
    mensagem: null as number | null,
    anexo: null as number | null,
  });
  useEffect(() => {
    if (!consulta.dados?.emAndamento) return;
    const intervalo = window.setInterval(consulta.atualizar, 3000);
    return () => window.clearInterval(intervalo);
  }, [consulta.dados?.emAndamento, consulta.atualizar]);
  useEffect(() => {
    definirMaisPendencias({
      mensagens: [],
      anexos: [],
      proximaMensagem: null,
      proximoAnexo: null,
    });
    definirCursoresPendencias({
      mensagem: pendencias.dados?.proximaMensagem ?? null,
      anexo: pendencias.dados?.proximoAnexo ?? null,
    });
  }, [pendencias.dados]);

  async function sincronizar() {
    definirErro("");
    definirIniciando(true);
    try {
      await consultarServidor(`${base}/${contaId}/sincronizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      consulta.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirIniciando(false);
    }
  }

  function alterarPeriodo(campo: "inicio" | "fim", valor: string) {
    definirPeriodo((atual) => ({ ...atual, [campo]: valor }));
    definirPreviaPeriodo(null);
    definirPreparacaoCentral(null);
    definirPaginaPreparacao(1);
  }

  async function aplicarAtalhoDiario() {
    definirErro("");
    try {
      const atalho = await consultarServidor<{ inicio: string; fim: string }>(
        "/api/admin/gmail/periodo-diario",
      );
      definirPeriodo({ inicio: atalho.inicio, fim: atalho.fim });
      definirPreviaPeriodo(null);
    } catch (falha) {
      definirErro((falha as Error).message);
    }
  }

  async function consultarPreviaPeriodo() {
    definirErro("");
    definirConsultandoPeriodo(true);
    try {
      const previa = await consultarServidor<PreviaPeriodoGmail>(
        `${base}/${contaId}/periodo/previa`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ periodo }),
        },
      );
      definirPreviaPeriodo(previa);
    } catch (falha) {
      definirPreviaPeriodo(null);
      definirErro((falha as Error).message);
    } finally {
      definirConsultandoPeriodo(false);
    }
  }

  async function consultarSituacaoPeriodo() {
    definirErro("");
    try {
      const resultado = await consultarServidor<{
        captura: CapturaPeriodo | null;
        documentos: number[];
        preparacao: PreparacaoCentralLote | null;
      }>(`${base}/${contaId}/periodo/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodo }),
      });
      definirCapturaPeriodo(resultado.captura);
      definirDocumentosPeriodo(resultado.documentos);
      definirPreparacaoCentral(resultado.preparacao);
    } catch (falha) {
      definirErro((falha as Error).message);
    }
  }

  async function capturarPeriodo() {
    if (!previaPeriodo && !capturaPeriodo) return;
    definirErro("");
    definirIniciando(true);
    try {
      await consultarServidor(`${base}/${contaId}/periodo/capturar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodo }),
      });
      definirPreviaPeriodo(null);
      definirCapturaPeriodo({
        id: 0,
        estado: "em_andamento",
        emails: previaPeriodo?.emails ?? capturaPeriodo?.emails ?? 0,
        anexos: previaPeriodo?.anexos ?? capturaPeriodo?.anexos ?? 0,
        capturados: 0,
        duplicados: 0,
        triagem: 0,
        falhas: 0,
      });
      definirPreparacaoCentral(null);
      consulta.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirIniciando(false);
    }
  }

  async function prepararLoteCentral() {
    if (!capturaPeriodo?.id || capturaPeriodo.estado !== "concluida") return;
    definirErro("");
    definirPreparandoCentral(true);
    try {
      const resultado = await consultarServidor<PreparacaoCentralLote>(
        `${base}/${contaId}/capturas/${capturaPeriodo.id}/central/preparar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      definirPreparacaoCentral(resultado);
      definirEtapa("conferir");
      definirPaginaPreparacao(1);
    } catch (falha) {
      definirPreparacaoCentral(null);
      definirErro((falha as Error).message);
    } finally {
      definirPreparandoCentral(false);
    }
  }

  useEffect(() => {
    if (capturaPeriodo?.estado !== "em_andamento") return;
    const consultarStatus = async () => {
      try {
        const resultado = await consultarServidor<{
          captura: CapturaPeriodo | null;
          documentos: number[];
          preparacao: PreparacaoCentralLote | null;
        }>(`${base}/${contaId}/periodo/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ periodo }),
        });
        if (resultado.captura) {
          definirCapturaPeriodo(resultado.captura);
          definirDocumentosPeriodo(resultado.documentos);
          definirPreparacaoCentral(resultado.preparacao);
        } else window.setTimeout(consultarStatus, 1000);
      } catch (falha) {
        definirErro((falha as Error).message);
      }
    };
    void consultarStatus();
    const intervalo = window.setInterval(consultarStatus, 2000);
    return () => window.clearInterval(intervalo);
  }, [capturaPeriodo?.estado, contaId, periodo]);

  async function reagendar(tipo: "mensagens" | "anexos", itemId: number) {
    definirErro("");
    try {
      await consultarServidor(
        `${base}/${contaId}/${tipo}/${itemId}/tentar-novamente`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      pendencias.atualizar();
      consulta.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    }
  }

  async function autorizarCaptura(item: PendenciaGmail) {
    if (
      !window.confirm(
        `Você conferiu “${item.nome}” no Gmail e confirma que este PDF deve ser capturado para a triagem do Ecosol?`,
      )
    )
      return;
    definirErro("");
    try {
      await alterarDados(
        `${base}/${contaId}/anexos/${item.id}/autorizar-captura`,
        {
          confirmacao: "CONFERI_NO_GMAIL",
        },
      );
      pendencias.atualizar();
      consulta.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    }
  }

  async function carregarMaisPendencias() {
    const parametros = new URLSearchParams({
      aposMensagem: String(cursoresPendencias.mensagem ?? 0),
      incluirMensagem: cursoresPendencias.mensagem ? "1" : "0",
      aposAnexo: String(cursoresPendencias.anexo ?? 0),
      incluirAnexo: cursoresPendencias.anexo ? "1" : "0",
    });
    try {
      const pagina = await consultarServidor<PendenciasGmail>(
        `${base}/${contaId}/pendencias?${parametros}`,
      );
      definirMaisPendencias((atual) => ({
        ...atual,
        mensagens: [...atual.mensagens, ...pagina.mensagens],
        anexos: [...atual.anexos, ...pagina.anexos],
      }));
      definirCursoresPendencias({
        mensagem: pagina.proximaMensagem,
        anexo: pagina.proximoAnexo,
      });
    } catch (falha) {
      definirErro((falha as Error).message);
    }
  }

  const progresso = consulta.dados;
  const itensPreparacao = preparacaoCentral?.itens ?? [];
  const usinasPreparacao = [
    ...new Set(
      itensPreparacao
        .map((item) => item.simulacao?.usina)
        .filter((usina): usina is string => Boolean(usina)),
    ),
  ].sort();
  const busca = buscaPreparacao.trim().toLocaleLowerCase("pt-BR");
  const itensFiltrados = itensPreparacao.filter((item) => {
    const texto = [
      item.nome,
      item.simulacao?.cliente,
      item.simulacao?.ucNova,
      item.simulacao?.ucAntiga,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("pt-BR");
    const revisaoFinanceira =
      item.modo !== "documental" && item.situacao === "revisar";
    const correspondeAoStatus =
      filtroSituacao === "todos" ||
      (filtroSituacao === "pdf_pronto" && item.documental?.situacao === "pronto") ||
      (filtroSituacao === "revisao_documental" &&
        item.documental?.situacao !== "pronto") ||
      (filtroSituacao === "apto_financeiramente" &&
        item.modo === "financeiro" &&
        item.situacao === "preparado") ||
      (filtroSituacao === "revisao_financeira" && revisaoFinanceira);
    return (
      (!busca || texto.includes(busca)) &&
      correspondeAoStatus &&
      (filtroUsina === "todas" || item.simulacao?.usina === filtroUsina)
    );
  });
  const totalPaginas = Math.max(1, Math.ceil(itensFiltrados.length / 20));
  const pagina = Math.min(paginaPreparacao, totalPaginas);
  const itensDaPagina = itensFiltrados.slice((pagina - 1) * 20, pagina * 20);
  return (
    <div className="gmail-acompanhamento">
      <div className="admin-barra">
        <h4>Faturas por Gmail</h4>
        <button
          className="admin-botao secundario"
          type="button"
          onClick={consulta.atualizar}
        >
          Atualizar
        </button>
      </div>
      <nav className="gmail-etapas" aria-label="Fluxo de faturamento Gmail">
        {(["capturar", "preparar", "conferir"] as const).map((item, indice) => (
          <button
            key={item}
            type="button"
            className={`gmail-etapa ${etapa === item ? "ativa" : ""}`}
            onClick={() => definirEtapa(item)}
          >
            <span>{indice + 1}</span>
            {item.toUpperCase()}
          </button>
        ))}
      </nav>
      {consulta.erro && (
        <p className="admin-aviso erro" role="alert">
          {consulta.erro}
        </p>
      )}
      {erro && (
        <p className="admin-aviso erro" role="alert">
          {erro}
        </p>
      )}
      <section className="gmail-fluxo-guiado">
        {etapa === "capturar" && (
          <div className="gmail-passo">
            <div className="gmail-passo-cabecalho">
              <span>ETAPA 1</span>
              <h5>Capturar</h5>
            </div>
            <p>
              Escolha o período de recebimento. O início é inclusivo e o fim
              exclusivo.
            </p>
            <div className="admin-campos gmail-campos-periodo">
              <label>
                Recebido a partir de
                <input
                  type="datetime-local"
                  value={periodo.inicio}
                  onChange={(evento) =>
                    alterarPeriodo("inicio", evento.target.value)
                  }
                />
              </label>
              <label>
                Recebido antes de
                <input
                  type="datetime-local"
                  value={periodo.fim}
                  onChange={(evento) =>
                    alterarPeriodo("fim", evento.target.value)
                  }
                />
              </label>
            </div>
            <div className="gmail-fluxo-acoes">
              <button
                className="admin-botao secundario"
                type="button"
                onClick={aplicarAtalhoDiario}
                disabled={iniciando || consultandoPeriodo}
              >
                Ontem 08:00 → hoje 08:00
              </button>
              {previaPeriodo ? (
                <button
                  className="admin-botao"
                  type="button"
                  onClick={capturarPeriodo}
                  disabled={!ativo || iniciando}
                >
                  Capturar e-mails da prévia
                </button>
              ) : (
                <button
                  className="admin-botao"
                  type="button"
                  onClick={consultarPreviaPeriodo}
                  disabled={!ativo || iniciando || consultandoPeriodo}
                >
                  {consultandoPeriodo ? "Consultando…" : "Consultar período"}
                </button>
              )}
            </div>
            {previaPeriodo && (
              <p className="admin-aviso">
                Prévia: {previaPeriodo.emails} e-mails e {previaPeriodo.anexos}{" "}
                PDFs elegíveis.
              </p>
            )}
            {capturaPeriodo && (
              <div className="gmail-resumo-captura">
                <strong>
                  {capturaPeriodo.estado === "concluida"
                    ? "Captura concluída"
                    : capturaPeriodo.estado === "em_andamento"
                      ? "Captura em andamento"
                      : "Captura com falha"}
                </strong>
                <span>
                  {periodo.inicio} até {periodo.fim}
                </span>
                <span>Recebidos {capturaPeriodo.anexos}</span>
                <span>Capturados {capturaPeriodo.capturados}</span>
                <span>Triagem {capturaPeriodo.triagem}</span>
                {capturaPeriodo.estado === "concluida" && (
                  <button
                    className="admin-botao secundario"
                    type="button"
                    onClick={() => definirEtapa("preparar")}
                  >
                    Avançar
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {etapa === "preparar" && (
          <div className="gmail-passo">
            <div className="gmail-passo-cabecalho">
              <span>ETAPA 2</span>
              <h5>Preparar</h5>
            </div>
            {capturaPeriodo?.estado === "concluida" ? (
              <>
                <p>
                  Captura selecionada:{" "}
                  <strong>{capturaPeriodo.capturados} PDFs</strong>. A
                  preparação não aprova, não imprime e não altera arquivos
                  oficiais.
                </p>
                <button
                  className="admin-botao"
                  type="button"
                  onClick={prepararLoteCentral}
                  disabled={preparandoCentral}
                >
                  {preparandoCentral ? "Preparando…" : "Preparar lote"}
                </button>
                {preparacaoCentral && (
                  <div className="gmail-resumo-captura">
                    <span>
                      Preparados {preparacaoCentral.resumo.preparados}
                    </span>
                    <span>REVISAR {preparacaoCentral.resumo.revisar}</span>
                    <span>
                      Falhas técnicas {preparacaoCentral.resumo.falhas}
                    </span>
                    <button
                      className="admin-botao secundario"
                      type="button"
                      onClick={() => definirEtapa("conferir")}
                    >
                      Conferir resultado
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="admin-aviso">
                Conclua ou consulte uma captura na etapa anterior.
              </p>
            )}
          </div>
        )}
        {etapa === "conferir" && (
          <div className="gmail-passo">
            <div className="gmail-passo-cabecalho">
              <span>ETAPA 3</span>
              <h5>Conferir</h5>
            </div>
            {!preparacaoCentral ? (
              <p className="admin-aviso">
                Prepare o lote para disponibilizar a conferência.
              </p>
            ) : (
              <>
                <div className="gmail-indicadores">
                  <span>
                    Identificados{" "}
                    <strong>{preparacaoCentral.resumo.identificadosDocumentalmente}</strong>
                  </span>
                  <span>
                    PDFs preparados{" "}
                    <strong>{preparacaoCentral.resumo.documentosDocumentaisProntos}</strong>
                  </span>
                  <span>
                    Revisão documental <strong>{preparacaoCentral.resumo.revisaoDocumental}</strong>
                  </span>
                  <span>
                    Aptos financeiramente <strong>{preparacaoCentral.resumo.financeiramenteAptos}</strong>
                  </span>
                  <span>
                    Revisão financeira <strong>{preparacaoCentral.resumo.revisaoFinanceira}</strong>
                  </span>
                </div>
                <div className="gmail-filtros">
                  <label>
                    Buscar cliente ou UC
                    <input
                      value={buscaPreparacao}
                      onChange={(evento) => {
                        definirBuscaPreparacao(evento.target.value);
                        definirPaginaPreparacao(1);
                      }}
                      placeholder="Nome ou UC"
                    />
                  </label>
                  <label>
                    Status
                    <select
                      value={filtroSituacao}
                      onChange={(evento) => {
                        definirFiltroSituacao(evento.target.value);
                        definirPaginaPreparacao(1);
                      }}
                    >
                      <option value="todos">Todos</option>
                      <option value="pdf_pronto">PDFs preparados</option>
                      <option value="revisao_documental">Revisão documental</option>
                      <option value="apto_financeiramente">
                        Aptos financeiramente
                      </option>
                      <option value="revisao_financeira">
                        Revisão financeira
                      </option>
                    </select>
                  </label>
                  <label>
                    Usina
                    <select
                      value={filtroUsina}
                      onChange={(evento) => {
                        definirFiltroUsina(evento.target.value);
                        definirPaginaPreparacao(1);
                      }}
                    >
                      <option value="todas">Todas</option>
                      {usinasPreparacao.map((usina) => (
                        <option key={usina}>{usina}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="gmail-tabela">
                  <div className="gmail-tabela-cabecalho">
                    <span>Documento</span>
                    <span>Cliente / UC</span>
                    <span>Usina / competência</span>
                    <span>Boleto</span>
                    <span>Status</span>
                    <span>Ação</span>
                  </div>
                  {itensDaPagina.map((item) => (
                    <article className="gmail-linha-preparacao" key={item.id}>
                      <span data-label="Documento">{item.nome}</span>
                      <span data-label="Cliente / UC">
                        {item.simulacao?.cliente ?? "Não identificado"}
                        <small>
                          UC{" "}
                          {item.simulacao?.ucNova ??
                            item.simulacao?.ucAntiga ??
                            "não encontrada"}
                        </small>
                      </span>
                      <span data-label="Usina / competência">
                        {item.simulacao?.usina ?? "Não identificada"}
                        <small>
                          {item.simulacao?.mesFaturamento ??
                            item.simulacao?.competencia ??
                            item.competencia ??
                            "Competência não encontrada"}
                        </small>
                      </span>
                      <span data-label="Boleto">
                        {item.modo === "documental"
                          ? "Sem boleto"
                          : item.simulacao?.valorBoleto
                            ? moeda(item.simulacao.valorBoleto)
                            : "—"}
                      </span>
                      <span
                        data-label="Status"
                        className="gmail-status-preparacao"
                      >
                        <span className={`gmail-status-documental ${item.documental?.situacao ?? "revisar"}`}>
                          <small>Documento</small>
                          {item.documental?.situacao === "pronto"
                            ? "PDF preparado"
                            : "Revisar documento"}
                        </span>
                        <span
                          className={`gmail-status-financeiro ${
                            item.modo === "documental"
                              ? "documental"
                              : item.modo === "financeiro" && item.situacao === "preparado"
                                ? "apto"
                                : "revisar"
                          }`}
                        >
                          <small>Financeiro</small>
                          {item.modo === "documental"
                            ? "Sem boleto"
                            : item.modo === "financeiro" && item.situacao === "preparado"
                              ? "Apto para avaliação"
                              : motivoCurto(item.motivos)}
                        </span>
                        {item.documental?.situacao === "revisar" && (
                          <small className="gmail-motivo-documental">
                            {motivoCurto([item.documental.motivo ?? ""])}
                          </small>
                        )}
                        {item.situacao === "revisar" && item.modo !== "documental" && (
                          <details>
                            <summary>Detalhe</summary>
                            <code>{item.motivos.join(", ")}</code>
                          </details>
                        )}
                      </span>
                      <span className="gmail-acoes-preparacao">
                        {item.documental?.situacao === "pronto" && capturaPeriodo && (
                          <>
                            <a
                              className="admin-botao secundario"
                              href={`${base}/${contaId}/capturas/${capturaPeriodo.id}/central/documentos/${item.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Abrir PDF
                            </a>
                            <a
                              className="admin-botao secundario"
                              href={`${base}/${contaId}/capturas/${capturaPeriodo.id}/central/documentos/${item.id}/impressao`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              A4 simulado
                            </a>
                          </>
                        )}
                        <Link
                          className="admin-botao secundario"
                          to={`/admin/faturas?etapa=conferir&documento=${item.id}`}
                        >
                          Conferir
                        </Link>
                      </span>
                    </article>
                  ))}
                </div>
                {!itensDaPagina.length && (
                  <ListaVazia texto="Nenhum documento corresponde aos filtros." />
                )}
                <div className="gmail-paginacao">
                  <button
                    className="admin-botao secundario"
                    type="button"
                    disabled={pagina <= 1}
                    onClick={() => definirPaginaPreparacao(pagina - 1)}
                  >
                    Anterior
                  </button>
                  <span>
                    Página {pagina} de {totalPaginas}
                  </span>
                  <button
                    className="admin-botao secundario"
                    type="button"
                    disabled={pagina >= totalPaginas}
                    onClick={() => definirPaginaPreparacao(pagina + 1)}
                  >
                    Próxima
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>
      <details className="gmail-recursos-secundarios">
        <summary>Histórico, sincronização e opções secundárias</summary>
        <div className="gmail-conta-acoes">
          <button
            className="admin-botao secundario"
            type="button"
            onClick={sincronizar}
            disabled={!ativo || iniciando || progresso?.emAndamento}
          >
            {iniciando ? "Iniciando…" : "Sincronizar agora"}
          </button>
          <button
            className="admin-botao secundario"
            type="button"
            onClick={consultarSituacaoPeriodo}
          >
            Consultar situação do período
          </button>
        </div>
      </details>
      {progresso && (
        <details className="gmail-legado-recolhido">
          <summary>Detalhes operacionais e pendências</summary>
          <p role="status">
            {progresso.emAndamento
              ? "Sincronização em andamento…"
              : ativo
                ? "Conta ativa. A busca automática ocorre aproximadamente a cada cinco minutos."
                : "Conta pausada; nenhuma nova busca será iniciada."}
          </p>
          <dl className="gmail-conta-dados">
            <div>
              <dt>Última execução</dt>
              <dd>{instante(progresso.ultimaExecucaoEm)}</dd>
            </div>
            <div>
              <dt>Última busca concluída</dt>
              <dd>{instante(progresso.ultimaConclusaoEm)}</dd>
            </div>
            <div>
              <dt>Mensagens encontradas</dt>
              <dd>
                {progresso.mensagens.reduce(
                  (total, item) => total + item.quantidade,
                  0,
                )}
              </dd>
            </div>
            <div>
              <dt>PDFs capturados</dt>
              <dd>{quantidade(progresso.anexos, "capturado")}</dd>
            </div>
            <div>
              <dt>PDFs duplicados</dt>
              <dd>{quantidade(progresso.anexos, "duplicado")}</dd>
            </div>
            <div>
              <dt>Pendências</dt>
              <dd>
                {[...progresso.anexos, ...progresso.mensagens]
                  .filter((item) =>
                    ["pendente_manual", "falha_temporaria"].includes(
                      item.estado,
                    ),
                  )
                  .reduce((total, item) => total + item.quantidade, 0)}
              </dd>
            </div>
          </dl>
          {progresso.ultimoErroCodigo && (
            <p className="admin-aviso erro" role="alert">
              A última execução encontrou uma falha (
              {progresso.ultimoErroCodigo}).
              {progresso.ultimoErroCodigo.includes("autorizacao")
                ? " Reconecte a conta para retomar."
                : " Verifique as pendências e tente novamente."}
            </p>
          )}
          <button
            className="admin-botao"
            type="button"
            onClick={sincronizar}
            disabled={!ativo || iniciando || progresso.emAndamento}
          >
            {iniciando ? "Iniciando…" : "Sincronizar agora"}
          </button>
          <section className="gmail-periodo" aria-label="Captura por período">
            <h5>Captura por período</h5>
            <p>
              Consulte a prévia antes de capturar. O início é inclusivo e o fim
              é exclusivo, sempre no fuso de São Paulo.
            </p>
            <div className="admin-campos">
              <label>
                Recebido a partir de
                <input
                  type="datetime-local"
                  value={periodo.inicio}
                  onChange={(evento) =>
                    alterarPeriodo("inicio", evento.target.value)
                  }
                />
              </label>
              <label>
                Recebido antes de
                <input
                  type="datetime-local"
                  value={periodo.fim}
                  onChange={(evento) =>
                    alterarPeriodo("fim", evento.target.value)
                  }
                />
              </label>
            </div>
            <div className="gmail-conta-acoes">
              <button
                className="admin-botao secundario"
                type="button"
                onClick={aplicarAtalhoDiario}
                disabled={iniciando || consultandoPeriodo}
              >
                Ontem 08:00 → hoje 08:00
              </button>
              <button
                className="admin-botao secundario"
                type="button"
                onClick={consultarPreviaPeriodo}
                disabled={!ativo || iniciando || consultandoPeriodo}
              >
                {consultandoPeriodo ? "Consultando…" : "Ver prévia"}
              </button>
              <button
                className="admin-botao secundario"
                type="button"
                onClick={consultarSituacaoPeriodo}
                disabled={!ativo || iniciando || consultandoPeriodo}
              >
                Consultar situação
              </button>
              <button
                className="admin-botao"
                type="button"
                onClick={capturarPeriodo}
                disabled={
                  !ativo ||
                  iniciando ||
                  (!previaPeriodo &&
                    (!capturaPeriodo || capturaPeriodo.estado === "concluida"))
                }
              >
                {capturaPeriodo?.estado === "falha" ||
                capturaPeriodo?.estado === "em_andamento"
                  ? "Retomar captura da prévia"
                  : "Capturar e-mails da prévia"}
              </button>
            </div>
            {previaPeriodo && (
              <p className="admin-aviso" role="status">
                Prévia: {previaPeriodo.emails} e-mail(s) e{" "}
                {previaPeriodo.anexos} PDF(s) elegível(is). Nenhum documento foi
                importado nesta consulta.
              </p>
            )}
            {capturaPeriodo && (
              <p
                className={`admin-aviso ${capturaPeriodo.estado === "falha" ? "erro" : ""}`}
                role="status"
              >
                Período: {periodo.inicio} até {periodo.fim}.{" "}
                {capturaPeriodo.estado === "em_andamento"
                  ? "Captura em andamento…"
                  : capturaPeriodo.estado === "concluida"
                    ? "Captura concluída."
                    : "Captura encerrada com falha."}{" "}
                E-mails: {capturaPeriodo.emails}; PDFs: {capturaPeriodo.anexos};
                capturados: {capturaPeriodo.capturados}; duplicados:{" "}
                {capturaPeriodo.duplicados}; triagem: {capturaPeriodo.triagem};
                falhas: {capturaPeriodo.falhas}; restantes:{" "}
                {Math.max(
                  0,
                  capturaPeriodo.anexos -
                    capturaPeriodo.capturados -
                    capturaPeriodo.duplicados -
                    capturaPeriodo.triagem -
                    capturaPeriodo.falhas,
                )}
                .
                {capturaPeriodo.erro_codigo
                  ? ` Motivo: ${capturaPeriodo.erro_codigo}.`
                  : ""}
                {capturaPeriodo.proxima_tentativa_em
                  ? ` Nova tentativa disponível após ${instante(capturaPeriodo.proxima_tentativa_em)}.`
                  : ""}
                {documentosPeriodo.length ? (
                  <>
                    {" "}
                    <Link
                      to={`/admin/gmail?documentos=${documentosPeriodo.join(",")}`}
                    >
                      Conferir {documentosPeriodo.length} documento(s) deste
                      período
                    </Link>
                    .
                  </>
                ) : null}
              </p>
            )}
            {capturaPeriodo?.estado === "concluida" &&
              capturaPeriodo.id > 0 && (
                <section
                  className="gmail-periodo"
                  aria-label="Preparação Central do lote"
                >
                  <div className="admin-barra">
                    <h5>Preparação Central</h5>
                    <button
                      className="admin-botao"
                      type="button"
                      onClick={prepararLoteCentral}
                      disabled={preparandoCentral}
                    >
                      {preparandoCentral ? "Preparando…" : "Preparar lote"}
                    </button>
                  </div>
                  <p>
                    Usa exclusivamente os PDFs vinculados a este período. A
                    preparação é somente leitura e não aprova, imprime ou altera
                    arquivos oficiais.
                  </p>
                  {preparacaoCentral && (
                    <>
                      <p role="status">
                        Capturados: {preparacaoCentral.resumo.totalCapturado};
                        elegíveis: {preparacaoCentral.resumo.elegiveis};
                        preparados: {preparacaoCentral.resumo.preparados};
                        REVISAR: {preparacaoCentral.resumo.revisar};
                        processados: {preparacaoCentral.resumo.processados};
                        falhas: {preparacaoCentral.resumo.falhas}; PDFs prontos
                        para impressão:{" "}
                        {preparacaoCentral.resumo.pdfsProntosParaImpressao}.
                      </p>
                      <div className="gmail-triagem-lote">
                        {preparacaoCentral.itens.map((item) => (
                          <article className="gmail-triagem-item" key={item.id}>
                            <span>
                              <strong>{item.nome}</strong> ·{" "}
                              {item.situacao === "preparado"
                                ? `PREPARADO (${item.modo})`
                                : `REVISAR: ${item.motivos.join(", ")}`}
                              {item.simulacao && (
                                <>
                                  <br />
                                  UC antiga{" "}
                                  {item.simulacao.ucAntiga ??
                                    "não encontrada"}{" "}
                                  · UC{" "}
                                  {item.simulacao.ucNova ?? "não encontrada"} ·{" "}
                                  {item.simulacao.cliente ??
                                    "cliente não encontrado"}{" "}
                                  ·{" "}
                                  {item.simulacao.usina ??
                                    "usina não encontrada"}{" "}
                                  · competência{" "}
                                  {item.simulacao.mesFaturamento ??
                                    item.competencia ??
                                    "não encontrada"}
                                  <br />
                                  Planilha{" "}
                                  {item.simulacao.planilha ??
                                    "não encontrada"}{" "}
                                  · aba {item.simulacao.aba ?? "não encontrada"}{" "}
                                  · linha{" "}
                                  {item.simulacao.linha ?? "não encontrada"} ·{" "}
                                  {item.modo === "financeiro"
                                    ? item.simulacao.valorBoleto
                                      ? `valor simulado R$ ${item.simulacao.valorBoleto}`
                                      : "valor não encontrado"
                                    : "fluxo documental — sem cálculo de boleto"}
                                </>
                              )}
                            </span>
                            <Link
                              className="admin-botao secundario"
                              to={`/admin/faturas?etapa=conferir&documento=${item.id}`}
                            >
                              Ver documento
                            </Link>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              )}
          </section>
          {pendencias.dados?.mensagens.length ||
          pendencias.dados?.anexos.length ? (
            <div className="gmail-pendencias">
              <div className="admin-barra">
                <h4>Pendências de captura</h4>
                <button
                  className="admin-botao secundario"
                  type="button"
                  onClick={pendencias.atualizar}
                >
                  Atualizar pendências
                </button>
              </div>
              {[
                ...[
                  ...pendencias.dados.mensagens,
                  ...maisPendencias.mensagens,
                ].map((item) => ({
                  ...item,
                  tipo: "mensagens" as const,
                  titulo: `Mensagem #${item.id}`,
                })),
                ...[...pendencias.dados.anexos, ...maisPendencias.anexos].map(
                  (item) => ({
                    ...item,
                    tipo: "anexos" as const,
                    titulo: item.nome || `Anexo #${item.id}`,
                  }),
                ),
              ].map((item) => (
                <div
                  className="gmail-pendencia"
                  key={`${item.tipo}-${item.id}`}
                >
                  <span>
                    {item.titulo} ·{" "}
                    {item.erroCodigo === "revisao_email"
                      ? "Nome não identificado como fatura; PDF não baixado. Pesquise este nome na conta Gmail conectada."
                      : `${item.erroCodigo || "falha sem código"} · ${item.estado === "falha_temporaria" ? "nova tentativa agendada" : "revisão manual"}`}
                  </span>
                  {item.tipo === "anexos" &&
                  item.erroCodigo === "revisao_email" ? (
                    <>
                      <a
                        className="admin-botao secundario"
                        href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Abrir Gmail
                      </a>
                      <button
                        className="admin-botao secundario"
                        type="button"
                        onClick={() => autorizarCaptura(item)}
                      >
                        Conferi: capturar para triagem
                      </button>
                    </>
                  ) : (
                    <button
                      className="admin-botao secundario"
                      type="button"
                      onClick={() => reagendar(item.tipo, item.id)}
                    >
                      Tentar novamente
                    </button>
                  )}
                </div>
              ))}
              {(cursoresPendencias.mensagem || cursoresPendencias.anexo) && (
                <button
                  className="admin-botao secundario"
                  type="button"
                  onClick={carregarMaisPendencias}
                >
                  Carregar mais pendências
                </button>
              )}
            </div>
          ) : null}
          <p>
            PDFs novos ficam na triagem restrita até um administrador confirmar
            que são faturas. Nenhum valor é aprovado automaticamente.
          </p>
        </details>
      )}
    </div>
  );
}

function TriagemGmail({ contaId }: { contaId: number }) {
  const [parametros] = useSearchParams();
  const consulta = usarConsulta<PaginaTriagemGmail>(
    `${base}/${contaId}/triagem`,
  );
  const [extras, definirExtras] = useState<ItemTriagemGmail[]>([]);
  const [proximo, definirProximo] = useState<number | null>(null);
  const [ocupado, definirOcupado] = useState(false);
  const [selecionados, definirSelecionados] = useState<
    Record<number, ItemTriagemGmail>
  >({});
  const [erro, definirErro] = useState("");
  const [mensagem, definirMensagem] = useState("");
  const [simulacoes, definirSimulacoes] = useState<
    Record<number, SimulacaoCentral>
  >({});
  const [simulandoCentral, definirSimulandoCentral] = useState(false);
  const idsConferencia = parametros.get("documentos") ?? "";
  const conferencia = usarConsulta<{
    itens: ItemConferenciaGmail[];
    ausentes: number[];
  }>(
    idsConferencia
      ? `${base}/${contaId}/triagem/conferencia?documentos=${idsConferencia}`
      : null,
  );
  useEffect(() => {
    definirExtras([]);
    definirProximo(consulta.dados?.proximoAntes ?? null);
    definirSelecionados({});
  }, [consulta.dados]);

  async function carregarMais() {
    if (!proximo) return;
    try {
      const pagina = await consultarServidor<PaginaTriagemGmail>(
        `${base}/${contaId}/triagem?antes=${proximo}`,
      );
      definirExtras((atuais) => [...atuais, ...pagina.itens]);
      definirProximo(pagina.proximoAntes);
    } catch (falha) {
      definirErro((falha as Error).message);
    }
  }

  async function classificar(
    item: ItemTriagemGmail,
    destino: "fatura" | "nao_fatura",
  ) {
    const aviso =
      destino === "fatura"
        ? "Confirma que este PDF é uma conta de energia? Ele ficará acessível à equipe em Faturas."
        : "Confirma que este PDF não é uma fatura? Ele permanecerá guardado nesta triagem.";
    if (!window.confirm(aviso)) return;
    definirErro("");
    definirMensagem("");
    definirOcupado(true);
    try {
      await consultarServidor(
        `${base}/${contaId}/triagem/${item.id}/classificacao`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versao: item.versao, destino }),
        },
      );
      consulta.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirOcupado(false);
    }
  }

  async function carregarSimulacaoCentral() {
    if (!idsConferencia) return;
    definirErro("");
    definirMensagem("");
    definirSimulandoCentral(true);
    try {
      const resultado = await consultarServidor<{ itens: SimulacaoCentral[] }>(
        `${base}/${contaId}/triagem/conferencia-central?documentos=${idsConferencia}`,
      );
      definirSimulacoes(
        Object.fromEntries(
          resultado.itens.map((item) => [item.documento, item]),
        ),
      );
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirSimulandoCentral(false);
    }
  }

  async function encaminharSimulado(item: ItemConferenciaGmail) {
    if (simulacoes[item.id]?.situacao !== "simulada") return;
    if (
      !window.confirm(
        "Encaminhar esta fatura para Faturas? A simulação não aprova nem emite cobrança; a aprovação financeira continua obrigatória no fluxo de Faturas.",
      )
    )
      return;
    await classificar(
      {
        id: item.id,
        nome: item.nome,
        classificacao: "triagem",
        versao: item.versao,
      },
      "fatura",
    );
  }

  const itens = [...(consulta.dados?.itens ?? []), ...extras];
  const escolhidos = Object.values(selecionados);
  const todosSelecionados =
    itens.length > 0 && itens.every((item) => selecionados[item.id]);

  function alternarItem(item: ItemTriagemGmail) {
    definirSelecionados((atuais) => {
      const novos = { ...atuais };
      if (novos[item.id]) delete novos[item.id];
      else novos[item.id] = item;
      return novos;
    });
  }

  function alternarTodos() {
    definirSelecionados((atuais) => {
      if (itens.every((item) => atuais[item.id])) return {};
      return Object.fromEntries(itens.map((item) => [item.id, item]));
    });
  }

  async function executarLote(
    acao: "fatura" | "nao_fatura" | "excluir",
    selecao = escolhidos,
  ) {
    if (selecao.length < 1) return;
    if (selecao.length > 500) {
      definirErro("Selecione até 500 PDFs por operação.");
      return;
    }
    if (acao === "excluir") {
      const confirmacao = window.prompt(
        `Exclusão definitiva de ${selecao.length} PDF(s) no Ecosol. O conteúdo e os dados extraídos não poderão ser recuperados pelo sistema; Gmail e backups existentes não serão apagados. Digite EXCLUIR para confirmar:`,
      );
      if (confirmacao !== "EXCLUIR") return;
    } else {
      const aviso =
        acao === "fatura"
          ? `Enviar ${selecao.length} PDF(s) para Faturas? Eles ficarão acessíveis à equipe e ainda precisarão de conferência antes do cálculo.`
          : `Marcar ${selecao.length} PDF(s) como não faturas? Eles continuarão guardados nesta triagem.`;
      if (!window.confirm(aviso)) return;
    }
    definirErro("");
    definirMensagem("");
    definirOcupado(true);
    try {
      const resultado = await consultarServidor<{
        alterados?: number;
        excluidos?: number;
      }>(
        `${base}/${contaId}/triagem/${acao === "excluir" ? "excluir-em-lote" : "classificacao-em-lote"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itens: selecao.map(({ id, versao }) => ({ id, versao })),
            ...(acao === "excluir"
              ? { confirmacao: "EXCLUIR" }
              : { destino: acao }),
          }),
        },
      );
      definirMensagem(
        acao === "excluir"
          ? `${resultado.excluidos} PDF(s) excluído(s) do Ecosol.`
          : `${resultado.alterados} PDF(s) reclassificado(s).`,
      );
      consulta.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirOcupado(false);
    }
  }

  const aguardando =
    consulta.dados?.contagens.find((x) => x.classificacao === "triagem")
      ?.quantidade ?? 0;
  const naoFaturas =
    consulta.dados?.contagens.find((x) => x.classificacao === "nao_fatura")
      ?.quantidade ?? 0;
  return (
    <section className="gmail-triagem">
      {idsConferencia ? (
        <section
          className="gmail-periodo"
          aria-label="Conferência do lote selecionado"
        >
          <div className="admin-barra">
            <h4>Lote Gmail selecionado</h4>
            <button
              className="admin-botao secundario"
              type="button"
              onClick={conferencia.atualizar}
            >
              Atualizar prévia
            </button>
            <button
              className="admin-botao secundario"
              type="button"
              disabled={simulandoCentral}
              onClick={carregarSimulacaoCentral}
            >
              {simulandoCentral ? "Simulando…" : "Simular valores da Central"}
            </button>
          </div>
          <p>
            Prévia somente leitura dos documentos vinculados ao período. A
            simulação usa o motor da Central sem gravar planilhas, PDFs ou
            cobranças. Ela não é aprovação financeira.
          </p>
          {conferencia.erro && (
            <p className="admin-aviso erro" role="alert">
              {conferencia.erro}
            </p>
          )}
          {conferencia.dados && (
            <>
              <p>
                {
                  conferencia.dados.itens.filter(
                    (item) => item.situacao === "vinculo_seguro",
                  ).length
                }{" "}
                com vínculo seguro ·{" "}
                {
                  conferencia.dados.itens.filter(
                    (item) => item.situacao === "revisar",
                  ).length
                }{" "}
                exigem revisão.
              </p>
              {conferencia.dados.itens.map((item) => (
                <div className="gmail-triagem-item" key={item.id}>
                  <span>
                    <strong>{item.nome}</strong> · UC{" "}
                    {item.uc ?? "não extraída"} ·{" "}
                    {item.competencia ?? "sem competência"} ·{" "}
                    {item.cliente ?? "SEM CLIENTE"} ·{" "}
                    {item.usina ?? "SEM USINA"}
                    <br />
                    Gmail: {item.messageId} · registrado em {item.recebidoEm}{" "}
                    UTC
                    <br />
                    Nome cadastral proposto:{" "}
                    {item.nomeProposto ??
                      "não proposto — revise o vínculo"} ·{" "}
                    {item.situacao === "vinculo_seguro"
                      ? "Vínculo seguro"
                      : "REVISAR"}
                    {simulacoes[item.id] && (
                      <>
                        <br />
                        Simulação Central: cliente{" "}
                        {item.cliente ?? "não encontrado"}
                        {" · "}UC{" "}
                        {simulacoes[item.id].ucNova ??
                          item.uc ??
                          "não encontrada"}
                        {" · "}usina {item.usina ?? "não encontrada"}
                        {" · "}competência{" "}
                        {item.competencia ?? "não encontrada"}
                        {" · "}consumo{" "}
                        {simulacoes[item.id].dadosFatura?.energia ??
                          "não encontrado"}{" "}
                        kWh
                        {" · "}tarifa{" "}
                        {moeda(simulacoes[item.id].dadosFatura?.tarifa)}
                        {" · "}desconto{" "}
                        {simulacoes[item.id].descontoContratual ??
                          "não encontrado"}
                        {" · "}valor simulado{" "}
                        {moeda(simulacoes[item.id].valorBoleto)}
                        <br />
                        {simulacoes[item.id].situacao === "simulada"
                          ? "Simulação válida — aguarda encaminhamento e aprovação humana em Faturas."
                          : `REVISAR: ${simulacoes[item.id].motivos?.join(", ") || simulacoes[item.id].motivo || "motivo não informado"}`}
                      </>
                    )}
                  </span>
                  <a
                    className="admin-botao secundario"
                    href={`${base}/${contaId}/triagem/${item.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir PDF
                  </a>
                  {item.previaCentralDisponivel ? (
                    <a
                      className="admin-botao secundario"
                      href={`${base}/${contaId}/triagem/${item.id}/previa-central`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir prévia Central
                    </a>
                  ) : null}
                  {simulacoes[item.id]?.situacao === "simulada" ? (
                    <button
                      className="admin-botao secundario"
                      type="button"
                      disabled={ocupado}
                      onClick={() => encaminharSimulado(item)}
                    >
                      Encaminhar para Faturas
                    </button>
                  ) : null}
                </div>
              ))}
            </>
          )}
        </section>
      ) : null}
      <div className="admin-barra">
        <h4>Triagem de PDFs</h4>
        <button
          className="admin-botao secundario"
          type="button"
          onClick={consulta.atualizar}
        >
          Atualizar triagem
        </button>
      </div>
      <p>
        Aguardando classificação: {aguardando} · Não são faturas: {naoFaturas}.
        Apenas documentos confirmados entram em Faturas.
      </p>
      {itens.length > 0 && (
        <div className="gmail-triagem-lote">
          <label>
            <input
              type="checkbox"
              checked={todosSelecionados}
              disabled={ocupado}
              onChange={alternarTodos}
            />
            Selecionar todos os {itens.length} PDFs carregados
          </label>
          <span>{escolhidos.length} selecionado(s)</span>
          <div className="gmail-conta-acoes">
            <button
              className="admin-botao secundario"
              type="button"
              disabled={ocupado || escolhidos.length === 0}
              onClick={() => executarLote("fatura")}
            >
              Classificar como faturas
            </button>
            <button
              className="admin-botao secundario"
              type="button"
              disabled={ocupado || escolhidos.length === 0}
              onClick={() => executarLote("nao_fatura")}
            >
              Classificar como não faturas
            </button>
            <button
              className="admin-botao perigo"
              type="button"
              disabled={ocupado || escolhidos.length === 0}
              onClick={() => executarLote("excluir")}
            >
              Excluir selecionados
            </button>
          </div>
        </div>
      )}
      {(consulta.erro || erro) && (
        <p className="admin-aviso erro" role="alert">
          {consulta.erro || erro}
        </p>
      )}
      {mensagem && <p className="admin-aviso">{mensagem}</p>}
      {itens.length === 0 && !consulta.carregando && (
        <p>Nenhum PDF na triagem.</p>
      )}
      {itens.map((item) => (
        <div className="gmail-triagem-item" key={item.id}>
          <label className="gmail-triagem-selecao">
            <input
              type="checkbox"
              checked={Boolean(selecionados[item.id])}
              disabled={ocupado}
              onChange={() => alternarItem(item)}
              aria-label={`Selecionar ${item.nome}`}
            />
            <span>
              {item.nome} ·{" "}
              {item.classificacao === "triagem"
                ? "Aguardando classificação"
                : "Não é fatura"}
            </span>
          </label>
          <div className="gmail-conta-acoes">
            <a
              className="admin-botao secundario"
              href={`${base}/${contaId}/triagem/${item.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir PDF
            </a>
            <button
              className="admin-botao secundario"
              type="button"
              disabled={ocupado}
              onClick={() => classificar(item, "fatura")}
            >
              Enviar para Faturas
            </button>
            {item.classificacao === "triagem" && (
              <button
                className="admin-botao secundario"
                type="button"
                disabled={ocupado}
                onClick={() => classificar(item, "nao_fatura")}
              >
                Não é fatura
              </button>
            )}
            <button
              className="admin-botao perigo"
              type="button"
              disabled={ocupado}
              onClick={() => executarLote("excluir", [item])}
            >
              Excluir
            </button>
          </div>
        </div>
      ))}
      {proximo && (
        <button
          className="admin-botao secundario"
          type="button"
          onClick={carregarMais}
        >
          Carregar mais
        </button>
      )}
    </section>
  );
}
