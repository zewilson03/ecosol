import { ReactNode, FormEvent, useState } from "react";
import { consultarServidor } from "./comunicacaoComServidor";

export function CabecalhoDoModulo({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children?: ReactNode;
}) {
  return (
    <div className="admin-titulo">
      <div>
        <span className="admin-legenda">GESTÃO ECOSOL</span>
        <h1>{titulo}</h1>
        <p>{descricao}</p>
      </div>
      {children}
    </div>
  );
}

export function EstadoDaConsulta({
  carregando,
  erro,
  repetir,
}: {
  carregando: boolean;
  erro: string;
  repetir: () => void;
}) {
  if (erro)
    return (
      <div className="admin-aviso erro" role="alert">
        {erro} <button onClick={repetir}>Tentar novamente</button>
      </div>
    );
  return carregando ? (
    <p role="status" className="admin-aviso">
      Carregando informações…
    </p>
  ) : null;
}

export function ListaVazia({ texto }: { texto: string }) {
  return (
    <div className="admin-vazio">
      <span aria-hidden="true">☀</span>
      <h3>Ainda não há registros</h3>
      <p>{texto}</p>
    </div>
  );
}

export function FormularioAutomatico({
  endereco,
  aoSalvar,
  children,
  titulo,
}: {
  endereco: string;
  aoSalvar: () => void;
  children: ReactNode;
  titulo: string;
}) {
  const [enviando, definirEnviando] = useState(false);
  const [mensagem, definirMensagem] = useState("");
  const [erro, definirErro] = useState(false);
  const [versao, definirVersao] = useState(0);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    definirEnviando(true);
    definirMensagem("");
    const corpo = new URLSearchParams();
    new FormData(evento.currentTarget).forEach((valor, chave) =>
      corpo.set(chave, String(valor)),
    );
    try {
      await consultarServidor(endereco, { method: "POST", body: corpo });
      definirErro(false);
      definirMensagem("Cadastro realizado com sucesso.");
      definirVersao((valor) => valor + 1);
      aoSalvar();
    } catch (falha) {
      definirErro(true);
      definirMensagem((falha as Error).message);
    } finally {
      definirEnviando(false);
    }
  }
  return (
    <form onSubmit={enviar} className="admin-formulario">
      <h3>{titulo}</h3>
      {mensagem && (
        <p
          className={"admin-aviso " + (erro ? "erro" : "sucesso")}
          role={erro ? "alert" : "status"}
        >
          {mensagem}
        </p>
      )}
      <fieldset key={versao} disabled={enviando}>
        {children}
      </fieldset>
      <button className="admin-botao" disabled={enviando}>
        {enviando ? "Salvando…" : "Salvar cadastro"}
      </button>
    </form>
  );
}
