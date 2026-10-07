import { createHash, randomUUID } from "node:crypto";

const FUSO_INICIO = "America/Sao_Paulo";
const ESTADOS_AUTORIZACAO = new Set([
  "nao_conectada",
  "conectada",
  "reconectar",
]);
const RESULTADOS_ANEXO = new Set(["capturado", "duplicado"]);

function texto(valor, campo, maximo) {
  if (
    typeof valor !== "string" ||
    !valor.trim() ||
    valor.length > maximo ||
    /[\x00-\x1f\x7f]/.test(valor)
  )
    throw new Error(`${campo} inválido.`);
  return valor.trim();
}

function inteiroPositivo(valor, campo) {
  if (!Number.isSafeInteger(valor) || valor < 1)
    throw new Error(`${campo} inválido.`);
  return valor;
}

function instante(valor) {
  if (!Number.isSafeInteger(valor) || valor < 0)
    throw new Error("Instante inválido.");
  return valor;
}

function opcional(valor, campo, maximo) {
  return valor === null || valor === undefined
    ? null
    : texto(valor, campo, maximo);
}

function historyId(valor) {
  const id = texto(valor, "History ID", 80);
  if (!/^\d+$/.test(id)) throw new Error("History ID inválido.");
  return id;
}

function dataCivil(valor) {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor))
    throw new Error("Data inicial inválida.");
  const data = new Date(`${valor}T12:00:00Z`);
  if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== valor)
    throw new Error("Data inicial inválida.");
  return valor;
}

function anexoValido(item, messageId) {
  if (!item || typeof item !== "object" || Array.isArray(item))
    throw new Error("Anexo candidato inválido.");
  if (
    item.messageId !== undefined &&
    texto(item.messageId, "Message ID", 512) !== messageId
  )
    throw new Error("Anexo não pertence à mensagem reservada.");
  if (item.revisaoEmail !== undefined && typeof item.revisaoEmail !== "boolean")
    throw new Error("Revisão do anexo inválida.");
  return {
    messageId,
    partPath: texto(item.partPath, "Caminho da parte", 256),
    attachmentId: opcional(item.attachmentId, "Attachment ID", 1024),
    nome: texto(item.nome, "Nome do anexo", 255),
    mimeType: texto(item.mimeType, "Tipo do anexo", 127),
    revisaoEmail: item.revisaoEmail === true,
  };
}

function transacao(banco, operacao) {
  banco.exec("BEGIN IMMEDIATE");
  try {
    const resultado = operacao();
    banco.exec("COMMIT");
    return resultado;
  } catch (erro) {
    try {
      banco.exec("ROLLBACK");
    } catch {
      // Se o COMMIT já encerrou a transação, preserve o erro original.
    }
    throw erro;
  }
}

function contaExistente(banco, contaId) {
  const conta = banco
    .prepare("SELECT * FROM gmail_contas WHERE id=?")
    .get(contaId);
  if (!conta) throw new Error("Conta Gmail inexistente.");
  return conta;
}

function contaOperante(banco, contaId) {
  const conta = contaExistente(banco, contaId);
  if (conta.status_autorizacao !== "conectada" || conta.pausada)
    throw new Error("Conta Gmail não está ativa para sincronização.");
  return conta;
}

function invalidarReservas(banco, contaId) {
  for (const tabela of ["gmail_mensagens", "gmail_anexos"]) {
    banco
      .prepare(
        `UPDATE ${tabela} SET estado='pendente', lease_token=NULL,
          lease_ate=NULL, atualizado_em=CURRENT_TIMESTAMP
          WHERE conta_id=? AND estado='em_processamento'`,
      )
      .run(contaId);
  }
}

function progresso(banco, contaId) {
  const atual = banco
    .prepare("SELECT * FROM gmail_sincronizacoes WHERE conta_id=?")
    .get(contaId);
  if (!atual) throw new Error("Progresso da conta Gmail inexistente.");
  return { ...atual };
}

function leaseAtivo(anexo, leaseToken, agora) {
  return (
    anexo?.estado === "em_processamento" &&
    anexo.lease_token === leaseToken &&
    anexo.lease_ate > agora
  );
}

