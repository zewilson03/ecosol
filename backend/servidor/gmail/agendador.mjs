export function criarAgendadorGmail({
  listarContas,
  sincronizador,
  intervaloMs = 5 * 60_000,
  agendar = setInterval,
  cancelar = clearInterval,
}) {
  let encerrando = false;
  let intervalo;
  const execucoes = new Set();

  function executar() {
    if (encerrando) return;
    for (const conta of listarContas()) {
      if (conta.status_autorizacao !== "conectada" || conta.pausada) continue;
      if (sincronizador.emAndamento(conta.id)) continue;
      const execucao = Promise.resolve()
        .then(() => sincronizador.sincronizar(conta.id))
        .catch(() => {
          // A falha categorizada fica no progresso; nunca registrar tokens ou e-mails.
        })
        .finally(() => execucoes.delete(execucao));
      execucoes.add(execucao);
    }
  }

  function iniciar() {
    executar();
    intervalo = agendar(executar, intervaloMs);
    intervalo?.unref?.();
  }

  async function parar() {
    if (encerrando) return;
    encerrando = true;
    if (intervalo !== undefined) cancelar(intervalo);
    await Promise.allSettled([...execucoes]);
  }

  return { iniciar, parar };
}
