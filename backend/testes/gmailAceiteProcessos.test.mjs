import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { obterBanco } from "../servidor/bancoDeDados.mjs";
import { criarRepositorioGmail } from "../servidor/gmail/repositorio.mjs";

const arquivoTeste = fileURLToPath(import.meta.url);
const arquivoServidor = fileURLToPath(
  new URL("../servidor/iniciar.mjs", import.meta.url),
);
const pastaProjeto = resolve(dirname(arquivoTeste), "../..");
const email = "aceite-processos@gmail.com";
const marco = "9007199254740993";
const primeiraPagina = {
  cursorEsperado: null,
  proximoCursor: "pagina-2",
  mensagens: ["msg-1", "msg-2"],
  agora: 1000,
};
const ultimaPagina = {
  cursorEsperado: "pagina-2",
  proximoCursor: null,
  mensagens: ["msg-2", "msg-3"],
  agora: 2000,
};

function contaERepositorio() {
  const banco = obterBanco();
  const repositorio = criarRepositorioGmail(banco);
  const conta = repositorio.listarContas().find((item) => item.email === email);
  assert.ok(conta, "A conta configurada não foi preservada.");
  return { banco, repositorio, conta };
}

async function executarFilho(modo) {
  if (modo === "preparar") {
    const banco = obterBanco();
    const repo = criarRepositorioGmail(banco);
    const conta = repo.cadastrarConta({ email, dataInicio: "2026-10-05" });
    repo.definirAutorizacao({ contaId: conta.id, estado: "conectada" });
    repo.definirPausa({ contaId: conta.id, pausada: false });
    const inicio = repo.iniciarVarreduraCompleta({
      contaId: conta.id,
      historyId: marco,
    });
    repo.registrarPagina({
      contaId: conta.id,
      versaoEsperada: inicio.versao,
      ...primeiraPagina,
    });
    process.stdout.write("PREPARADO\n");
    return;
  }

  if (modo === "retomar") {
    const { repositorio: repo, conta } = contaERepositorio();
    assert.equal(conta.data_inicio, "2026-10-05");
    const antes = repo.obterProgresso(conta.id);
    assert.equal(antes.cursor_pagina, "pagina-2");
    assert.equal(repo.listarMensagens({ contaId: conta.id }).length, 2);
    const repetida = repo.registrarPagina({
      contaId: conta.id,
      versaoEsperada: antes.ultimo_lote_versao,
      ...primeiraPagina,
    });
    assert.equal(repetida.repetida, true);
    assert.equal(repo.listarMensagens({ contaId: conta.id }).length, 2);
    repo.registrarPagina({
      contaId: conta.id,
      versaoEsperada: antes.versao,
      ...ultimaPagina,
    });
    const m1 = repo.reservarMensagem({
      contaId: conta.id,
      agora: 10000,
      leaseMs: 1000,
    });
    assert.equal(m1.message_id, "msg-1");
    assert.equal(
      repo.registrarAnexosDaMensagem({
        mensagemId: m1.id,
        leaseToken: m1.lease_token,
        anexos: [
          {
            partPath: "0.1",
            attachmentId: "anexo-1",
            nome: "fatura.pdf",
            mimeType: "application/pdf",
          },
        ],
        agora: 10001,
      }),
      true,
    );
    const m2 = repo.reservarMensagem({
      contaId: conta.id,
      agora: 10000,
      leaseMs: 1000,
    });
    assert.equal(m2.message_id, "msg-2");
    assert.equal(
      repo.registrarFalhaMensagem({
        mensagemId: m2.id,
        leaseToken: m2.lease_token,
        codigo: "gmail_429",
        temporaria: true,
        proximaTentativaEm: 20000,
        agora: 10001,
      }),
      true,
    );
    const anexo = repo.reservarAnexo({
      contaId: conta.id,
      agora: 10000,
      leaseMs: 1000,
    });
    assert.equal(
      repo.registrarFalhaAnexo({
        anexoId: anexo.id,
        leaseToken: anexo.lease_token,
        codigo: "gmail_429",
        temporaria: true,
        proximaTentativaEm: 20000,
        agora: 10001,
      }),
      true,
    );
    process.stdout.write("RETOMADO\n");
    return;
  }

  if (modo === "verificar") {
    const { banco, repositorio: repo, conta } = contaERepositorio();
    assert.equal(conta.data_inicio, "2026-10-05");
    assert.equal(conta.status_autorizacao, "conectada");
    assert.equal(conta.pausada, 0);
    const progresso = repo.obterProgresso(conta.id);
    assert.equal(progresso.fase, "historico");
    assert.equal(progresso.cursor_pagina, null);
    assert.equal(progresso.history_id, marco);
    assert.equal(repo.listarMensagens({ contaId: conta.id }).length, 3);
    assert.equal(
      repo.listarMensagens({ contaId: conta.id, estado: "detalhada" }).length,
      1,
    );
    assert.equal(
      repo.listarMensagens({ contaId: conta.id, estado: "falha_temporaria" })
        .length,
      1,
    );
    const anexos = repo.listarAnexos({ contaId: conta.id });
    assert.equal(anexos.length, 1);
    assert.equal(anexos[0].estado, "falha_temporaria");
    assert.equal(anexos[0].proxima_tentativa_em, 20000);
    assert.equal(
      repo.registrarPagina({
        contaId: conta.id,
        versaoEsperada: progresso.ultimo_lote_versao,
        ...ultimaPagina,
      }).repetida,
      true,
    );
    assert.equal(repo.listarMensagens({ contaId: conta.id }).length, 3);
    assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      banco.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    process.stdout.write("VERIFICADO\n");
    return;
  }

  if (modo === "reservar") {
    const { repositorio: repo, conta } = contaERepositorio();
    process.stdin.resume();
    process.stdout.write("PRONTO\n");
    await new Promise((resolver) => process.stdin.once("data", resolver));
    process.stdin.pause();
    process.stdout.write("TENTANDO\n");
    const mensagem = repo.reservarMensagem({
      contaId: conta.id,
      agora: 15000,
      leaseMs: 1000,
    });
    assert.equal(mensagem.message_id, "msg-3");
    process.stdout.write("RESERVADO\n");
    return;
  }

  if (modo === "timeout-da-reserva") {
    const { repositorio: repo, conta } = contaERepositorio();
    process.stdin.resume();
    process.stdout.write("PRONTO\n");
    await new Promise((resolver) => process.stdin.once("data", resolver));
    assert.throws(
      () =>
        repo.reservarMensagem({
          contaId: conta.id,
          agora: 22000,
          leaseMs: 1000,
        }),
      (erro) => erro.errcode === 5 || /database is locked/i.test(erro.message),
    );
    process.stdout.write("BUSY\n");
    await new Promise((resolver) => process.stdin.once("data", resolver));
    process.stdin.pause();
    const mensagem = repo.reservarMensagem({
      contaId: conta.id,
      agora: 22000,
      leaseMs: 1000,
    });
    assert.ok(mensagem);
    process.stdout.write("RESERVA_RECUPERADA\n");
    return;
  }

  if (modo === "timeout-e-retomada") {
    process.stdin.resume();
    process.stdout.write("PRONTO\n");
    assert.throws(
      () => obterBanco(),
      (erro) => erro.errcode === 5 || /database is locked/i.test(erro.message),
    );
    process.stdout.write("BUSY\n");
    await new Promise((resolver) => process.stdin.once("data", resolver));
    process.stdin.pause();
    const { repositorio: repo, conta } = contaERepositorio();
    assert.equal(repo.obterProgresso(conta.id).history_id, marco);
    process.stdout.write("REINICIADO\n");
    return;
  }

  if (modo === "disputar-pagina" || modo === "disputar-reserva") {
    const { repositorio: repo, conta } = contaERepositorio();
    const versao = repo.obterProgresso(conta.id).versao;
    process.stdin.resume();
    process.stdout.write("PRONTO\n");
    await new Promise((resolver) => process.stdin.once("data", resolver));
    process.stdin.pause();
    if (modo === "disputar-pagina") {
      process.stdout.write("TENTANDO\n");
      const resultado = repo.registrarPagina({
        contaId: conta.id,
        versaoEsperada: versao,
        cursorEsperado: null,
        proximoCursor: null,
        mensagens: ["msg-3", "msg-4"],
        novoHistoryId: "9007199254740994",
        agora: 3000,
      });
      process.stdout.write(
        `PAGINA:${resultado.repetida ? "REPETIDA" : "NOVA"}\n`,
      );
    } else {
      process.stdout.write("TENTANDO\n");
      const mensagem = repo.reservarMensagem({
        contaId: conta.id,
        agora: 20000,
        leaseMs: 1000,
      });
      assert.ok(mensagem);
      process.stdout.write(`RESERVA:${mensagem.message_id}\n`);
    }
    return;
  }

  if (modo === "interromper-antes-do-commit") {
    const { banco, conta } = contaERepositorio();
    const repositorioInterrompido = criarRepositorioGmail({
      exec: (sql) => banco.exec(sql),
      prepare: (sql) => {
        const comando = banco.prepare(sql);
        if (!sql.includes("INSERT INTO gmail_mensagens")) return comando;
        return {
          run: (...parametros) => {
            comando.run(...parametros);
            // A inserção ainda está dentro da transação de registrarPagina.
            process.exit(23);
          },
        };
      },
    });
    const progresso = repositorioInterrompido.obterProgresso(conta.id);
    repositorioInterrompido.registrarPagina({
      contaId: conta.id,
      versaoEsperada: progresso.versao,
      cursorEsperado: null,
      mensagens: ["msg-sem-commit"],
      novoHistoryId: "9007199254740995",
      agora: 4000,
    });
    throw new Error("A interrupção simulada não ocorreu.");
  }

  if (modo === "recuperar-apos-interrupcao") {
    const { repositorio: repo, conta } = contaERepositorio();
    const progresso = repo.obterProgresso(conta.id);
    const pagina = repo.registrarPagina({
      contaId: conta.id,
      versaoEsperada: progresso.versao,
      cursorEsperado: null,
      mensagens: ["msg-sem-commit"],
      novoHistoryId: "9007199254740995",
      agora: 4000,
    });
    assert.equal(pagina.inseridos, 1);
    assert.equal(pagina.progresso.history_id, "9007199254740995");
    process.stdout.write("RECUPERADO\n");
    return;
  }

  throw new Error(`Modo de teste desconhecido: ${modo}`);
}

