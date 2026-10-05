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

const base = "/api/admin/gmail/contas";
const avisosDeRetorno: Record<RetornoOAuth, { texto: string; erro: boolean }> =
  {
    conectada: {
      texto:
        "Conta Gmail autorizada. Confira a identidade abaixo antes de iniciar a coleta em uma etapa futura.",
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
        descricao="Conecte a caixa que recebe faturas em PDF. Esta etapa configura o acesso, sem buscar ou baixar mensagens."
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
          Informe o endereço Gmail e escolha a data inicial da futura busca.
          Nenhum e-mail será consultado nesta etapa.
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
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
