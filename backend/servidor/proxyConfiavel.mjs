export function configurarProxyConfiavel(aplicacao) {
  // A produção usa um único Caddy no mesmo host. Somente conexões originadas
  // do loopback podem informar o IP original; cabeçalhos enviados diretamente
  // por clientes externos não são aceitos como origem confiável.
  aplicacao.set("trust proxy", "loopback");
}