function rastrear(processo) {
  let saida = "";
  let erros = "";
  let encerrado = false;
  let codigoFinal = null;
  processo.once("close", (codigo) => {
    encerrado = true;
    codigoFinal = codigo;
  });
  processo.stdout.on("data", (dados) => {
    saida += dados.toString();
  });
  processo.stderr.on("data", (dados) => {
    erros += dados.toString();
  });
  return {
    processo,
    saida: () => saida,
    erros: () => erros,
    async esperar(marcador, limiteMs = 12000) {
      if (saida.includes(marcador)) return;
      await new Promise((resolver, rejeitar) => {
        const limite = setTimeout(() => {
          limpar();
          rejeitar(
            new Error(`Tempo esgotado aguardando ${marcador}. ${erros}`),
          );
        }, limiteMs);
        const verificar = () => {
          if (!saida.includes(marcador)) return;
          limpar();
          resolver();
        };
        const fechar = () => {
          limpar();
          rejeitar(
            new Error(`Processo encerrou antes de ${marcador}. ${erros}`),
          );
        };
        function limpar() {
          clearTimeout(limite);
          processo.stdout.off("data", verificar);
          processo.off("close", fechar);
        }
        processo.stdout.on("data", verificar);
        processo.once("close", fechar);
        verificar();
      });
    },
    async finalizar(limiteMs = 12000) {
      if (encerrado) return codigoFinal;
      return await new Promise((resolver, rejeitar) => {
        const limite = setTimeout(() => {
          processo.kill();
          rejeitar(
            new Error(
              `Processo não encerrou: pid=${processo.pid}, exit=${processo.exitCode}, signal=${processo.signalCode}, killed=${processo.killed}. ${erros}`,
            ),
          );
        }, limiteMs);
        processo.once("close", (codigo) => {
          clearTimeout(limite);
          resolver(codigo);
        });
      });
    },
  };
}

