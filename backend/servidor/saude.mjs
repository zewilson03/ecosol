import { Router } from "express";
import { obterBanco } from "./bancoDeDados.mjs";
import { aplicacaoAceitaTrafego } from "./estadoOperacional.mjs";

export function criarRotasSaude({
  banco = obterBanco,
  aceitaTrafego = aplicacaoAceitaTrafego,
} = {}) {
  const rotas = Router();

  rotas.get("/api/saude", (_requisicao, resposta) => {
    try {
      if (!aceitaTrafego())
        return resposta.status(503).json({ status: "indisponivel" });
      banco().prepare("SELECT 1").get();
      return resposta.status(200).json({ status: "disponivel" });
    } catch {
      return resposta.status(503).json({ status: "indisponivel" });
    }
  });

  return rotas;
}

export const rotasSaude = criarRotasSaude();