// A data inicial significa a partir de 00:00 do dia civil informado, inclusive,
// no fuso America/Sao_Paulo. O consumidor da API Gmail deve converter esse
// instante para epoch UTC ao construir a consulta, sem usar o fuso padrão da API.
export function criarRepositorioGmail(banco) {
  return {
    cadastrarConta({ email, dataInicio }) {
      const endereco = texto(email, "E-mail", 320).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(endereco))
        throw new Error("E-mail inválido.");
      const inicio = dataCivil(dataInicio);
      return transacao(banco, () => {
        const existente = banco
          .prepare("SELECT * FROM gmail_contas WHERE email=? COLLATE NOCASE")
          .get(endereco);
        if (existente) {
          if (existente.data_inicio !== inicio)
            throw new Error("Data inicial já configurada para esta conta.");
          progresso(banco, existente.id);
          return { ...existente };
        }
        const id = Number(
          banco
            .prepare("INSERT INTO gmail_contas(email,data_inicio) VALUES(?,?)")
            .run(endereco, inicio).lastInsertRowid,
        );
        banco
          .prepare("INSERT INTO gmail_sincronizacoes(conta_id) VALUES(?)")
          .run(id);
        return { ...contaExistente(banco, id) };
      });
    },

    obterConta(contaId) {
      return { ...contaExistente(banco, inteiroPositivo(contaId, "Conta")) };
    },

    listarContas() {
      return banco
        .prepare("SELECT * FROM gmail_contas ORDER BY id")
        .all()
        .map((r) => ({ ...r }));
    },

    // Chamada interna reservada à futura integração OAuth, após verificar a
    // identidade real da conta. Cadastrar a configuração não concede acesso.
    definirAutorizacao({ contaId, estado }) {
      inteiroPositivo(contaId, "Conta");
      if (!ESTADOS_AUTORIZACAO.has(estado))
        throw new Error("Estado de autorização inválido.");
      return transacao(banco, () => {
        contaExistente(banco, contaId);
        banco
          .prepare(
            `UPDATE gmail_contas SET status_autorizacao=?,
              pausada=CASE WHEN ?='conectada' THEN pausada ELSE 1 END,
              atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(estado, estado, contaId);
        if (estado !== "conectada") invalidarReservas(banco, contaId);
        return { ...contaExistente(banco, contaId) };
      });
    },

    definirPausa({ contaId, pausada }) {
      inteiroPositivo(contaId, "Conta");
      if (typeof pausada !== "boolean") throw new Error("Pausa inválida.");
      return transacao(banco, () => {
        const conta = contaExistente(banco, contaId);
        if (!pausada && conta.status_autorizacao !== "conectada")
          throw new Error("Conta Gmail ainda não autorizada.");
        banco
          .prepare(
            "UPDATE gmail_contas SET pausada=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
          )
          .run(pausada ? 1 : 0, contaId);
        if (pausada) invalidarReservas(banco, contaId);
        return { ...contaExistente(banco, contaId) };
      });
    },

    obterProgresso(contaId) {
      return progresso(banco, inteiroPositivo(contaId, "Conta"));
    },

    iniciarVarreduraCompleta({
      contaId,
      historyId: marco,
      ressincronizacao = false,
    }) {
      inteiroPositivo(contaId, "Conta");
      const inicio = historyId(marco);
      if (typeof ressincronizacao !== "boolean")
        throw new Error("Tipo de varredura inválido.");
      return transacao(banco, () => {
        contaOperante(banco, contaId);
        const atual = progresso(banco, contaId);
        if (ressincronizacao) {
          if (atual.fase !== "historico")
            throw new Error("Varredura inicial não concluída.");
          if (BigInt(inicio) < BigInt(atual.history_id))
            throw new Error("Marco histórico anterior ao checkpoint atual.");
        } else if (
          atual.fase !== "inicial" ||
          atual.marco_history_id !== null ||
          atual.cursor_pagina !== null
        ) {
          throw new Error("Varredura inicial já iniciada.");
        }
        banco
          .prepare(
            `UPDATE gmail_sincronizacoes SET fase=?, cursor_pagina=NULL,
              marco_history_id=?, versao=versao+1, ultimo_lote_versao=NULL,
              ultimo_lote_hash=NULL WHERE conta_id=?`,
          )
          .run(ressincronizacao ? "revarredura" : "inicial", inicio, contaId);
        return progresso(banco, contaId);
      });
    },

    // Page tokens podem expirar após uma interrupção longa. Recomeçar não
    // descarta as mensagens já descobertas; a versão invalida páginas antigas.
    reiniciarVarreduraCompleta({ contaId, historyId: marco }) {
      inteiroPositivo(contaId, "Conta");
      const novoMarco = historyId(marco);
      return transacao(banco, () => {
        contaOperante(banco, contaId);
        const atual = progresso(banco, contaId);
        if (atual.fase === "historico" || atual.marco_history_id === null)
          throw new Error("Não há varredura completa em andamento.");
        if (BigInt(novoMarco) < BigInt(atual.marco_history_id))
          throw new Error("Novo marco histórico não pode retroceder.");
        banco
          .prepare(
            `UPDATE gmail_sincronizacoes SET cursor_pagina=NULL,
              marco_history_id=?, versao=versao+1, ultimo_lote_versao=NULL,
              ultimo_lote_hash=NULL WHERE conta_id=?`,
          )
          .run(novoMarco, contaId);
        return progresso(banco, contaId);
      });
    },

    reiniciarBuscaHistorica(contaId) {
      inteiroPositivo(contaId, "Conta");
      return transacao(banco, () => {
        contaOperante(banco, contaId);
        const atual = progresso(banco, contaId);
        if (atual.fase !== "historico" || atual.cursor_pagina === null)
          throw new Error("Não há busca histórica paginada em andamento.");
        banco
          .prepare(
            `UPDATE gmail_sincronizacoes SET cursor_pagina=NULL,
              versao=versao+1, ultimo_lote_versao=NULL,
              ultimo_lote_hash=NULL WHERE conta_id=?`,
          )
          .run(contaId);
        return progresso(banco, contaId);
      });
    },

    registrarPagina({
      contaId,
      versaoEsperada,
      cursorEsperado = null,
      proximoCursor = null,
      mensagens,
      novoHistoryId = null,
      agora = Date.now(),
    }) {
      inteiroPositivo(contaId, "Conta");
      inteiroPositivo(versaoEsperada, "Versão");
      instante(agora);
      const cursor = opcional(cursorEsperado, "Cursor esperado", 2048);
      const seguinte = opcional(proximoCursor, "Próximo cursor", 2048);
      if (seguinte !== null && seguinte === cursor)
        throw new Error("A página não pode apontar para si mesma.");
      if (!Array.isArray(mensagens) || mensagens.length > 10000)
        throw new Error("Lista de mensagens inválida.");
      const candidatos = mensagens.map((id) => texto(id, "Message ID", 512));
      const novoMarco =
        novoHistoryId === null ? null : historyId(novoHistoryId);
      const loteHash = createHash("sha256")
        .update(
          JSON.stringify({
            contaId,
            versaoEsperada,
            cursor,
            seguinte,
            novoMarco,
            candidatos,
          }),
        )
        .digest("hex");
      return transacao(banco, () => {
        const atual = progresso(banco, contaId);
        if (atual.versao !== versaoEsperada) {
          if (
            atual.ultimo_lote_versao === versaoEsperada &&
            atual.ultimo_lote_hash === loteHash
          )
            return {
              repetida: true,
              inseridos: 0,
              existentes: candidatos.length,
              progresso: atual,
            };
          throw new Error("Página obsoleta: progresso já foi alterado.");
        }
        contaOperante(banco, contaId);
        if (atual.cursor_pagina !== cursor)
          throw new Error("Cursor da página não corresponde ao progresso.");
        if (atual.fase !== "historico" && atual.marco_history_id === null)
          throw new Error("Marco histórico inicial ainda não foi registrado.");
        if (atual.fase === "historico" && atual.history_id === null)
          throw new Error("Checkpoint histórico ainda não foi registrado.");
        if (
          atual.fase === "historico" &&
          seguinte === null &&
          novoMarco === null
        )
          throw new Error("Checkpoint final da busca histórica é obrigatório.");
        if (
          atual.fase === "historico" &&
          seguinte !== null &&
          novoMarco !== null
        )
          throw new Error("Checkpoint só pode avançar na última página.");
        if (
          atual.fase === "historico" &&
          novoMarco !== null &&
          BigInt(novoMarco) < BigInt(atual.history_id)
        )
          throw new Error("Checkpoint histórico não pode retroceder.");
        if (atual.fase !== "historico" && novoMarco !== null)
          throw new Error(
            "Checkpoint de página incompatível com a varredura completa.",
          );

        let inseridos = 0;
        let existentes = 0;
        const buscar = banco.prepare(`SELECT id FROM gmail_mensagens
          WHERE conta_id=? AND message_id=?`);
        const inserir = banco.prepare(`INSERT INTO gmail_mensagens
          (conta_id,message_id) VALUES (?,?)`);
        for (const messageId of candidatos) {
          const anterior = buscar.get(contaId, messageId);
          if (anterior) {
            existentes++;
          } else {
            inserir.run(contaId, messageId);
            inseridos++;
          }
        }

        const terminou = seguinte === null;
        const novaFase = terminou ? "historico" : atual.fase;
        const checkpoint = terminou
          ? atual.fase === "historico"
            ? novoMarco
            : atual.marco_history_id
          : atual.history_id;
        banco
          .prepare(
            `UPDATE gmail_sincronizacoes SET fase=?, cursor_pagina=?,
              history_id=?, marco_history_id=?, versao=versao+1,
              ultimo_lote_versao=?, ultimo_lote_hash=?, ultima_pagina_em=?,
              ultima_conclusao_em=CASE WHEN ? THEN ? ELSE ultima_conclusao_em END
            WHERE conta_id=? AND versao=?`,
          )
          .run(
            novaFase,
            seguinte,
            checkpoint,
            terminou ? null : atual.marco_history_id,
            versaoEsperada,
            loteHash,
            agora,
            terminou ? 1 : 0,
            agora,
            contaId,
            versaoEsperada,
          );
        return {
          repetida: false,
          inseridos,
          existentes,
          progresso: progresso(banco, contaId),
        };
      });
    },

    reservarMensagem({ contaId, agora = Date.now(), leaseMs = 300000 }) {
      inteiroPositivo(contaId, "Conta");
      instante(agora);
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 3600000)
        throw new Error("Duração do lease inválida.");
      return transacao(banco, () => {
        contaOperante(banco, contaId);
        const candidata = banco
          .prepare(
            `SELECT * FROM gmail_mensagens WHERE conta_id=? AND
              estado IN ('pendente','falha_temporaria','em_processamento') AND
              (estado='pendente' OR
               (estado='falha_temporaria' AND proxima_tentativa_em<=?) OR
               (estado='em_processamento' AND lease_ate<=?))
            ORDER BY tentativas, id LIMIT 1`,
          )
          .get(contaId, agora, agora);
        if (!candidata) return null;
        const token = randomUUID();
        banco
          .prepare(
            `UPDATE gmail_mensagens SET estado='em_processamento',
              tentativas=tentativas+1, lease_token=?, lease_ate=?,
              proxima_tentativa_em=NULL, erro_codigo=NULL,
              atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(token, agora + leaseMs, candidata.id);
        return {
          ...banco
            .prepare("SELECT * FROM gmail_mensagens WHERE id=?")
            .get(candidata.id),
        };
      });
    },

    // O detalhamento de uma mensagem (inclusive sem PDF) e todos os seus anexos
    // são uma única transação. Falhar em um anexo deixa a mensagem reservada
    // para retry após o vencimento do lease, sem perder a descoberta.
    registrarAnexosDaMensagem({
      mensagemId,
      leaseToken,
      anexos,
      agora = Date.now(),
    }) {
      inteiroPositivo(mensagemId, "Mensagem");
      instante(agora);
      if (typeof leaseToken !== "string" || !/^[0-9a-f-]{36}$/.test(leaseToken))
        throw new Error("Lease inválido.");
      if (!Array.isArray(anexos) || anexos.length > 10000)
        throw new Error("Lista de anexos inválida.");
      return transacao(banco, () => {
        const mensagem = banco
          .prepare("SELECT * FROM gmail_mensagens WHERE id=?")
          .get(mensagemId);
        if (!leaseAtivo(mensagem, leaseToken, agora)) return false;
        contaOperante(banco, mensagem.conta_id);
        const buscar = banco.prepare(`SELECT id,attachment_id,nome,mime_type
          FROM gmail_anexos WHERE conta_id=? AND message_id=? AND part_path=?`);
        const inserir = banco.prepare(`INSERT INTO gmail_anexos
          (conta_id,message_id,part_path,attachment_id,nome,mime_type,estado,erro_codigo)
          VALUES (?,?,?,?,?,?,?,?)`);
        for (const item of anexos) {
          const candidato = anexoValido(item, mensagem.message_id);
          const anterior = buscar.get(
            mensagem.conta_id,
            mensagem.message_id,
            candidato.partPath,
          );
          if (anterior) {
            if (
              anterior.attachment_id !== candidato.attachmentId ||
              anterior.nome !== candidato.nome ||
              anterior.mime_type !== candidato.mimeType
            )
              throw new Error(
                "Identidade de anexo já registrada com outros metadados.",
              );
          } else {
            inserir.run(
              mensagem.conta_id,
              mensagem.message_id,
              candidato.partPath,
              candidato.attachmentId,
              candidato.nome,
              candidato.mimeType,
              candidato.revisaoEmail ? "pendente_manual" : "pendente",
              candidato.revisaoEmail ? "revisao_email" : null,
            );
          }
        }
        banco
          .prepare(
            `UPDATE gmail_mensagens SET estado='detalhada', lease_token=NULL,
              lease_ate=NULL, proxima_tentativa_em=NULL, erro_codigo=NULL,
              atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(mensagemId);
        return true;
      });
    },

    registrarFalhaMensagem({
      mensagemId,
      leaseToken,
      codigo,
      temporaria,
      proximaTentativaEm = null,
      agora = Date.now(),
    }) {
      inteiroPositivo(mensagemId, "Mensagem");
      instante(agora);
      if (typeof leaseToken !== "string" || !/^[0-9a-f-]{36}$/.test(leaseToken))
        throw new Error("Lease inválido.");
      const motivo = texto(codigo, "Código do erro", 80);
      if (!/^[a-z0-9_.-]+$/.test(motivo) || typeof temporaria !== "boolean")
        throw new Error("Tipo de falha inválido.");
      if (
        temporaria &&
        (!Number.isSafeInteger(proximaTentativaEm) ||
          proximaTentativaEm <= agora)
      )
        throw new Error("Próxima tentativa inválida.");
      if (!temporaria && proximaTentativaEm !== null)
        throw new Error(
          "Falha permanente não admite reagendamento automático.",
        );
      return transacao(banco, () => {
        const mensagem = banco
          .prepare("SELECT * FROM gmail_mensagens WHERE id=?")
          .get(mensagemId);
        if (!leaseAtivo(mensagem, leaseToken, agora)) return false;
        banco
          .prepare(
            `UPDATE gmail_mensagens SET estado=?, erro_codigo=?,
              proxima_tentativa_em=?, lease_token=NULL, lease_ate=NULL,
              atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(
            temporaria ? "falha_temporaria" : "pendente_manual",
            motivo,
            temporaria ? proximaTentativaEm : null,
            mensagemId,
          );
        return true;
      });
    },

    reagendarMensagem(mensagemId) {
      inteiroPositivo(mensagemId, "Mensagem");
      return transacao(banco, () => {
        const mensagem = banco
          .prepare("SELECT * FROM gmail_mensagens WHERE id=?")
          .get(mensagemId);
        if (!mensagem) throw new Error("Mensagem inexistente.");
        if (
          mensagem.estado !== "pendente_manual" &&
          mensagem.estado !== "falha_temporaria"
        )
          throw new Error("Esta mensagem não admite nova tentativa.");
        banco
          .prepare(
            `UPDATE gmail_mensagens SET estado='pendente', erro_codigo=NULL,
              proxima_tentativa_em=NULL, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(mensagemId);
        return true;
      });
    },

    listarMensagens({ contaId, aposId = 0, limite = 100, estado = null }) {
      inteiroPositivo(contaId, "Conta");
      if (!Number.isSafeInteger(aposId) || aposId < 0)
        throw new Error("Posição inválida.");
      if (!Number.isSafeInteger(limite) || limite < 1 || limite > 500)
        throw new Error("Limite inválido.");
      if (
        estado !== null &&
        ![
          "pendente",
          "em_processamento",
          "detalhada",
          "pendente_manual",
          "falha_temporaria",
        ].includes(estado)
      )
        throw new Error("Estado inválido.");
      contaExistente(banco, contaId);
      const sql =
        `SELECT * FROM gmail_mensagens WHERE conta_id=? AND id>?` +
        (estado === null ? "" : " AND estado=?") +
        " ORDER BY id LIMIT ?";
      const parametros =
        estado === null
          ? [contaId, aposId, limite]
          : [contaId, aposId, estado, limite];
      return banco
        .prepare(sql)
        .all(...parametros)
        .map((r) => ({ ...r }));
    },

    contarEstadosMensagens(contaId) {
      inteiroPositivo(contaId, "Conta");
      contaExistente(banco, contaId);
      return banco
        .prepare(
          `SELECT estado, COUNT(*) AS quantidade FROM gmail_mensagens
          WHERE conta_id=? GROUP BY estado`,
        )
        .all(contaId)
        .map((r) => ({ ...r }));
    },

    reservarAnexo({ contaId, agora = Date.now(), leaseMs = 300000 }) {
      inteiroPositivo(contaId, "Conta");
      instante(agora);
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 3600000)
        throw new Error("Duração do lease inválida.");
      return transacao(banco, () => {
        contaOperante(banco, contaId);
        const candidato = banco
          .prepare(
            `SELECT * FROM gmail_anexos WHERE conta_id=? AND
              estado IN ('pendente','falha_temporaria','em_processamento') AND
              (estado='pendente' OR
               (estado='falha_temporaria' AND proxima_tentativa_em<=?) OR
               (estado='em_processamento' AND lease_ate<=?))
            ORDER BY tentativas, id LIMIT 1`,
          )
          .get(contaId, agora, agora);
        if (!candidato) return null;
        const token = randomUUID();
        banco
          .prepare(
            `UPDATE gmail_anexos SET estado='em_processamento',
              tentativas=tentativas+1, lease_token=?, lease_ate=?,
              proxima_tentativa_em=NULL, erro_codigo=NULL,
              atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(token, agora + leaseMs, candidato.id);
        return {
          ...banco
            .prepare("SELECT * FROM gmail_anexos WHERE id=?")
            .get(candidato.id),
        };
      });
    },

    concluirAnexo({
      anexoId,
      leaseToken,
      resultado,
      documentoId = null,
      hash = null,
      agora = Date.now(),
    }) {
      inteiroPositivo(anexoId, "Anexo");
      instante(agora);
      if (typeof leaseToken !== "string" || !/^[0-9a-f-]{36}$/.test(leaseToken))
        throw new Error("Lease inválido.");
      if (!RESULTADOS_ANEXO.has(resultado))
        throw new Error("Resultado do anexo inválido.");
      if (documentoId !== null) inteiroPositivo(documentoId, "Documento");
      if (
        hash !== null &&
        (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))
      )
        throw new Error("Hash do PDF inválido.");
      if (documentoId === null || hash === null)
        throw new Error(
          "Documento e hash são obrigatórios para PDF capturado.",
        );
      return transacao(banco, () => {
        const anexo = banco
          .prepare("SELECT * FROM gmail_anexos WHERE id=?")
          .get(anexoId);
        if (!leaseAtivo(anexo, leaseToken, agora)) return false;
        contaOperante(banco, anexo.conta_id);
        if (documentoId !== null) {
          const documento = banco
            .prepare("SELECT hash FROM faturamento_documentos WHERE id=?")
            .get(documentoId);
          if (!documento || documento.hash !== hash)
            throw new Error(
              "Documento de faturamento inexistente ou hash divergente.",
            );
        }
        banco
          .prepare(
            `UPDATE gmail_anexos SET estado=?, documento_id=?, hash_pdf=?,
              lease_token=NULL, lease_ate=NULL, proxima_tentativa_em=NULL,
              erro_codigo=NULL, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(resultado, documentoId, hash, anexoId);
        return true;
      });
    },

    registrarFalhaAnexo({
      anexoId,
      leaseToken,
      codigo,
      temporaria,
      proximaTentativaEm = null,
      agora = Date.now(),
    }) {
      inteiroPositivo(anexoId, "Anexo");
      instante(agora);
      if (typeof leaseToken !== "string" || !/^[0-9a-f-]{36}$/.test(leaseToken))
        throw new Error("Lease inválido.");
      const motivo = texto(codigo, "Código do erro", 80);
      if (!/^[a-z0-9_.-]+$/.test(motivo) || typeof temporaria !== "boolean")
        throw new Error("Tipo de falha inválido.");
      if (
        temporaria &&
        (!Number.isSafeInteger(proximaTentativaEm) ||
          proximaTentativaEm <= agora)
      )
        throw new Error("Próxima tentativa inválida.");
      if (!temporaria && proximaTentativaEm !== null)
        throw new Error(
          "Falha permanente não admite reagendamento automático.",
        );
      return transacao(banco, () => {
        const anexo = banco
          .prepare("SELECT * FROM gmail_anexos WHERE id=?")
          .get(anexoId);
        if (!leaseAtivo(anexo, leaseToken, agora)) return false;
        banco
          .prepare(
            `UPDATE gmail_anexos SET estado=?, erro_codigo=?,
              proxima_tentativa_em=?, documento_id=NULL, hash_pdf=NULL,
              lease_token=NULL, lease_ate=NULL,
              atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(
            temporaria ? "falha_temporaria" : "pendente_manual",
            motivo,
            temporaria ? proximaTentativaEm : null,
            anexoId,
          );
        return true;
      });
    },

    reagendarAnexo(anexoId) {
      inteiroPositivo(anexoId, "Anexo");
      return transacao(banco, () => {
        const anexo = banco
          .prepare("SELECT * FROM gmail_anexos WHERE id=?")
          .get(anexoId);
        if (!anexo) throw new Error("Anexo inexistente.");
        if (
          anexo.estado !== "pendente_manual" &&
          anexo.estado !== "falha_temporaria"
        )
          throw new Error("Este anexo não admite nova tentativa.");
        if (anexo.erro_codigo === "revisao_email")
          throw new Error(
            "Revise o arquivo no Gmail antes de autorizar a captura.",
          );
        banco
          .prepare(
            `UPDATE gmail_anexos SET estado='pendente', erro_codigo=NULL,
              proxima_tentativa_em=NULL, documento_id=NULL, hash_pdf=NULL,
              atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(anexoId);
        return true;
      });
    },

    autorizarCapturaAposRevisao({ contaId, anexoId, administradorId }) {
      inteiroPositivo(contaId, "Conta");
      inteiroPositivo(anexoId, "Anexo");
      inteiroPositivo(administradorId, "Administrador");
      return transacao(banco, () => {
        contaExistente(banco, contaId);
        const anexo = banco
          .prepare("SELECT * FROM gmail_anexos WHERE id=? AND conta_id=?")
          .get(anexoId, contaId);
        if (
          !anexo ||
          anexo.estado !== "pendente_manual" ||
          anexo.erro_codigo !== "revisao_email"
        )
          throw new Error("Anexo não está aguardando revisão no Gmail.");
        banco
          .prepare(
            `INSERT INTO gmail_revisoes_anexos
          (conta_id,anexo_id,administrador_id,acao) VALUES (?,?,?,'autorizar_captura')`,
          )
          .run(contaId, anexoId, administradorId);
        banco
          .prepare(
            `UPDATE gmail_anexos SET estado='pendente',erro_codigo=NULL,
          proxima_tentativa_em=NULL,atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
          )
          .run(anexoId);
        return true;
      });
    },

    listarAnexos({ contaId, aposId = 0, limite = 100, estado = null }) {
      inteiroPositivo(contaId, "Conta");
      if (!Number.isSafeInteger(aposId) || aposId < 0)
        throw new Error("Posição inválida.");
      if (!Number.isSafeInteger(limite) || limite < 1 || limite > 500)
        throw new Error("Limite inválido.");
      if (
        estado !== null &&
        ![
          "pendente",
          "em_processamento",
          "capturado",
          "duplicado",
          "pendente_manual",
          "falha_temporaria",
        ].includes(estado)
      )
        throw new Error("Estado inválido.");
      contaExistente(banco, contaId);
      const sql =
        `SELECT * FROM gmail_anexos WHERE conta_id=? AND id>?` +
        (estado === null ? "" : " AND estado=?") +
        " ORDER BY id LIMIT ?";
      const parametros =
        estado === null
          ? [contaId, aposId, limite]
          : [contaId, aposId, estado, limite];
      return banco
        .prepare(sql)
        .all(...parametros)
        .map((r) => ({ ...r }));
    },

    contarEstados(contaId) {
      inteiroPositivo(contaId, "Conta");
      contaExistente(banco, contaId);
      return banco
        .prepare(
          `SELECT estado, COUNT(*) AS quantidade FROM gmail_anexos
          WHERE conta_id=? GROUP BY estado`,
        )
        .all(contaId)
        .map((r) => ({ ...r }));
    },

    inicioDaBusca(contaId) {
      const conta = contaExistente(banco, inteiroPositivo(contaId, "Conta"));
      return {
        data: conta.data_inicio,
        fuso: FUSO_INICIO,
        inclusivo: true,
      };
    },
  };
}
