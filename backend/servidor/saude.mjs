import { Router } from "express";
import { obterBanco } from "./bancoDeDados.mjs";
import { aplicacaoAceitaTrafego } from "./estadoOperacional.mjs";
import { exigirNivel } from "./permissoesDaEquipe.mjs";
import { estadoDasMigracoes } from "./persistencia/migracoes.mjs";

export function criarRotasSaude({
  banco = obterBanco,
  aceitaTrafego = aplicacaoAceitaTrafego,
  protegerProntidao = exigirNivel(3),
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

  rotas.get(
    "/api/admin/saude/prontidao",
    protegerProntidao,
    (_requisicao, resposta) => {
      try {
        const conexao = banco();
        const migracoes = estadoDasMigracoes(conexao);
        const administradores = conexao
          .prepare("SELECT COUNT(*) AS total FROM staff_users")
          .get().total;
        const bancario = conexao
          .prepare(
            `SELECT
               SUM(estado='resultado_desconhecido') AS resultado_desconhecido,
               SUM(estado='envio_pendente') AS envio_pendente
             FROM bancario_operacoes`,
          )
          .get();
        const gmail = conexao
          .prepare(
            `SELECT
               (SELECT COUNT(*) FROM gmail_mensagens WHERE estado IN ('pendente','em_processamento','falha_temporaria')) +
               (SELECT COUNT(*) FROM gmail_anexos WHERE estado IN ('pendente','em_processamento','falha_temporaria')) AS pendentes`,
          )
          .get();
        const disponivel =
          aceitaTrafego() && migracoes.integra && administradores > 0;
        return resposta.status(disponivel ? 200 : 503).json({
          status: disponivel ? "pronto" : "nao_pronto",
          migracoes,
          administradores_configurados: administradores > 0,
          filas: {
            bancario_envio_pendente: bancario.envio_pendente ?? 0,
            bancario_resultado_desconhecido:
              bancario.resultado_desconhecido ?? 0,
            gmail_pendentes: gmail.pendentes ?? 0,
          },
        });
      } catch {
        return resposta.status(503).json({ status: "nao_pronto" });
      }
    },
  );

  return rotas;
}

export const rotasSaude = criarRotasSaude();
