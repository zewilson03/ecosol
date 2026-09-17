import { useEffect, useState } from "react";

export type Cliente = {
  id: number;
  name: string;
  cpf: string;
  email: string;
  ready: number;
};

export type Administrador = {
  id: number;
  name: string;
  cpf: string | null;
  email: string;
  access_level: number;
};

export type Contato = {
  id: number;
  name: string;
  email: string;
  phone: string;
  city: string;
  message: string;
  status: string;
  created_at: string;
};

export type DadosDaEquipe = {
  contatos: Contato[];
  clientes: Cliente[];
  administradores: Administrador[];
};

export type Sessao =
  | { perfil: null }
  | {
      perfil: "equipe";
      administrador: { id: number | null; nome: string; nivel: number };
    }
  | {
      perfil: "cliente";
      cliente: Pick<Cliente, "name" | "email" | "cpf">;
    };

export function usarDados<T>(endereco: string) {
  const [dados, definirDados] = useState<T | null>(null);
  const [carregando, definirCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;

    fetch(endereco, { credentials: "same-origin" })
      .then((resposta) => resposta.json())
      .then((resultado: T) => {
        if (ativo) definirDados(resultado);
      })
      .catch(() => {
        if (ativo) definirDados(null);
      })
      .finally(() => {
        if (ativo) definirCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [endereco]);

  return { dados, carregando };
}
