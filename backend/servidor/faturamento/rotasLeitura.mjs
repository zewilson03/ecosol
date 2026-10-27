import { Router } from "express";
import { falhar } from "./regras.mjs";

// A composição fornece a persistência; este adaptador conhece apenas a porta
// de leitura, sem abrir conexões ou escolher um banco por conta própria.
export function criarRotasLeituraFaturamento({ obterRepositorio }) {
  const rotas = Router();

  rotas.get("/unidades", (_req, res) => {
    const repositorio = obterRepositorio();
    res.json(repositorio.listarUnidadesDetalhadas());
  });

  rotas.get("/documentos", (req, res) => {
    const limiteInformado = req.query.limite;
    const limite =
      limiteInformado === undefined ? undefined : Number(limiteInformado);
    const cursor =
      req.query.cursor === undefined ? undefined : Number(req.query.cursor);
    if (
      (limite !== undefined && (!Number.isSafeInteger(limite) || limite < 1)) ||
      (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1))
    )
      falhar("Paginação inválida.");
    const pagina = obterRepositorio().listarDocumentosResumo({
      limite,
      cursor,
    });
    if (limite === undefined) return res.json(pagina.itens);
    return res.json({
      itens: pagina.itens,
      proximo_cursor: pagina.proximoCursor,
    });
  });

  return rotas;
}
