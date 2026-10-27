import { useCallback, useEffect, useRef, useState } from "react";

export async function consultarServidor<T>(
  endereco: string,
  opcoes?: RequestInit,
): Promise<T> {
  const resposta = await fetch(endereco, {
    credentials: "same-origin",
    ...opcoes,
    headers: { Accept: "application/json", ...opcoes?.headers },
  });
  const tipo = resposta.headers.get("content-type") ?? "";
  if (!tipo.includes("application/json")) {
    if (resposta.status === 401 || resposta.redirected)
      throw new Error("Sua sessão expirou. Entre novamente no sistema.");
    throw new Error(
      "O servidor precisa ser atualizado. Recarregue a página; se o problema continuar, reinicie o sistema Ecosol.",
    );
  }
  let dados: { erro?: string; codigo?: string } & T;
  try {
    dados = (await resposta.json()) as { erro?: string; codigo?: string } & T;
  } catch {
    throw new Error(
      "O servidor enviou uma resposta incompleta. Recarregue a página e tente novamente.",
    );
  }
  if (!resposta.ok) {
    const falha = new Error(
      dados.erro || "Não foi possível concluir a operação.",
    );
    Object.assign(falha, { status: resposta.status, codigo: dados.codigo });
    throw falha;
  }
  return dados as T;
}

export function usarConsulta<T>(endereco: string | null) {
  const [dados, definirDados] = useState<T | null>(null);
  const [erro, definirErro] = useState("");
  const [carregando, definirCarregando] = useState(Boolean(endereco));
  const [revisao, definirRevisao] = useState(0);
  const enderecoAnterior = useRef<string | null>(null);
  const atualizar = useCallback(() => definirRevisao((valor) => valor + 1), []);

  useEffect(() => {
    if (!endereco) {
      enderecoAnterior.current = null;
      definirDados(null);
      definirErro("");
      definirCarregando(false);
      return;
    }

    const controle = new AbortController();
    if (enderecoAnterior.current !== endereco) {
      enderecoAnterior.current = endereco;
      definirDados(null);
    }
    definirCarregando(true);
    definirErro("");
    consultarServidor<T>(endereco, { signal: controle.signal })
      .then((resultado) => {
        if (!controle.signal.aborted) definirDados(resultado);
      })
      .catch((falha) => {
        if (!controle.signal.aborted) {
          definirErro(falha.message);
        }
      })
      .finally(() => {
        if (!controle.signal.aborted) definirCarregando(false);
      });
    return () => controle.abort();
  }, [endereco, revisao]);

  return {
    dados,
    erro,
    carregando,
    revalidando: carregando && dados !== null,
    atualizar,
  };
}

export function alterarDados(endereco: string, dados: object, metodo = "POST") {
  return consultarServidor(endereco, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
}

let confirmacaoBancaria: { prova: string; expiraEm: number } | null = null;

function pedirSenha(titulo: string, descricao: string): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const janela = document.createElement("dialog");
    janela.setAttribute("aria-labelledby", "titulo-confirmacao-bancaria");
    janela.className = "bancario-confirmacao-dialog";
    janela.innerHTML = `<form method="dialog">
      <h2 id="titulo-confirmacao-bancaria" style="margin:0">${titulo}</h2>
      <p style="margin:0">${descricao}</p>
      <input type="password" name="senha" autocomplete="current-password" required maxlength="128"
        aria-label="Senha" />
      <div class="bancario-confirmacao-acoes">
        <button type="button" data-cancelar>Cancelar</button>
        <button type="submit" class="admin-botao">Confirmar</button>
      </div></form>`;
    document.body.append(janela);
    let concluido = false;
    const terminar = (senha?: string) => {
      if (concluido) return;
      concluido = true;
      janela.close();
      janela.remove();
      if (senha) resolver(senha);
      else rejeitar(new Error("Confirmação bancária cancelada."));
    };
    janela
      .querySelector("[data-cancelar]")
      ?.addEventListener("click", () => terminar());
    janela.addEventListener("cancel", () => terminar());
    janela.querySelector("form")?.addEventListener("submit", (evento) => {
      evento.preventDefault();
      const senha = (janela.querySelector('[name="senha"]') as HTMLInputElement)
        .value;
      if (senha) terminar(senha);
    });
    janela.showModal();
    janela.querySelector("input")?.focus();
  });
}

export async function consultarServidorBancario<T>(
  endereco: string,
  opcoes: RequestInit,
): Promise<T> {
  if (
    !confirmacaoBancaria ||
    confirmacaoBancaria.expiraEm <= Date.now() + 5000
  ) {
    const senha = await pedirSenha(
      "Confirmar ação bancária",
      "Digite sua senha da equipe. A confirmação vale por cinco minutos nesta sessão.",
    );
    const resposta = await consultarServidor<{
      prova: string;
      expira_em: number;
    }>("/api/admin/bancario/confirmar-identidade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha }),
    });
    confirmacaoBancaria = {
      prova: resposta.prova,
      expiraEm: resposta.expira_em,
    };
  }
  try {
    return await consultarServidor<T>(endereco, {
      ...opcoes,
      headers: {
        ...opcoes.headers,
        "X-Ecosol-Confirmacao-Bancaria": confirmacaoBancaria.prova,
      },
    });
  } catch (erro) {
    confirmacaoBancaria = null;
    throw erro;
  }
}

export async function aprovarPagamentoComSenhaDoProprietario<T>(
  endereco: string,
): Promise<T> {
  return executarComSenhaFinanceira<T>(endereco, {}, "Aprovar pagamento");
}

export async function executarComSenhaFinanceira<T>(
  endereco: string,
  dados: Record<string, unknown>,
  titulo: string,
): Promise<T> {
  const senha = await pedirSenha(
    titulo,
    "Digite a senha de confirmação financeira cadastrada pelo Proprietário 1.",
  );
  return consultarServidor<T>(endereco, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...dados, senha }),
  });
}

export const nomesDosNiveis: Record<number, string> = {
  1: "Básico",
  2: "Intermediário",
  3: "Avançado",
};

export function formatarDinheiro(centavos: number) {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatarData(data: string) {
  return data.slice(0, 10).split("-").reverse().join("/");
}
