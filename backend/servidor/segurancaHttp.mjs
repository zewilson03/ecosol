import { randomUUID } from "node:crypto";

export function protecaoHttp(origemConfigurada) {
  const origemPermitida = new URL(origemConfigurada).origin;
  return (req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-Frame-Options", "SAMEORIGIN");
    if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      if (req.headers["sec-fetch-site"] === "cross-site")
        return res.sendStatus(403);
      if (req.headers.origin !== undefined) {
        try {
          if (new URL(req.headers.origin).origin !== origemPermitida)
            return res.sendStatus(403);
        } catch {
          return res.sendStatus(403);
        }
      }
    }
    next();
  };
}

export function tratarErroHttp(erro, _req, res, next) {
  if (res.headersSent) return next(erro);
  if (erro.type === "entity.too.large")
    return res
      .status(413)
      .json({ erro: "O conteúdo excede o limite permitido." });
  if (erro.type === "entity.parse.failed")
    return res.status(400).json({ erro: "O conteúdo enviado é inválido." });
  const referencia = randomUUID();
  // Não serializar erro, mensagem, URL ou corpo: podem conter tokens e dados pessoais.
  console.error("Erro interno no servidor Ecosol. Referência:", referencia);
  res
    .status(500)
    .json({ erro: "Não foi possível concluir a solicitação.", referencia });
}
