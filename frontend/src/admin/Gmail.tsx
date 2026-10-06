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

function quantidade(estados: Contagem[], estado: string) {
  return estados.find((item) => item.estado === estado)?.quantidade ?? 0;
}

function instante(valor: number | null) {
  return valor ? new Date(valor).toLocaleString("pt-BR") : "Ainda não ocorreu";
}

const base = "/api/admin/gmail/contas";
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
                  <AcompanhamentoGmail contaId={conta.id} ativo={!pausada} />
                )}
                <TriagemGmail contaId={conta.id} />
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
  ativo,
}: {
  contaId: number;
  ativo: boolean;
}) {
  const consulta = usarConsulta<ProgressoGmail>(`${base}/${contaId}/progresso`);
  const pendencias = usarConsulta<PendenciasGmail>(
    `${base}/${contaId}/pendencias`,
  );
  const [iniciando, definirIniciando] = useState(false);
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
  return (
    <div className="gmail-acompanhamento">
      <div className="admin-barra">
        <h4>Captura de faturas</h4>
        <button
          className="admin-botao secundario"
          type="button"
          onClick={consulta.atualizar}
        >
          Atualizar
        </button>
      </div>
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
      {progresso && (
        <>
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
                    {item.titulo} · {item.erroCodigo || "falha sem código"} ·{" "}
                    {item.estado === "falha_temporaria"
                      ? "nova tentativa agendada"
                      : "revisão manual"}
                  </span>
                  <button
                    className="admin-botao secundario"
                    type="button"
                    onClick={() => reagendar(item.tipo, item.id)}
                  >
                    Tentar novamente
                  </button>
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
        </>
      )}
    </div>
  );
}

function TriagemGmail({ contaId }: { contaId: number }) {
  const consulta = usarConsulta<PaginaTriagemGmail>(
    `${base}/${contaId}/triagem`,
  );
  const [extras, definirExtras] = useState<ItemTriagemGmail[]>([]);
  const [proximo, definirProximo] = useState<number | null>(null);
  const [ocupado, definirOcupado] = useState<number | null>(null);
  const [erro, definirErro] = useState("");
  useEffect(() => {
    definirExtras([]);
    definirProximo(consulta.dados?.proximoAntes ?? null);
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
    definirOcupado(item.id);
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
      definirOcupado(null);
    }
  }

  const itens = [...(consulta.dados?.itens ?? []), ...extras];
  const aguardando =
    consulta.dados?.contagens.find((x) => x.classificacao === "triagem")
      ?.quantidade ?? 0;
  const naoFaturas =
    consulta.dados?.contagens.find((x) => x.classificacao === "nao_fatura")
      ?.quantidade ?? 0;
  return (
    <section className="gmail-triagem">
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
      {(consulta.erro || erro) && (
        <p className="admin-aviso erro" role="alert">
          {consulta.erro || erro}
        </p>
      )}
      {itens.length === 0 && !consulta.carregando && (
        <p>Nenhum PDF na triagem.</p>
      )}
      {itens.map((item) => (
        <div className="gmail-triagem-item" key={item.id}>
          <span>
            {item.nome} ·{" "}
            {item.classificacao === "triagem"
              ? "Aguardando classificação"
              : "Não é fatura"}
          </span>
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
              disabled={ocupado !== null}
              onClick={() => classificar(item, "fatura")}
            >
              Enviar para Faturas
            </button>
            {item.classificacao === "triagem" && (
              <button
                className="admin-botao secundario"
                type="button"
                disabled={ocupado !== null}
                onClick={() => classificar(item, "nao_fatura")}
              >
                Não é fatura
              </button>
            )}
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
