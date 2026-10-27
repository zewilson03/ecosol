import { randomUUID } from "node:crypto";

export function protecaoHttp(origemConfigurada) {
  const enderecoPermitido = new URL(origemConfigurada);
  const origemPermitida = enderecoPermitido.origin;
  const possuiOrigemPermitida = (valor) => {
    if (!valor || valor === "null") return false;
    try {
      return new URL(valor).origin === origemPermitida;
    } catch {
      return false;
    }
  };
  return (req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    // Não vaza caminhos para sites externos, mas permite que WebViews móveis
    // comprovem a origem de formulários internos quando omitem `Origin`.
    res.set("Referrer-Policy", "same-origin");
    res.set("X-Frame-Options", "SAMEORIGIN");
    if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      if (req.headers.origin !== undefined) {
        const origemExplicitaPermitida = possuiOrigemPermitida(
          req.headers.origin,
        );
        // Navegadores em contexto opaco podem enviar Origin: null mesmo para
        // um formulário local. Aceitar somente quando o navegador confirma
        // mesma origem e o Host corresponde ao endereço configurado.
        const origemOpacaLocal =
          req.headers.origin === "null" &&
          req.headers["sec-fetch-site"] === "same-origin" &&
          req.headers.host?.toLowerCase() ===
            enderecoPermitido.host.toLowerCase();
        if (!origemExplicitaPermitida && !origemOpacaLocal)
          return res.sendStatus(403);
      } else if (
        req.headers["sec-fetch-site"] === "cross-site" &&
        !possuiOrigemPermitida(req.headers.referer)
      ) {
        return res.sendStatus(403);
      }
    }
    next();
  };
}

export function tratarErroHttp(erro, req, res, next) {
  if (res.headersSent) return next(erro);
  if (erro.type === "entity.too.large")
    return res
      .status(413)
      .json({ erro: "O conteúdo excede o limite permitido." });
  if (erro.type === "entity.parse.failed")
    return res.status(400).json({ erro: "O conteúdo enviado é inválido." });
  const referencia = req.idRequisicao || randomUUID();
  // Não serializar erro, mensagem, URL ou corpo: podem conter tokens e dados pessoais.
  console.error(
    JSON.stringify({
      evento: "http_internal_error",
      request_id: referencia,
      metodo: req.method,
      categoria: erro?.name || "Error",
    }),
  );
  res
    .status(500)
    .json({ erro: "Não foi possível concluir a solicitação.", referencia });
}
