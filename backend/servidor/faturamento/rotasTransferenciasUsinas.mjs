import { createHash } from "node:crypto";
import { Router } from "express";
import { obterBanco } from "../bancoDeDados.mjs";
import { exigirNivel } from "../permissoesDaEquipe.mjs";
import { falhar } from "./regras.mjs";
import {
  chaveUsina,
  modalidadeVigenteDaUsina,
  saidaDaCarteiraNaCompetencia,
} from "./vinculosUsinas.mjs";

export const rotasTransferenciasUsinas = Router();
rotasTransferenciasUsinas.use(exigirNivel(3));

function identificador(valor) {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id < 1) falhar("Identificador inválido.");
  return id;
}

function competenciaAtual() {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const ano = partes.find((p) => p.type === "year").value;
  const mes = partes.find((p) => p.type === "month").value;
  return `${ano}-${mes}`;
}

function proximoMes(mes) {
  const [ano, numero] = mes.split("-").map(Number);
  return numero === 12
    ? `${ano + 1}-01`
    : `${ano}-${String(numero + 1).padStart(2, "0")}`;
}

function competencia(valor) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(valor ?? "")))
    falhar("Competência inválida.");
  return valor;
}

function destinoExterno(valor) {
  if (typeof valor !== "string") falhar("Informe a usina externa de destino.");
  const destino = valor.trim().replace(/\s+/g, " ");
  if (!destino || destino.length > 120)
    falhar("Informe a usina externa de destino.");
  return destino;
}

function dataEfetiva(valor, inicio) {
  if (valor === undefined || valor === null || valor === "") return null;
  const data = String(valor);
  if (!/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(data))
    falhar("Data efetiva inválida.");
  if (!data.startsWith(`${inicio}-`))
    falhar("A data efetiva deve pertencer à competência inicial.");
  return data;
}

function unidadeSaida(valor) {
  return { id: identificador(valor?.id), versao: identificador(valor?.versao) };
}

function selecao(valor) {
  if (!Array.isArray(valor) || !valor.length || valor.length > 100)
    falhar("Selecione de 1 a 100 UCs para transferir.");
  const ids = new Set();
  return valor.map((item) => {
    const id = identificador(item?.id);
    const versao = identificador(item?.versao);
    if (ids.has(id)) falhar("Uma UC foi selecionada mais de uma vez.");
    ids.add(id);
    return { id, versao };
  });
}

function preparar(banco, origemId, destinoId, itens) {
  if (origemId === destinoId) falhar("Selecione uma usina diferente da atual.");
  const origem = banco
    .prepare("SELECT id,nome FROM usinas WHERE id=?")
    .get(origemId);
  const destino = banco
    .prepare("SELECT id,nome,versao FROM usinas WHERE id=?")
    .get(destinoId);
  if (!origem || !destino) falhar("Usina não encontrada.", 404);
  if (chaveUsina(destino.nome) === "ecosol")
    falhar("Ecosol não é uma usina de destino.", 409);
  const mesAtual = competenciaAtual();
  const linhas = itens.map(({ id, versao }) => {
    const unidade = banco
      .prepare(
        "SELECT id,uc,versao,usina_id FROM faturamento_unidades WHERE id=?",
      )
      .get(id);
    if (!unidade || unidade.usina_id !== origemId)
      falhar("Uma UC mudou de usina. Atualize a lista e tente novamente.", 409);
    if (unidade.versao !== versao)
      falhar("Uma UC foi alterada. Atualize a lista e tente novamente.", 409);
    const ultimaFatura = banco
      .prepare(
        `SELECT MAX(competencia) AS mes FROM faturamento_documentos
         WHERE unidade_id=? AND competencia IS NOT NULL
           AND classificacao='fatura' AND excluido_em IS NULL`,
      )
      .get(id).mes;
    const inicio =
      ultimaFatura && ultimaFatura >= mesAtual
        ? proximoMes(ultimaFatura)
        : mesAtual;
    if (saidaDaCarteiraNaCompetencia(banco, id, inicio))
      falhar(
        "Esta UC saiu da carteira operacional da Ecosol. Não é possível transferi-la para uma usina administrada.",
        409,
      );
    const ultimoVinculo = banco
      .prepare(
        "SELECT MAX(inicio) AS mes FROM faturamento_vinculos_usina WHERE unidade_id=? AND inicio<>'0000-01'",
      )
      .get(id).mes;
    if (ultimoVinculo && ultimoVinculo >= inicio)
      falhar(
        "Esta UC já tem uma transferência programada para a próxima competência. Confira o histórico antes de transferi-la novamente.",
        409,
      );
    const modalidade = modalidadeVigenteDaUsina(banco, destinoId, inicio);
    if (!modalidade)
      falhar(
        `A usina de destino não tem modalidade definida para ${inicio}.`,
        409,
      );
    return {
      id,
      uc: unidade.uc,
      versao,
      inicio,
      modalidade: modalidade.modalidade,
    };
  });
  return {
    origem: { id: origem.id, nome: origem.nome },
    destino: { id: destino.id, nome: destino.nome, versao: destino.versao },
    linhas,
  };
}

