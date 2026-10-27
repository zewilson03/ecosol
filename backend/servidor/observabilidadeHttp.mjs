import { randomUUID } from "node:crypto";

function identificadorAceitavel(valor) {
  return typeof valor === "string" && /^[a-f0-9-]{20,64}$/i.test(valor);
}

function rotaNormalizada(requisicao) {
  if (requisicao.route?.path)
    return `${requisicao.baseUrl ?? ""}${requisicao.route.path}` || "/";
  return requisicao.path.startsWith("/api/")
    ? "api_nao_correspondida"
    : "pagina";
}

export function observabilidadeHttp({
  agora = () => performance.now(),
  identificador = randomUUID,
  registrar = (evento) => console.info(JSON.stringify(evento)),
} = {}) {
  return (requisicao, resposta, proximo) => {
    const recebido = requisicao.get("x-request-id");
    const requestId = identificadorAceitavel(recebido)
      ? recebido
      : identificador();
    const inicio = agora();
    requisicao.idRequisicao = requestId;
    resposta.set("X-Request-Id", requestId);

    if (requisicao.path.startsWith("/api/")) {
      resposta.once("finish", () => {
        registrar({
          evento: "http_request",
          request_id: requestId,
          metodo: requisicao.method,
          rota: rotaNormalizada(requisicao),
          status: resposta.statusCode,
          duracao_ms: Math.max(0, Math.round(agora() - inicio)),
        });
      });
    }
    proximo();
  };
}
