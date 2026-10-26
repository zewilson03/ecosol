let encerrando = false;

export function aplicacaoAceitaTrafego() {
  return !encerrando;
}

export function marcarAplicacaoEmEncerramento() {
  encerrando = true;
}