rotasTransferenciasUsinas.post("/previa", (req, res) => {
  const origemId = identificador(req.body?.origem_id);
  const destinoId = identificador(req.body?.destino_id);
  const plano = preparar(
    obterBanco(),
    origemId,
    destinoId,
    selecao(req.body?.unidades),
  );
  res.set("Cache-Control", "no-store").json(plano);
});

function prepararSaidaExterna(
  banco,
  { unidade, inicio, destino, dataEfetiva },
) {
  const atual = banco
    .prepare(
      "SELECT id,uc,versao,usina_id FROM faturamento_unidades WHERE id=?",
    )
    .get(unidade.id);
  if (!atual || atual.versao !== unidade.versao)
    falhar("A UC foi alterada. Atualize a lista e tente novamente.", 409);
  const existente = banco
    .prepare(
      "SELECT inicio,data_efetiva,destino_externo FROM faturamento_saidas_carteira WHERE unidade_id=?",
    )
    .get(atual.id);
  if (existente)
    falhar(
      `Esta UC já saiu da carteira desde ${existente.inicio} (destino: ${existente.destino_externo}).`,
      409,
    );
  return {
    ...atual,
    inicio,
    data_efetiva: dataEfetiva,
    destino_externo: destino,
  };
}

rotasTransferenciasUsinas.post("/saidas-externas/previa", (req, res) => {
  const inicio = competencia(req.body?.inicio);
  const plano = prepararSaidaExterna(obterBanco(), {
    unidade: unidadeSaida(req.body?.unidade),
    inicio,
    destino: destinoExterno(req.body?.destino_externo),
    dataEfetiva: dataEfetiva(req.body?.data_efetiva, inicio),
  });
  res.set("Cache-Control", "no-store").json(plano);
});