async function aceite() {
  const pasta = mkdtempSync(join(tmpdir(), "ecosol-gmail-aceite-"));
  const caminhoBanco = join(pasta, "ecosol.db");
  const ambiente = {
    ...process.env,
    ECOSOL_DATA_DIR: pasta,
    NODE_ENV: "production",
    PORT: "0",
  };
  const processosAtivos = new Set();
  const registrarProcesso = (processo) => {
    processosAtivos.add(processo);
    processo.once("close", () => processosAtivos.delete(processo));
    return processo;
  };
  const filho = (modo) =>
    registrarProcesso(
      spawn(process.execPath, [arquivoTeste, modo], {
        cwd: pastaProjeto,
        env: ambiente,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }),
    );
  const rodar = (modo, marcador) => {
    const resultado = spawnSync(process.execPath, [arquivoTeste, modo], {
      cwd: pastaProjeto,
      env: ambiente,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    assert.equal(resultado.error, undefined, resultado.stderr);
    assert.equal(resultado.status, 0, resultado.stderr);
    assert.match(resultado.stdout, new RegExp(marcador));
  };
  const ligarServidor = async () => {
    const servidor = rastrear(
      registrarProcesso(
        spawn(process.execPath, [arquivoServidor], {
          cwd: pastaProjeto,
          env: ambiente,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        }),
      ),
    );
    try {
      await servidor.esperar("Ecosol disponível", 15000);
    } finally {
      servidor.processo.kill();
      await servidor.finalizar();
    }
  };

  let bancoDeBloqueio;
  let concluido = false;
  try {
    // A primeira partida deve criar as tabelas sem depender do teste unitário.
    assert.equal(existsSync(caminhoBanco), false);
    await ligarServidor();
    assert.equal(existsSync(caminhoBanco), true);
    const bancoInicial = new DatabaseSync(caminhoBanco, { readOnly: true });
    try {
      assert.deepEqual(
        bancoInicial
          .prepare(
            "SELECT name FROM sqlite_master WHERE type=? AND name LIKE ? ORDER BY name",
          )
          .all("table", "gmail_%")
          .map((item) => item.name),
        [
          "gmail_anexos",
          "gmail_auditoria",
          "gmail_contas",
          "gmail_credenciais",
          "gmail_mensagens",
          "gmail_oauth_tentativas",
          "gmail_sincronizacoes",
        ],
      );
    } finally {
      bancoInicial.close();
    }
    rodar("preparar", "PREPARADO");
    await ligarServidor();
    rodar("retomar", "RETOMADO");
    await ligarServidor();
    rodar("verificar", "VERIFICADO");

    bancoDeBloqueio = new DatabaseSync(caminhoBanco);
    bancoDeBloqueio.exec("PRAGMA busy_timeout=5000");

    // Outro processo deve aguardar um lock curto e reservar apenas uma vez.
    const reserva = rastrear(filho("reservar"));
    await reserva.esperar("PRONTO");
    bancoDeBloqueio.exec("BEGIN IMMEDIATE");
    try {
      reserva.processo.stdin.write("CONTINUAR\n");
      await reserva.esperar("TENTANDO");
      assert.equal(
        bancoDeBloqueio
          .prepare(
            "SELECT estado FROM gmail_mensagens WHERE message_id='msg-3'",
          )
          .get().estado,
        "pendente",
      );
      await new Promise((resolver) => setTimeout(resolver, 250));
      assert.equal(reserva.saida().includes("RESERVADO"), false);
    } finally {
      bancoDeBloqueio.exec("COMMIT");
    }
    await reserva.esperar("RESERVADO");
    assert.equal(await reserva.finalizar(), 0, reserva.erros());
    const antesDoTimeout = bancoDeBloqueio
      .prepare(
        "SELECT estado,tentativas,lease_token FROM gmail_mensagens WHERE message_id='msg-3'",
      )
      .get();
    assert.equal(antesDoTimeout.estado, "em_processamento");
    assert.equal(antesDoTimeout.tentativas, 1);

    // Após o limite de espera, a inicialização falha sem alterar a fila.
    // A mesma instância de processo deve conseguir reabrir após liberar o lock.
    bancoDeBloqueio.exec("BEGIN IMMEDIATE");
    let retomada;
    try {
      retomada = rastrear(filho("timeout-e-retomada"));
      await retomada.esperar("PRONTO");
      await retomada.esperar("BUSY", 10000);
      assert.deepEqual(
        bancoDeBloqueio
          .prepare(
            "SELECT estado,tentativas,lease_token FROM gmail_mensagens WHERE message_id='msg-3'",
          )
          .get(),
        antesDoTimeout,
      );
    } finally {
      bancoDeBloqueio.exec("COMMIT");
    }
    retomada.processo.stdin.write("CONTINUAR\n");
    await retomada.esperar("REINICIADO");
    assert.equal(await retomada.finalizar(), 0, retomada.erros());
    assert.deepEqual(
      bancoDeBloqueio
        .prepare(
          "SELECT estado,tentativas,lease_token FROM gmail_mensagens WHERE message_id='msg-3'",
        )
        .get(),
      antesDoTimeout,
    );

    // Dois processos partem da mesma versão: um confirma a página, o outro
    // reconhece a repetição sem duplicar a mensagem ou avançar duas vezes.
    const versaoAntesDaDisputa = bancoDeBloqueio
      .prepare("SELECT versao FROM gmail_sincronizacoes")
      .get().versao;
    const paginas = [
      rastrear(filho("disputar-pagina")),
      rastrear(filho("disputar-pagina")),
    ];
    await Promise.all(paginas.map((item) => item.esperar("PRONTO")));
    bancoDeBloqueio.exec("BEGIN IMMEDIATE");
    try {
      for (const item of paginas) item.processo.stdin.write("CONTINUAR\n");
      await Promise.all(paginas.map((item) => item.esperar("TENTANDO")));
      await new Promise((resolver) => setTimeout(resolver, 100));
      assert.ok(paginas.every((item) => !item.saida().includes("PAGINA:")));
    } finally {
      bancoDeBloqueio.exec("COMMIT");
    }
    await Promise.all(paginas.map((item) => item.esperar("PAGINA:")));
    for (const item of paginas)
      assert.equal(await item.finalizar(), 0, item.erros());
    assert.deepEqual(
      paginas
        .map((item) => item.saida().match(/PAGINA:(NOVA|REPETIDA)/)?.[1])
        .sort(),
      ["NOVA", "REPETIDA"],
    );
    assert.equal(
      bancoDeBloqueio.prepare("SELECT versao FROM gmail_sincronizacoes").get()
        .versao,
      versaoAntesDaDisputa + 1,
    );
    assert.equal(
      bancoDeBloqueio
        .prepare(
          "SELECT COUNT(*) AS total FROM gmail_mensagens WHERE message_id='msg-4'",
        )
        .get().total,
      1,
    );

    // Dois trabalhadores não podem receber a mesma reserva simultaneamente.
    const reservas = [
      rastrear(filho("disputar-reserva")),
      rastrear(filho("disputar-reserva")),
    ];
    await Promise.all(reservas.map((item) => item.esperar("PRONTO")));
    bancoDeBloqueio.exec("BEGIN IMMEDIATE");
    try {
      for (const item of reservas) item.processo.stdin.write("CONTINUAR\n");
      await Promise.all(reservas.map((item) => item.esperar("TENTANDO")));
      await new Promise((resolver) => setTimeout(resolver, 100));
      assert.ok(reservas.every((item) => !item.saida().includes("RESERVA:")));
    } finally {
      bancoDeBloqueio.exec("COMMIT");
    }
    await Promise.all(reservas.map((item) => item.esperar("RESERVA:")));
    for (const item of reservas)
      assert.equal(await item.finalizar(), 0, item.erros());
    const idsReservados = reservas.map(
      (item) => item.saida().match(/RESERVA:(msg-[0-9]+)/)?.[1],
    );
    assert.equal(new Set(idsReservados).size, 2);
    assert.ok(idsReservados.every(Boolean));

    // O timeout de uma operação da fila não altera tentativas nem deixa
    // reserva parcial; repetir após liberar o lock produz uma única reserva.
    const tentativasAntes = bancoDeBloqueio
      .prepare("SELECT SUM(tentativas) AS total FROM gmail_mensagens")
      .get().total;
    const reservaComTimeout = rastrear(filho("timeout-da-reserva"));
    await reservaComTimeout.esperar("PRONTO");
    bancoDeBloqueio.exec("BEGIN IMMEDIATE");
    try {
      reservaComTimeout.processo.stdin.write("CONTINUAR\n");
      await reservaComTimeout.esperar("BUSY", 10000);
      assert.equal(
        bancoDeBloqueio
          .prepare("SELECT SUM(tentativas) AS total FROM gmail_mensagens")
          .get().total,
        tentativasAntes,
      );
    } finally {
      bancoDeBloqueio.exec("COMMIT");
    }
    reservaComTimeout.processo.stdin.write("TENTAR_NOVAMENTE\n");
    await reservaComTimeout.esperar("RESERVA_RECUPERADA");
    assert.equal(
      await reservaComTimeout.finalizar(),
      0,
      reservaComTimeout.erros(),
    );
    assert.equal(
      bancoDeBloqueio
        .prepare("SELECT SUM(tentativas) AS total FROM gmail_mensagens")
        .get().total,
      tentativasAntes + 1,
    );

    // Encerrar o processo após inserir um ID, mas antes do COMMIT, não pode
    // deixar a mensagem nem avançar o checkpoint pela metade.
    const antesDaInterrupcao = bancoDeBloqueio
      .prepare(
        "SELECT versao,history_id,cursor_pagina FROM gmail_sincronizacoes",
      )
      .get();
    const interrompido = spawnSync(
      process.execPath,
      [arquivoTeste, "interromper-antes-do-commit"],
      {
        cwd: pastaProjeto,
        env: ambiente,
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
      },
    );
    assert.equal(interrompido.error, undefined, interrompido.stderr);
    assert.equal(interrompido.status, 23, interrompido.stderr);
    assert.deepEqual(
      bancoDeBloqueio
        .prepare(
          "SELECT versao,history_id,cursor_pagina FROM gmail_sincronizacoes",
        )
        .get(),
      antesDaInterrupcao,
    );
    assert.equal(
      bancoDeBloqueio
        .prepare(
          "SELECT COUNT(*) AS total FROM gmail_mensagens WHERE message_id='msg-sem-commit'",
        )
        .get().total,
      0,
    );
    rodar("recuperar-apos-interrupcao", "RECUPERADO");
    assert.equal(
      bancoDeBloqueio
        .prepare(
          "SELECT COUNT(*) AS total FROM gmail_mensagens WHERE message_id='msg-sem-commit'",
        )
        .get().total,
      1,
    );

    assert.deepEqual(
      bancoDeBloqueio.prepare("PRAGMA foreign_key_check").all(),
      [],
    );
    assert.equal(
      bancoDeBloqueio.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    console.log(
      "Aceite Gmail: reinício, replay e concorrência entre processos OK.",
    );
    concluido = true;
  } finally {
    const restantes = [...processosAtivos];
    for (const processo of restantes) {
      processo.stdin?.end();
      if (processo.exitCode === null && processo.signalCode === null)
        processo.kill();
    }
    await Promise.all(
      restantes.map(
        (processo) =>
          new Promise((resolver) => {
            if (!processosAtivos.has(processo)) return resolver();
            const limite = setTimeout(() => {
              processo.kill("SIGKILL");
              processo.stdout?.destroy();
              processo.stderr?.destroy();
              resolver();
            }, 3000);
            processo.once("close", () => {
              clearTimeout(limite);
              resolver();
            });
          }),
      ),
    );
    bancoDeBloqueio?.close();
    if (concluido) {
      const destino = resolve(pasta);
      if (
        resolve(dirname(destino)) !== resolve(tmpdir()) ||
        !basename(destino).startsWith("ecosol-gmail-aceite-")
      )
        throw new Error("Diretório temporário de teste inesperado.");
      rmSync(destino, { recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

if (process.argv[2]) {
  try {
    await executarFilho(process.argv[2]);
  } catch (erro) {
    console.error(erro);
    process.exitCode = 1;
  }
} else {
  await aceite();
}
