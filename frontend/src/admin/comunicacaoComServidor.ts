import { useCallback, useEffect, useState } from "react";

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
  const atualizar = useCallback(() => definirRevisao((valor) => valor + 1), []);

  useEffect(() => {
    if (!endereco) {
      definirDados(null);
      definirErro("");
      definirCarregando(false);
      return;
    }

    const controle = new AbortController();
    definirDados(null);
    definirCarregando(true);
    definirErro("");
    consultarServidor<T>(endereco, { signal: controle.signal })
      .then((resultado) => {
        if (!controle.signal.aborted) definirDados(resultado);
      })
      .catch((falha) => {
        if (!controle.signal.aborted) {
          definirDados(null);
          definirErro(falha.message);
        }
      })
      .finally(() => {
        if (!controle.signal.aborted) definirCarregando(false);
      });
    return () => controle.abort();
  }, [endereco, revisao]);

  return { dados, erro, carregando, atualizar };
}

export function alterarDados(endereco: string, dados: object, metodo = "POST") {
  return consultarServidor(endereco, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
}

let confirmacaoBancaria: { prova: string; expiraEm: number } | null = null;

function pedirCredenciaisBancarias(
  segundoFator: boolean,
  substituir = false,
): Promise<{ senha: string; codigo?: string; trocar?: boolean }> {
  return new Promise((resolver, rejeitar) => {
    const janela = document.createElement("dialog");
    janela.setAttribute("aria-labelledby", "titulo-confirmacao-bancaria");
    janela.className = "bancario-mfa-dialog";
    janela.innerHTML = `<form method="dialog">
      <h2 id="titulo-confirmacao-bancaria" style="margin:0">Confirmar ação bancária</h2>
      <p style="margin:0">Digite sua senha da equipe${substituir ? " e um código de recuperação não utilizado para trocar de dispositivo" : segundoFator ? " e o código do aplicativo autenticador (ou um código de recuperação)" : ""}. ${substituir ? "A troca só será concluída após validar o novo aplicativo." : "A confirmação vale por cinco minutos nesta sessão."}</p>
      <input type="password" name="senha" autocomplete="current-password" required maxlength="128"
        aria-label="Senha da equipe" />
      ${segundoFator ? '<input type="text" name="codigo" autocomplete="one-time-code" required maxlength="20" aria-label="Código do autenticador ou de recuperação" />' : ""}
      <div class="bancario-mfa-acoes">
        <button type="button" data-cancelar>Cancelar</button>
        <button type="submit" class="admin-botao">Confirmar</button>
      </div>${segundoFator && !substituir ? '<button class="bancario-mfa-trocar" type="button" data-trocar>Perdi o autenticador — trocar dispositivo</button>' : ""}</form>`;
    document.body.append(janela);
    let concluido = false;
    const terminar = (dados?: {
      senha: string;
      codigo?: string;
      trocar?: boolean;
    }) => {
      if (concluido) return;
      concluido = true;
      janela.close();
      janela.remove();
      if (dados) resolver(dados);
      else rejeitar(new Error("Confirmação bancária cancelada."));
    };
    janela
      .querySelector("[data-cancelar]")
      ?.addEventListener("click", () => terminar());
    janela
      .querySelector("[data-trocar]")
      ?.addEventListener("click", () => terminar({ senha: "", trocar: true }));
    janela.addEventListener("cancel", () => terminar());
    janela.querySelector("form")?.addEventListener("submit", (evento) => {
      evento.preventDefault();
      const senha = (janela.querySelector('[name="senha"]') as HTMLInputElement)
        .value;
      const codigo = (
        janela.querySelector('[name="codigo"]') as HTMLInputElement | null
      )?.value
        .trim()
        .toUpperCase();
      if (senha && (!segundoFator || codigo)) terminar({ senha, codigo });
    });
    janela.showModal();
    janela.querySelector("input")?.focus();
  });
}

async function configurarMfaBancario(
  substituir = false,
  recuperacaoId?: string,
) {
  const { senha, codigo } = await pedirCredenciaisBancarias(
    substituir,
    substituir,
  );
  const inicio = await consultarServidor<{ segredo: string }>(
    recuperacaoId
      ? `/api/admin/bancario/mfa/recuperacao/${recuperacaoId}/iniciar`
      : substituir
        ? "/api/admin/bancario/mfa/substituir"
        : "/api/admin/bancario/mfa/iniciar",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha, codigo_recuperacao: codigo }),
    },
  );
  if (!/^[A-Z2-7]{32}$/.test(inicio.segredo))
    throw new Error("O servidor enviou um segredo MFA inválido.");

  await new Promise<void>((resolver, rejeitar) => {
    const janela = document.createElement("dialog");
    janela.setAttribute("aria-labelledby", "titulo-ativacao-mfa");
    janela.className = "bancario-mfa-dialog";
    const form = document.createElement("form");
    const titulo = document.createElement("h2");
    titulo.id = "titulo-ativacao-mfa";
    titulo.textContent = "Ativar autenticador bancário";
    const instrucao = document.createElement("p");
    instrucao.textContent =
      "No aplicativo autenticador, adicione uma conta manualmente com o nome Ecosol e esta chave:";
    const segredo = document.createElement("code");
    segredo.textContent = inicio.segredo;
    const codigo = document.createElement("input");
    codigo.type = "text";
    codigo.inputMode = "numeric";
    codigo.autocomplete = "one-time-code";
    codigo.maxLength = 6;
    codigo.required = true;
    codigo.placeholder = "Código de 6 dígitos";
    codigo.setAttribute("aria-label", "Código de ativação do autenticador");
    const erro = document.createElement("p");
    erro.setAttribute("role", "alert");
    erro.className = "bancario-mfa-erro";
    const cancelar = document.createElement("button");
    cancelar.type = "button";
    cancelar.textContent = "Cancelar";
    const confirmar = document.createElement("button");
    confirmar.type = "submit";
    confirmar.className = "admin-botao";
    confirmar.textContent = "Ativar";
    form.append(titulo, instrucao, segredo, codigo, erro, cancelar, confirmar);
    janela.append(form);
    document.body.append(janela);
    let ativado = false;
    const fechar = (sucesso: boolean) => {
      janela.close();
      janela.remove();
      if (sucesso) resolver();
      else rejeitar(new Error("Ativação do MFA cancelada."));
    };
    janela.addEventListener("cancel", (evento) => {
      if (ativado) evento.preventDefault();
      else {
        evento.preventDefault();
        fechar(false);
      }
    });
    cancelar.addEventListener("click", () => fechar(false));
    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      confirmar.disabled = true;
      erro.textContent = "";
      try {
        const resposta = await consultarServidor<{
          codigos_recuperacao: string[];
        }>("/api/admin/bancario/mfa/ativar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codigo: codigo.value.trim() }),
        });
        ativado = true;
        form.replaceChildren();
        const aviso = document.createElement("p");
        aviso.textContent =
          "Guarde estes códigos em local seguro. Cada um funciona uma única vez e eles não serão exibidos novamente. Aguarde um novo código no aplicativo antes da próxima confirmação.";
        const lista = document.createElement("pre");
        lista.textContent = resposta.codigos_recuperacao.join("\n");
        const guardar = document.createElement("button");
        guardar.type = "button";
        guardar.className = "admin-botao";
        guardar.textContent = "Guardei os códigos";
        guardar.addEventListener("click", () => fechar(true));
        form.append(titulo, aviso, lista, guardar);
      } catch (falha) {
        erro.textContent = (falha as Error).message;
        confirmar.disabled = false;
      }
    });
    janela.showModal();
    codigo.focus();
  });
}

export async function configurarMfaRecuperado(pedidoId: string) {
  await configurarMfaBancario(false, pedidoId);
  confirmacaoBancaria = null;
}

export async function consultarServidorBancario<T>(
  endereco: string,
  opcoes: RequestInit,
): Promise<T> {
  const estado = await consultarServidor<{ ativo: boolean }>(
    "/api/admin/bancario/mfa",
  );
  if (!estado.ativo) {
    confirmacaoBancaria = null;
    await configurarMfaBancario();
  }
  if (
    !confirmacaoBancaria ||
    confirmacaoBancaria.expiraEm <= Date.now() + 5000
  ) {
    let credenciais;
    do {
      credenciais = await pedirCredenciaisBancarias(true);
      if (credenciais.trocar) {
        confirmacaoBancaria = null;
        await configurarMfaBancario(true);
      }
    } while (credenciais.trocar);
    const { senha, codigo } = credenciais;
    const resposta = await consultarServidor<{
      prova: string;
      expira_em: number;
    }>("/api/admin/bancario/confirmar-identidade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha, codigo }),
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