rotasTransferenciasUsinas.post("/saidas-externas/confirmar", (req, res) => {
  if (req.body?.confirmado !== true)
    falhar("Confirme a saída após conferir a prévia.");
  const chave = String(req.body?.chave ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(chave))
    falhar("Identificador da operação inválido.");
  const inicio = competencia(req.body?.inicio);
  const entrada = {
    unidade: unidadeSaida(req.body?.unidade),
    inicio,
    destino: destinoExterno(req.body?.destino_externo),
    dataEfetiva: dataEfetiva(req.body?.data_efetiva, inicio),
  };
  const banco = obterBanco();
  banco.exec("BEGIN IMMEDIATE");
  try {
    const repetida = banco
      .prepare(
        `SELECT u.id,u.uc,s.inicio,s.data_efetiva,s.destino_externo
         FROM faturamento_saidas_carteira s
         JOIN faturamento_unidades u ON u.id=s.unidade_id
         WHERE s.operacao_id=?`,
      )
      .get(chave);
    if (repetida) {
      if (
        repetida.id !== entrada.unidade.id ||
        repetida.inicio !== entrada.inicio ||
        repetida.data_efetiva !== entrada.dataEfetiva ||
        repetida.destino_externo !== entrada.destino
      )
        falhar("Esta operação já foi usada com outros dados.", 409);
      banco.exec("COMMIT");
      return res
        .set("Cache-Control", "no-store")
        .json({ ...repetida, ja_concluida: true });
    }
    const plano = prepararSaidaExterna(banco, entrada);
    banco
      .prepare(
        `INSERT INTO faturamento_saidas_carteira
         (unidade_id,inicio,data_efetiva,destino_externo,evidencia,operacao_id)
         VALUES(?,?,?,?,?,?)`,
      )
      .run(
        plano.id,
        plano.inicio,
        plano.data_efetiva,
        plano.destino_externo,
        JSON.stringify({
          origem: "confirmação administrativa",
          operacao: chave,
        }),
        chave,
      );
    banco
      .prepare(
        `INSERT INTO faturamento_historico
         (unidade_id,responsavel,administrador_id,acao,dados) VALUES(?,?,?,?,?)`,
      )
      .run(
        plano.id,
        req.administrador.nome,
        req.administrador.id,
        "Saída operacional para usina externa",
        JSON.stringify({
          operacao: chave,
          uc: plano.uc,
          inicio: plano.inicio,
          data_efetiva: plano.data_efetiva,
          destino_externo: plano.destino_externo,
        }),
      );
    banco.exec("COMMIT");
    res.set("Cache-Control", "no-store").status(201).json(plano);
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
});

rotasTransferenciasUsinas.post("/confirmar", (req, res) => {
  if (req.body?.confirmado !== true)
    falhar("Confirme a transferência após conferir a prévia.");
  const chave = String(req.body?.chave ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(chave))
    falhar("Identificador da operação inválido.");
  const origemId = identificador(req.body?.origem_id);
  const destinoId = identificador(req.body?.destino_id);
  const itens = selecao(req.body?.linhas);
  const esperado = req.body.linhas.map((l) => ({
    id: identificador(l.id),
    versao: identificador(l.versao),
    inicio: String(l.inicio ?? ""),
    modalidade: String(l.modalidade ?? ""),
  }));
  const destinoVersao = identificador(req.body?.destino_versao);
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ origemId, destinoId, destinoVersao, esperado }))
    .digest("hex");
  const banco = obterBanco();
  banco.exec("BEGIN IMMEDIATE");
  try {
    const repetida = banco
      .prepare(
        "SELECT payload_hash,resultado FROM faturamento_transferencias_usina WHERE id=?",
      )
      .get(chave);
    if (repetida) {
      if (repetida.payload_hash !== payloadHash)
        falhar("Esta operação já foi usada com outros dados.", 409);
      banco.exec("COMMIT");
      return res
        .set("Cache-Control", "no-store")
        .json({ ...JSON.parse(repetida.resultado), ja_concluida: true });
    }
    const plano = preparar(banco, origemId, destinoId, itens);
    if (
      plano.destino.versao !== destinoVersao ||
      JSON.stringify(
        plano.linhas.map(({ id, versao, inicio, modalidade }) => ({
          id,
          versao,
          inicio,
          modalidade,
        })),
      ) !== JSON.stringify(esperado)
    )
      falhar("A prévia mudou. Confira as UCs e gere outra prévia.", 409);
    for (const linha of plano.linhas) {
      const temHistorico = banco
        .prepare(
          "SELECT 1 FROM faturamento_vinculos_usina WHERE unidade_id=? LIMIT 1",
        )
        .get(linha.id);
      if (!temHistorico)
        banco
          .prepare(
            "INSERT INTO faturamento_vinculos_usina(unidade_id,inicio,usina_id) VALUES(?,'0000-01',?)",
          )
          .run(linha.id, origemId);
      const atualizado = banco
        .prepare(
          "UPDATE faturamento_unidades SET usina_id=?,versao=versao+1 WHERE id=? AND usina_id=? AND versao=?",
        )
        .run(destinoId, linha.id, origemId, linha.versao);
      if (atualizado.changes !== 1)
        falhar("Uma UC mudou durante a confirmação. Gere outra prévia.", 409);
      banco
        .prepare(
          "INSERT INTO faturamento_vinculos_usina(unidade_id,inicio,usina_id,origem_usina_id,transferencia_id) VALUES(?,?,?,?,?)",
        )
        .run(linha.id, linha.inicio, destinoId, origemId, chave);
      banco
        .prepare(
          "INSERT INTO faturamento_historico(unidade_id,responsavel,administrador_id,acao,dados) VALUES(?,?,?,?,?)",
        )
        .run(
          linha.id,
          req.administrador.nome,
          req.administrador.id,
          "Transferência de UC entre usinas",
          JSON.stringify({
            operacao: chave,
            uc: linha.uc,
            origem_usina_id: origemId,
            destino_usina_id: destinoId,
            inicio: linha.inicio,
            modalidade_destino: linha.modalidade,
          }),
        );
    }
    const resultado = {
      quantidade: plano.linhas.length,
      origem: plano.origem.nome,
      destino: plano.destino.nome,
      competencias: plano.linhas.map(({ id, inicio }) => ({ id, inicio })),
    };
    banco
      .prepare(
        "INSERT INTO faturamento_transferencias_usina(id,payload_hash,resultado) VALUES(?,?,?)",
      )
      .run(chave, payloadHash, JSON.stringify(resultado));
    banco.exec("COMMIT");
    res.set("Cache-Control", "no-store").json(resultado);
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
});
