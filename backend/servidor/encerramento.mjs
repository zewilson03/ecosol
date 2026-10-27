export function criarEncerramentoOrdenado({
  servidor,
  tarefas = [],
  fecharPersistencia,
  marcarIndisponivel,
  limiteMs = 45_000,
  sair = (codigo) => process.exit(codigo),
  registrar = console,
  agendar = setTimeout,
  cancelarAgendamento = clearTimeout,
}) {
  let encerramento;

  return function encerrar(sinal = "desconhecido") {
    if (encerramento) return encerramento;
    marcarIndisponivel();

    encerramento = (async () => {
      let temporizador;
      const limite = new Promise((_, rejeitar) => {
        temporizador = agendar(() => {
          servidor.closeAllConnections?.();
          rejeitar(new Error("limite_encerramento"));
        }, limiteMs);
        temporizador?.unref?.();
      });

      try {
        const drenagemHttp = new Promise((resolver, rejeitar) => {
          servidor.close((erro) => (erro ? rejeitar(erro) : resolver()));
          servidor.closeIdleConnections?.();
        });
        const paradas = tarefas
          .filter(Boolean)
          .map((tarefa) => Promise.resolve().then(() => tarefa.parar()));

        await Promise.race([Promise.all([drenagemHttp, ...paradas]), limite]);
        await fecharPersistencia();
        cancelarAgendamento(temporizador);
        registrar.info(`Ecosol encerrado com segurança após ${sinal}.`);
        sair(0);
      } catch {
        cancelarAgendamento(temporizador);
        registrar.error(
          "Ecosol não concluiu o encerramento seguro dentro do limite.",
        );
        sair(1);
      }
    })();

    return encerramento;
  };
}
