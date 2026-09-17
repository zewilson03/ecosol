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
  const dados = await resposta.json();
  if (!resposta.ok)
    throw new Error(dados.erro || "Não foi possível concluir a operação.");
  return dados;
}

export function usarConsulta<T>(endereco: string) {
  const [dados, definirDados] = useState<T | null>(null);
  const [erro, definirErro] = useState("");
  const [carregando, definirCarregando] = useState(true);
  const [revisao, definirRevisao] = useState(0);
  const atualizar = useCallback(() => definirRevisao((valor) => valor + 1), []);

  useEffect(() => {
    const controle = new AbortController();
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
