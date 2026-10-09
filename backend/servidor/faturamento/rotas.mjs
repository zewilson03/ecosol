import express, { Router } from "express";
import { createHash } from "node:crypto";
import { obterBanco } from "../bancoDeDados.mjs";
import { exigirNivel } from "../permissoesDaEquipe.mjs";
import { apenasDigitos, cpfValidoParaCadastro } from "../validacaoDeCpf.mjs";
import { receberPdf } from "./receberPdf.mjs";
import { reanalisarFatura } from "./reanalisar.mjs";
import { registrarHistorico } from "./registros.mjs";
import { rotasPlanilhas } from "./rotasPlanilhas.mjs";
import { rotasVinculosUsinas } from "./rotasVinculosUsinas.mjs";
import { rotasTransferenciasUsinas } from "./rotasTransferenciasUsinas.mjs";
import {
  chaveUsina,
  conferirVinculoComAprovadas,
  modalidadeVigenteDaUsina,
  usinaDaUnidadeNaCompetencia,
} from "./vinculosUsinas.mjs";
import {
  calcularCobranca,
  competencia,
  dataValida,
  decimal,
  falhar,
  normalizarUc,
  texto,
  validarContrato,
  validarUnidade,
} from "./regras.mjs";

export const rotasFaturamento = Router();
const router = Router();
rotasFaturamento.use("/api/admin/faturamento", exigirNivel(1), router);
const APROVADA = "Aprovada — aguardando emissão";
const colunas =
  "id, hash, nome, lote, extracao, dados, memoria, unidade_id, competencia, status, classificacao, versao, criado_em, atualizado_em";

function id(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1)
    falhar("Identificador inválido.");
  return numero;
}
function nomePdf(valor) {
  if (typeof valor !== "string") falhar("Informe o novo nome do PDF.");
  const nome = valor.trim();
  if (
    nome.length < 5 ||
    nome.length > 200 ||
    !/\.pdf$/i.test(nome) ||
    /^[. ]/.test(nome) ||
    /[<>:"/\\|?*\x00-\x1f\x7f]/.test(nome) ||
    /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(nome)
  )
    falhar(
      "Use um nome de arquivo válido, com até 200 caracteres e extensão .pdf.",
    );
  return nome;
}
function documento(numero) {
  const d = obterBanco()
    .prepare(
      `SELECT ${colunas} FROM faturamento_documentos WHERE id=? AND classificacao='fatura' AND excluido_em IS NULL`,
    )
    .get(id(numero));
  if (!d) falhar("Fatura não encontrada.", 404);
  return {
    ...d,
    dados: JSON.parse(d.dados),
    extracao: JSON.parse(d.extracao),
    memoria: d.memoria ? JSON.parse(d.memoria) : null,
  };
}
function documentoCompleto(numero) {
  const d = documento(numero);
  const banco = obterBanco();
  return {
    ...d,
    texto: banco
      .prepare("SELECT texto FROM faturamento_documentos WHERE id=?")
      .get(d.id).texto,
    historico: banco
      .prepare(
        "SELECT acao,responsavel,criado_em FROM faturamento_historico WHERE documento_id=? ORDER BY id DESC",
      )
      .all(d.id),
  };
}
function conferirVersao(d, body) {
  if (d.versao !== Number(body.versao))
    falhar(
      "Este registro foi alterado. Abra-o novamente antes de continuar.",
      409,
    );
  if (d.status === APROVADA)
    falhar(
      "Cobrança aprovada: o histórico está protegido contra alterações.",
      409,
    );
}
function historico(req, acao, dados, documentoId = null, unidadeId = null) {
  registrarHistorico({
    responsavel: req.administrador.nome,
    administradorId: req.administrador.id,
    acao,
    dados,
    documentoId,
    unidadeId,
  });
}
function transacao(fn) {
  const banco = obterBanco();
  banco.exec("BEGIN IMMEDIATE");
  try {
    const resultado = fn();
    banco.exec("COMMIT");
    return resultado;
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}
function listarUnidades() {
  const banco = obterBanco();
  return banco
    .prepare(
      "SELECT u.*, s.nome AS usina_nome, COALESCE(c.name,p.nome) AS cliente_nome FROM faturamento_unidades u LEFT JOIN usinas s ON s.id=u.usina_id LEFT JOIN customers c ON c.id=u.cliente_id LEFT JOIN faturamento_clientes_provisorios p ON p.id=u.cliente_provisorio_id ORDER BY u.nome, u.uc",
    )
    .all()
    .map((u) => {
      const vinculos = banco
        .prepare(
          `SELECT v.inicio,v.usina_id,s.nome AS usina_nome
           FROM faturamento_vinculos_usina v JOIN usinas s ON s.id=v.usina_id
           WHERE v.unidade_id=? ORDER BY v.inicio DESC`,
        )
        .all(u.id);
      if (!vinculos.length && u.usina_id !== null)
        vinculos.push({
          inicio: "0000-01",
          usina_id: u.usina_id,
          usina_nome: u.usina_nome,
        });
      return {
        ...u,
        vinculos_usina: vinculos.map((v) => ({
          ...v,
          modalidades:
            chaveUsina(v.usina_nome) === "ecosol"
              ? []
              : banco
                  .prepare(
                    "SELECT inicio,modalidade FROM usinas_modalidades WHERE usina_id=? ORDER BY inicio DESC",
                  )
                  .all(v.usina_id),
        })),
        descontos: banco
          .prepare(
            "SELECT id,inicio,desconto FROM faturamento_descontos_uc WHERE unidade_id=? ORDER BY inicio DESC",
          )
          .all(u.id),
        contratos: banco
          .prepare(
            "SELECT * FROM faturamento_contratos WHERE unidade_id=? ORDER BY inicio DESC",
          )
          .all(u.id),
        modalidades_usina:
          u.usina_id === null || chaveUsina(u.usina_nome) === "ecosol"
            ? []
            : banco
                .prepare(
                  "SELECT inicio,modalidade FROM usinas_modalidades WHERE usina_id=? ORDER BY inicio DESC",
                )
                .all(u.usina_id),
      };
    });
}

router.get("/unidades", (_req, res) => res.json(listarUnidades()));
router.get("/clientes-provisorios", (_req, res) =>
  res.json(
    obterBanco()
      .prepare(
        "SELECT p.id,p.nome,COUNT(u.id) AS unidades FROM faturamento_clientes_provisorios p LEFT JOIN faturamento_unidades u ON u.cliente_provisorio_id=p.id GROUP BY p.id ORDER BY p.nome,p.id",
      )
      .all(),
  ),
);
router.get("/clientes", (_req, res) =>
  res.json(
    obterBanco()
      .prepare("SELECT id,name FROM customers ORDER BY name,id")
      .all(),
  ),
);
function conferirCliente(numero) {
  if (
    numero !== null &&
    !obterBanco().prepare("SELECT id FROM customers WHERE id=?").get(numero)
  )
    falhar("Cliente do portal não encontrado.");
}
function clienteInformado(valor) {
  return valor === undefined || valor === null || valor === ""
    ? null
    : id(valor);
}
router.post("/cadastro-integrado", exigirNivel(2), (req, res) => {
  const entrada = req.body ?? {};
  const clienteExistenteId = clienteInformado(entrada.cliente_id);
  const usinaId = clienteInformado(entrada.usina_id);
  const uc = normalizarUc(entrada.uc);
  let novoCliente = null;
  if (clienteExistenteId === null) {
    const nome = texto(entrada.nome, "o nome do cliente", 120);
    const cpfInformado = String(entrada.cpf ?? "").trim();
    if (!cpfValidoParaCadastro(cpfInformado))
      falhar("Informe um CPF válido para o cliente.");
    const email = texto(
      entrada.email,
      "o e-mail do cliente",
      180,
    ).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      falhar("E-mail do cliente inválido.");
    novoCliente = { nome, cpf: apenasDigitos(cpfInformado), email };
  }
  const resultado = transacao(() => {
    const banco = obterBanco();
    if (usinaId !== null) {
      conferirUsinaReal(usinaId);
      if (
        !banco
          .prepare("SELECT 1 FROM usinas_modalidades WHERE usina_id=? LIMIT 1")
          .get(usinaId)
      )
        falhar(
          "Defina a modalidade da usina antes de cadastrar clientes nela.",
          409,
        );
    }
    let clienteId = clienteExistenteId;
    if (clienteId !== null) {
      const cliente = banco
        .prepare("SELECT cpf FROM customers WHERE id=?")
        .get(clienteId);
      if (!cliente)
        falhar("Cliente do portal não encontrado. Atualize a lista.", 409);
      if (entrada.cpf && apenasDigitos(String(entrada.cpf)) !== cliente.cpf)
        falhar("O CPF informado não corresponde ao cliente selecionado.", 409);
    } else {
      if (
        banco
          .prepare(
            "SELECT 1 FROM customers WHERE cpf=? UNION ALL SELECT 1 FROM staff_users WHERE cpf=? LIMIT 1",
          )
          .get(novoCliente.cpf, novoCliente.cpf)
      )
        falhar(
          "Este CPF já está cadastrado. Selecione o cliente existente.",
          409,
        );
      clienteId = Number(
        banco
          .prepare("INSERT INTO customers (name,cpf,email) VALUES (?,?,?)")
          .run(novoCliente.nome, novoCliente.cpf, novoCliente.email)
          .lastInsertRowid,
      );
    }
    const unidadeExistente = banco
      .prepare(
        "SELECT id,cliente_id,cliente_provisorio_id,usina_id FROM faturamento_unidades WHERE uc=?",
      )
      .get(uc);
    if (unidadeExistente) {
      if (unidadeExistente.cliente_provisorio_id !== null)
        falhar(
          "Esta UC pertence a um cadastro provisório. Complete e confira os dados antes de vinculá-la ao portal.",
          409,
        );
      if (
        unidadeExistente.cliente_id !== null &&
        unidadeExistente.cliente_id !== clienteId
      )
        falhar(
          "Esta UC já pertence a outro cliente do portal. Confira o cadastro antes de prosseguir.",
          409,
        );
      if (
        usinaId !== null &&
        unidadeExistente.usina_id !== null &&
        unidadeExistente.usina_id !== usinaId
      )
        falhar(
          "Esta UC já pertence a outra usina. Confira o vínculo antes de prosseguir.",
          409,
        );
      const vincularUsina =
        usinaId !== null && unidadeExistente.usina_id === null;
      if (vincularUsina && entrada.confirmar_vinculo !== true)
        falhar(
          "Confirme os dados da UC existente antes de vinculá-la à usina.",
        );
      const temDesconto = Boolean(
        banco
          .prepare(
            "SELECT 1 FROM faturamento_descontos_uc WHERE unidade_id=? LIMIT 1",
          )
          .get(unidadeExistente.id),
      );
      const descontoInicial = temDesconto
        ? null
        : {
            valor: decimal(
              entrada.desconto,
              "o desconto percentual da UC",
              2,
              "100",
            ),
            inicio: competencia(entrada.desconto_inicio),
          };
      if (
        unidadeExistente.cliente_id === clienteId &&
        temDesconto &&
        !vincularUsina
      )
        return {
          cliente_id: clienteId,
          unidade_id: unidadeExistente.id,
          estado: "ja_vinculada",
        };
      if (
        unidadeExistente.cliente_id === null &&
        entrada.confirmar_vinculo !== true
      )
        falhar(
          "Confirme os dados da UC existente antes de vinculá-la ao cliente.",
        );
      if (unidadeExistente.cliente_id === null) {
        const atualizado = banco
          .prepare(
            "UPDATE faturamento_unidades SET cliente_id=?,versao=versao+1 WHERE id=? AND cliente_id IS NULL",
          )
          .run(clienteId, unidadeExistente.id);
        if (atualizado.changes !== 1)
          falhar(
            "A UC mudou durante o cadastro. Atualize e confira novamente.",
            409,
          );
      }
      if (vincularUsina) {
        conferirVinculoComAprovadas(banco, unidadeExistente.id, usinaId);
        const vinculo = banco
          .prepare(
            "UPDATE faturamento_unidades SET usina_id=?,versao=versao+1 WHERE id=? AND usina_id IS NULL",
          )
          .run(usinaId, unidadeExistente.id);
        if (vinculo.changes !== 1)
          falhar(
            "A UC mudou durante o cadastro. Atualize e confira novamente.",
            409,
          );
      }
      if (descontoInicial) {
        banco
          .prepare(
            "INSERT INTO faturamento_descontos_uc (unidade_id,inicio,desconto) VALUES (?,?,?)",
          )
          .run(
            unidadeExistente.id,
            descontoInicial.inicio,
            descontoInicial.valor,
          );
        if (unidadeExistente.cliente_id === clienteId)
          banco
            .prepare(
              "UPDATE faturamento_unidades SET versao=versao+1 WHERE id=?",
            )
            .run(unidadeExistente.id);
      }
      historico(
        req,
        unidadeExistente.cliente_id === null
          ? "Vínculo de UC existente ao cliente do portal"
          : vincularUsina
            ? "Vínculo de UC existente à usina"
            : "Desconto inicial de UC vinculada",
        {
          cliente_id: clienteId,
          uc,
          ...(usinaId !== null ? { usina_id: usinaId } : {}),
          ...(descontoInicial ? { desconto: descontoInicial } : {}),
        },
        null,
        unidadeExistente.id,
      );
      return {
        cliente_id: clienteId,
        unidade_id: unidadeExistente.id,
        estado:
          unidadeExistente.cliente_id === null
            ? "vinculada"
            : vincularUsina
              ? "vinculada_usina"
              : "desconto_iniciado",
      };
    }
    const unidade = validarUnidade({
      uc,
      nome: entrada.unidade_nome,
      documento: entrada.unidade_documento,
      email: entrada.unidade_email,
      dia_vencimento: entrada.dia_vencimento,
    });
    const desconto = decimal(
      entrada.desconto,
      "o desconto percentual da UC",
      2,
      "100",
    );
    const inicio = competencia(entrada.desconto_inicio);
    const unidadeId = Number(
      banco
        .prepare(
          "INSERT INTO faturamento_unidades (uc,nome,documento,email,dia_vencimento,cliente_id,usina_id) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          unidade.uc,
          unidade.nome,
          unidade.documento,
          unidade.email,
          unidade.dia_vencimento,
          clienteId,
          usinaId,
        ).lastInsertRowid,
    );
    banco
      .prepare(
        "INSERT INTO faturamento_descontos_uc (unidade_id,inicio,desconto) VALUES (?,?,?)",
      )
      .run(unidadeId, inicio, desconto);
    historico(
      req,
      "Cadastro integrado de cliente e UC",
      {
        cliente_id: clienteId,
        uc,
        ...(usinaId !== null ? { usina_id: usinaId } : {}),
        desconto: { inicio, valor: desconto },
      },
      null,
      unidadeId,
    );
    return { cliente_id: clienteId, unidade_id: unidadeId, estado: "criada" };
  });
  res.status(resultado.estado === "ja_vinculada" ? 200 : 201).json(resultado);
});
function conferirUsina(numero) {
  if (
    numero !== null &&
    !obterBanco().prepare("SELECT id FROM usinas WHERE id=?").get(numero)
  )
    falhar("Usina não encontrada.");
}
function conferirUsinaReal(numero) {
  conferirUsina(numero);
  if (
    numero !== null &&
    chaveUsina(
      obterBanco().prepare("SELECT nome FROM usinas WHERE id=?").get(numero)
        ?.nome,
    ) === "ecosol"
  )
    falhar(
      "Ecosol é um vínculo provisório, não uma usina. Identifique a usina real.",
      409,
    );
}
router.post("/usinas", exigirNivel(3), (req, res) => {
  const entrada = req.body ?? {};
  const nome = texto(entrada.nome, "o nome da usina", 120),
    localizacao = texto(entrada.localizacao, "a localização", 160),
    modalidade = modalidadeUsina(entrada.modalidade),
    inicio = competencia(entrada.inicio);
  if (chaveUsina(nome) === "ecosol")
    falhar("Ecosol não é uma usina. Informe a usina real.", 409);
  const numero = transacao(() => {
    const banco = obterBanco();
    if (
      banco
        .prepare(
          "SELECT id FROM usinas WHERE lower(nome)=lower(?) AND lower(localizacao)=lower(?)",
        )
        .get(nome, localizacao)
    )
      falhar("Esta usina já está cadastrada.", 409);
    const numero = Number(
      banco
        .prepare(
          "INSERT INTO usinas(nome,localizacao,status) VALUES(?,?,'Cadastro inicial')",
        )
        .run(nome, localizacao).lastInsertRowid,
    );
    banco
      .prepare(
        "INSERT INTO usinas_modalidades(usina_id,inicio,modalidade) VALUES(?,?,?)",
      )
      .run(numero, inicio, modalidade);
    historico(req, "Cadastro de usina", {
      id: numero,
      nome,
      localizacao,
      modalidade,
      inicio,
    });
    return numero;
  });
  res.status(201).json({ id: numero });
});
router.patch("/usinas/:id", exigirNivel(3), (req, res) => {
  const usinaId = id(req.params.id);
  const localizacao = texto(req.body?.localizacao, "a localização", 160);
  const versao = Number(req.body?.versao);
  if (!Number.isSafeInteger(versao) || versao < 1)
    falhar("Versão da usina inválida.");
  transacao(() => {
    const banco = obterBanco();
    const anterior = banco
      .prepare("SELECT nome,localizacao,versao FROM usinas WHERE id=?")
      .get(usinaId);
    if (!anterior) falhar("Usina não encontrada.", 404);
    if (anterior.versao !== versao)
      falhar("Usina alterada. Atualize a lista antes de continuar.", 409);
    if (anterior.localizacao === localizacao) return;
    const atualizada = banco
      .prepare(
        "UPDATE usinas SET localizacao=?,versao=versao+1 WHERE id=? AND versao=?",
      )
      .run(localizacao, usinaId, versao);
    if (atualizada.changes !== 1)
      falhar("Usina alterada. Atualize a lista antes de continuar.", 409);
    historico(req, "Localização da usina atualizada", {
      usina_id: usinaId,
      nome: anterior.nome,
      anterior: anterior.localizacao,
      atual: localizacao,
    });
  });
  res.json({ sucesso: true });
});
function modalidadeUsina(valor) {
  if (valor !== "GDI" && valor !== "GDII")
    falhar("Selecione a modalidade GDI ou GDII da usina.");
  return valor;
}
router.post("/usinas/:id/modalidades", exigirNivel(3), (req, res) => {
  const entrada = req.body ?? {};
  const usinaId = id(req.params.id);
  const modalidade = modalidadeUsina(entrada.modalidade);
  const inicio = competencia(entrada.inicio);
  const versao = Number(entrada.versao);
  if (!Number.isSafeInteger(versao) || versao < 1)
    falhar("Versão da usina inválida.");
  transacao(() => {
    const banco = obterBanco();
    const usina = banco
      .prepare("SELECT id,versao FROM usinas WHERE id=?")
      .get(usinaId);
    if (!usina) falhar("Usina não encontrada.", 404);
    if (usina.versao !== versao)
      falhar("Usina alterada. Atualize a lista antes de continuar.", 409);
    if (
      banco
        .prepare(
          "SELECT 1 FROM usinas_modalidades WHERE usina_id=? AND inicio=?",
        )
        .get(usinaId, inicio)
    )
      falhar("Já existe modalidade para esta competência inicial.", 409);
    const proxima = banco
      .prepare(
        "SELECT MIN(inicio) AS inicio FROM usinas_modalidades WHERE usina_id=? AND inicio>?",
      )
      .get(usinaId, inicio).inicio;
    const aprovadaDivergente = banco
      .prepare(
        `SELECT d.id FROM faturamento_documentos d
         JOIN faturamento_unidades u ON u.id=d.unidade_id
         WHERE COALESCE(
           (SELECT v.usina_id FROM faturamento_vinculos_usina v
            WHERE v.unidade_id=u.id AND v.inicio<=d.competencia
            ORDER BY v.inicio DESC LIMIT 1), u.usina_id
         )=? AND d.status=? AND d.competencia>=?
           AND (? IS NULL OR d.competencia<?)
           AND COALESCE(json_extract(d.memoria,'$.contrato.modalidade'),'')<>?
         LIMIT 1`,
      )
      .get(usinaId, APROVADA, inicio, proxima, proxima, modalidade);
    if (aprovadaDivergente)
      falhar(
        "Esta vigência mudaria a modalidade de uma fatura aprovada. Escolha uma competência posterior.",
        409,
      );
    banco
      .prepare(
        "INSERT INTO usinas_modalidades(usina_id,inicio,modalidade) VALUES(?,?,?)",
      )
      .run(usinaId, inicio, modalidade);
    banco
      .prepare("UPDATE usinas SET versao=versao+1 WHERE id=? AND versao=?")
      .run(usinaId, versao);
    historico(req, "Nova vigência de modalidade da usina", {
      usina_id: usinaId,
      inicio,
      modalidade,
    });
  });
  res.status(201).json({ sucesso: true });
});
router.post("/usinas/:id/unidades", exigirNivel(2), (req, res) => {
  const usinaId = id(req.params.id);
  const unidadeId = id(req.body?.unidade_id);
  const versao = Number(req.body?.versao);
  if (!Number.isSafeInteger(versao) || versao < 1)
    falhar("Versão da UC inválida.");
  transacao(() => {
    const banco = obterBanco();
    conferirUsinaReal(usinaId);
    if (
      !banco
        .prepare("SELECT 1 FROM usinas_modalidades WHERE usina_id=? LIMIT 1")
        .get(usinaId)
    )
      falhar("Defina a modalidade da usina antes de vincular UCs.", 409);
    const unidade = banco
      .prepare(
        "SELECT id,uc,versao,usina_id FROM faturamento_unidades WHERE id=?",
      )
      .get(unidadeId);
    if (!unidade) falhar("UC não encontrada.", 404);
    if (unidade.versao !== versao)
      falhar("UC alterada. Atualize a lista antes de continuar.", 409);
    if (unidade.usina_id !== null)
      falhar(
        unidade.usina_id === usinaId
          ? "Esta UC já está vinculada à usina."
          : "Esta UC já pertence a outra usina. Transferências exigem um fluxo com histórico próprio.",
        409,
      );
    conferirVinculoComAprovadas(banco, unidadeId, usinaId);
    const atualizado = banco
      .prepare(
        "UPDATE faturamento_unidades SET usina_id=?,versao=versao+1 WHERE id=? AND versao=? AND usina_id IS NULL",
      )
      .run(usinaId, unidadeId, versao);
    if (atualizado.changes !== 1)
      falhar("UC alterada. Atualize a lista antes de continuar.", 409);
    historico(
      req,
      "Vínculo de UC à usina",
      {
        usina_id: usinaId,
        unidade_id: unidadeId,
        uc: unidade.uc,
      },
      null,
      unidadeId,
    );
  });
  res.status(201).json({ sucesso: true });
});
router.post("/unidades", exigirNivel(2), (req, res) => {
  const u = validarUnidade(req.body);
  const clienteId = clienteInformado(req.body.cliente_id);
  const desconto = decimal(
    req.body.desconto,
    "o desconto percentual da UC",
    2,
    "100",
  );
  const descontoInicio = competencia(
    req.body.desconto_inicio ?? req.body.inicio,
  );
  // Mantém compatibilidade com importações existentes, mas o cadastro manual
  // de uma UC não precisa criar um contrato para preparar faturas.
  const informouContrato = ["modalidade", "inicio"].some((campo) =>
    Object.hasOwn(req.body, campo),
  );
  const c = informouContrato ? validarContrato(req.body) : null;
  const numero = transacao(() => {
    const banco = obterBanco();
    conferirUsinaReal(u.usina_id);
    if (
      u.usina_id !== null &&
      !banco
        .prepare("SELECT 1 FROM usinas_modalidades WHERE usina_id=? LIMIT 1")
        .get(u.usina_id)
    )
      falhar(
        "Defina a modalidade da usina antes de cadastrar uma UC nela.",
        409,
      );
    conferirCliente(clienteId);
    const numero = Number(
      banco
        .prepare(
          "INSERT INTO faturamento_unidades (uc,nome,documento,email,dia_vencimento,usina_id,cliente_id) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          u.uc,
          u.nome,
          u.documento,
          u.email,
          u.dia_vencimento,
          u.usina_id,
          clienteId,
        ).lastInsertRowid,
    );
    banco
      .prepare(
        "INSERT INTO faturamento_descontos_uc (unidade_id,inicio,desconto) VALUES (?,?,?)",
      )
      .run(numero, descontoInicio, desconto);
    if (c)
      banco
        .prepare(
          "INSERT INTO faturamento_contratos (unidade_id,modalidade,desconto,inicio) VALUES (?,?,?,?)",
        )
        .run(numero, c.modalidade, c.desconto, c.inicio);
    historico(
      req,
      c ? "Cadastro de unidade e contrato" : "Cadastro de unidade",
      {
        unidade: { ...u, cliente_id: clienteId },
        desconto: { inicio: descontoInicio, valor: desconto },
        contrato: c,
      },
      null,
      numero,
    );
    return numero;
  });
  res.status(201).json({ id: numero });
});
router.patch("/unidades/:id", exigirNivel(2), (req, res) => {
  const numero = id(req.params.id),
    u = validarUnidade(req.body);
  transacao(() => {
    const banco = obterBanco();
    conferirUsina(u.usina_id);
    const anterior = banco
      .prepare("SELECT * FROM faturamento_unidades WHERE id=?")
      .get(numero);
    if (!anterior) falhar("Unidade não encontrada.", 404);
    const clienteId = Object.hasOwn(req.body, "cliente_id")
      ? clienteInformado(req.body.cliente_id)
      : anterior.cliente_id;
    conferirCliente(clienteId);
    if (anterior.versao !== Number(req.body.versao))
      falhar("Cadastro alterado. Atualize a lista.", 409);
    if (anterior.uc !== u.uc)
      falhar("O número da UC não pode ser alterado. Cadastre outra unidade.");
    if (anterior.usina_id !== null && anterior.usina_id !== u.usina_id)
      falhar(
        "Esta UC já pertence a uma usina. Transferências exigem um fluxo com histórico próprio.",
        409,
      );
    if (anterior.usina_id === null && u.usina_id !== null) {
      conferirUsinaReal(u.usina_id);
      if (
        !banco
          .prepare("SELECT 1 FROM usinas_modalidades WHERE usina_id=? LIMIT 1")
          .get(u.usina_id)
      )
        falhar("Defina a modalidade da usina antes de vincular UCs.", 409);
      conferirVinculoComAprovadas(banco, numero, u.usina_id);
    }
    banco
      .prepare(
        "UPDATE faturamento_unidades SET nome=?,documento=?,email=?,dia_vencimento=?,usina_id=?,cliente_id=?,cliente_provisorio_id=?,versao=versao+1 WHERE id=?",
      )
      .run(
        u.nome,
        u.documento,
        u.email,
        u.dia_vencimento,
        u.usina_id,
        clienteId,
        clienteId === null ? anterior.cliente_provisorio_id : null,
        numero,
      );
    historico(
      req,
      anterior.cliente_provisorio_id !== null && clienteId !== null
        ? "Conclusão cadastral de teste"
        : "Atualização cadastral",
      {
        anterior,
        novo: {
          ...u,
          cliente_id: clienteId,
          cliente_provisorio_id:
            clienteId === null ? anterior.cliente_provisorio_id : null,
        },
      },
      null,
      numero,
    );
  });
  res.json({ sucesso: true });
});
router.post("/unidades/:id/descontos", exigirNivel(3), (req, res) => {
  const numero = id(req.params.id);
  const inicio = competencia(req.body.inicio);
  const desconto = decimal(
    req.body.desconto,
    "o desconto percentual da UC",
    2,
    "100",
  );
  transacao(() => {
    const banco = obterBanco();
    const unidade = banco
      .prepare("SELECT id,versao FROM faturamento_unidades WHERE id=?")
      .get(numero);
    if (!unidade) falhar("Unidade não encontrada.", 404);
    if (unidade.versao !== Number(req.body.versao))
      falhar("Cadastro alterado. Atualize a lista.", 409);
    if (
      banco
        .prepare(
          "SELECT id FROM faturamento_documentos WHERE unidade_id=? AND competencia>=? AND status=?",
        )
        .get(numero, inicio, APROVADA)
    )
      falhar(
        "Já há cobrança aprovada nessa vigência. Escolha uma competência posterior.",
        409,
      );
    if (
      banco
        .prepare(
          "SELECT id FROM faturamento_descontos_uc WHERE unidade_id=? AND inicio=?",
        )
        .get(numero, inicio)
    )
      falhar("Já existe desconto para esta competência inicial.", 409);
    banco
      .prepare(
        "INSERT INTO faturamento_descontos_uc (unidade_id,inicio,desconto) VALUES (?,?,?)",
      )
      .run(numero, inicio, desconto);
    banco
      .prepare("UPDATE faturamento_unidades SET versao=versao+1 WHERE id=?")
      .run(numero);
    historico(
      req,
      "Nova vigência de desconto da UC",
      { inicio, desconto },
      null,
      numero,
    );
  });
  res.status(201).json({ sucesso: true });
});
router.post("/unidades/:id/contratos", exigirNivel(3), (req, res) => {
  const numero = id(req.params.id),
    c = validarContrato(req.body);
  transacao(() => {
    const banco = obterBanco();
    if (
      !banco
        .prepare("SELECT id FROM faturamento_unidades WHERE id=?")
        .get(numero)
    )
      falhar("Unidade não encontrada.", 404);
    if (
      banco
        .prepare(
          "SELECT id FROM faturamento_documentos WHERE unidade_id=? AND competencia>=? AND status=?",
        )
        .get(numero, c.inicio, APROVADA)
    )
      falhar(
        "A vigência alcança uma cobrança aprovada. Use uma competência posterior.",
        409,
      );
    banco
      .prepare(
        "INSERT INTO faturamento_contratos (unidade_id,modalidade,desconto,inicio) VALUES (?,?,?,?)",
      )
      .run(numero, c.modalidade, c.desconto, c.inicio);
    historico(req, "Nova vigência contratual", c, null, numero);
  });
  res.status(201).json({ sucesso: true });
});

router.get("/documentos", (_req, res) => {
  res.json(
    obterBanco()
      .prepare(
        "SELECT id FROM faturamento_documentos WHERE classificacao='fatura' AND excluido_em IS NULL ORDER BY id DESC",
      )
      .all()
      .map((r) => documento(r.id)),
  );
});
router.get("/recebimentos", (_req, res) => {
  res.json(
    obterBanco()
      .prepare(
        `SELECT r.*,d.nome AS nome_atual,d.status AS estado_documento,d.dados,d.memoria
         FROM faturamento_recebimentos_pdf r
         LEFT JOIN faturamento_documentos d ON d.id=r.documento_id
         WHERE r.documento_id IS NULL OR (d.classificacao='fatura' AND d.excluido_em IS NULL)
         ORDER BY r.id DESC`,
      )
      .all()
      .map(({ nome_atual, ...r }) => ({
        ...r,
        nome: nome_atual ?? r.nome,
        dados: r.dados ? JSON.parse(r.dados) : null,
        memoria: r.memoria ? JSON.parse(r.memoria) : null,
      })),
  );
});
router.get("/documentos/:id", (req, res) => {
  res.json(documentoCompleto(req.params.id));
});
router.get("/documentos/:id/pdf", (req, res) => {
  const d = documento(req.params.id);
  const arquivo = obterBanco()
    .prepare("SELECT pdf FROM faturamento_documentos WHERE id=?")
    .get(d.id);
  const nomeAscii = d.nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._ -]/g, "_");
  const nomeCodificado = encodeURIComponent(d.nome).replace(
    /['()*]/g,
    (caractere) => `%${caractere.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  res
    .set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nomeAscii}"; filename*=UTF-8''${nomeCodificado}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    })
    .send(Buffer.from(arquivo.pdf));
});

router.post("/documentos/:id/renomear", exigirNivel(2), (req, res) => {
  const numero = id(req.params.id);
  const novoNome = nomePdf(req.body?.nome);
  transacao(() => {
    const d = documento(numero);
    conferirVersao(d, req.body);
    if (novoNome === d.nome) return;
    const atualizado = obterBanco()
      .prepare(
        `UPDATE faturamento_documentos
         SET nome=?,versao=versao+1,atualizado_em=CURRENT_TIMESTAMP
         WHERE id=? AND versao=? AND classificacao='fatura'
           AND excluido_em IS NULL AND status<>?`,
      )
      .run(novoNome, numero, d.versao, APROVADA);
    if (atualizado.changes !== 1)
      falhar(
        "Este registro foi alterado. Atualize a fila e tente novamente.",
        409,
      );
    historico(
      req,
      "PDF renomeado",
      { anterior: d.nome, novo: novoNome },
      numero,
    );
  });
  res.set("Cache-Control", "no-store").json(documentoCompleto(numero));
});

router.post("/documentos/:id/excluir", exigirNivel(3), (req, res) => {
  const numero = id(req.params.id);
  if (req.body?.confirmacao !== "EXCLUIR")
    falhar("Digite EXCLUIR para confirmar a exclusão do PDF.");
  transacao(() => {
    const d = documento(numero);
    conferirVersao(d, req.body);
    if (
      d.status !== "Pendente de revisão" ||
      d.memoria !== null ||
      d.unidade_id !== null ||
      d.competencia !== null
    )
      falhar("Somente PDFs sem cálculo podem ser excluídos da fila.", 409);
    const removido = obterBanco()
      .prepare(
        `UPDATE faturamento_documentos
         SET pdf=X'',texto='',extracao='{}',dados='{}',
             classificacao='nao_fatura',excluido_em=CURRENT_TIMESTAMP,
             versao=versao+1,atualizado_em=CURRENT_TIMESTAMP
         WHERE id=? AND versao=? AND classificacao='fatura'
           AND excluido_em IS NULL AND status='Pendente de revisão'
           AND memoria IS NULL AND unidade_id IS NULL AND competencia IS NULL`,
      )
      .run(numero, d.versao);
    if (removido.changes !== 1)
      falhar(
        "Este registro foi alterado. Atualize a fila e tente novamente.",
        409,
      );
    historico(
      req,
      "Exclusão definitiva de PDF em Faturas",
      { nome: d.nome },
      numero,
    );
  });
  res.set("Cache-Control", "no-store").json({ excluido: true });
});

router.post("/documentos/:id/reanalisar", exigirNivel(3), async (req, res) => {
  const resultado = await reanalisarFatura({
    banco: obterBanco(),
    documentoId: id(req.params.id),
    versao: Number(req.body?.versao),
    responsavel: req.administrador.nome,
    administradorId: req.administrador.id,
  });
  res.json(resultado);
});

router.post(
  "/documentos",
  exigirNivel(2),
  express.raw({ type: "application/pdf", limit: "10mb" }),
  async (req, res) => {
    const resultado = await receberPdf({
      arquivo: req.body,
      nome: req.query.nome,
      lote: req.query.lote,
      ator: req.administrador,
      origem: "manual",
    });
    if (resultado.tipo === "duplicado")
      falhar("Este PDF já foi importado. Consulte a lista de faturas.", 409);
    res.status(201).json(documento(resultado.documentoId));
  },
);

const campos = [
  "uc",
  "unidade_id",
  "cliente_id",
  "uc_divergente_confirmada",
  "competencia",
  "injecao",
  "unitario",
  "bandeira",
  "total_equatorial",
  "ajuste_gdii",
  "vencimento_equatorial",
  "vencimento_ecosol",
  "origem_tarifa",
  "referencia_id",
  "modalidade",
];
function normalizarDadosConferencia(entrada) {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada))
    falhar("Informe os dados da fatura.");
  const dados = {};
  for (const campo of campos) {
    dados[campo] = String(entrada[campo] ?? "").trim();
    if (dados[campo].length > 80) falhar("Campo acima do limite permitido.");
  }
  return dados;
}
function hashCalculo(memoria) {
  return createHash("sha256").update(JSON.stringify(memoria)).digest("hex");
}
router.patch("/documentos/:id", exigirNivel(2), (req, res) => {
  const numero = id(req.params.id);
  transacao(() => {
    const d = documento(numero);
    conferirVersao(d, req.body);
    const dados = normalizarDadosConferencia(req.body.dados);
    obterBanco()
      .prepare(
        "UPDATE faturamento_documentos SET dados=?,memoria=NULL,unidade_id=NULL,competencia=NULL,status='Pendente de revisão',versao=versao+1,atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(JSON.stringify(dados), numero);
    historico(
      req,
      "Conferência salva",
      { anterior: d.dados, novo: dados },
      numero,
    );
  });
  res.json(documentoCompleto(numero));
});

function montarCalculo(d, dados = d.dados) {
  const banco = obterBanco(),
    uc = normalizarUc(dados.uc),
    mes = competencia(dados.competencia),
    semInjecao = decimal(dados.injecao, "a injeção SCEE") === "0";
  const unidade = banco
    .prepare(
      "SELECT u.*, s.nome AS usina_nome, c.name AS cliente_nome FROM faturamento_unidades u LEFT JOIN usinas s ON s.id=u.usina_id LEFT JOIN customers c ON c.id=u.cliente_id WHERE u.uc=?",
    )
    .get(uc);
  if (!unidade)
    falhar("Cadastre esta unidade em Clientes → Unidades e contratos.");
  if (unidade.cliente_provisorio_id !== null)
    falhar(
      "Cadastro provisório: confirme CPF/CNPJ, e-mail e cliente do portal antes de calcular uma cobrança.",
      409,
    );
  if (dados.unidade_id) {
    const unidadeSelecionada = Number(dados.unidade_id);
    if (
      !Number.isSafeInteger(unidadeSelecionada) ||
      unidadeSelecionada < 1 ||
      unidadeSelecionada !== unidade.id
    )
      falhar("O cliente selecionado não corresponde à UC desta fatura.");
    if (!dados.cliente_id)
      falhar("Selecione o cliente do portal vinculado a esta UC.");
  }
  if (dados.cliente_id) {
    const clienteSelecionado = Number(dados.cliente_id);
    if (
      !Number.isSafeInteger(clienteSelecionado) ||
      clienteSelecionado < 1 ||
      clienteSelecionado !== unidade.cliente_id
    )
      falhar("A UC não está vinculada ao cliente do portal selecionado.");
  }
  if (dados.unidade_id) {
    const ucLida = String(d.extracao?.dados?.uc ?? "")
      .replace(/\D/g, "")
      .replace(/^0+(?=\d)/, "");
    if (ucLida && ucLida !== uc && dados.uc_divergente_confirmada !== "sim")
      falhar(
        "A UC selecionada difere da leitura do PDF. Confirme essa divergência na conferência.",
      );
  }
  const modalidadeInformada = String(dados.modalidade ?? "").trim();
  const usinaIdDaCompetencia = usinaDaUnidadeNaCompetencia(
    banco,
    unidade.id,
    mes,
  );
  const modalidadeDaUsina =
    usinaIdDaCompetencia === null
      ? null
      : modalidadeVigenteDaUsina(banco, usinaIdDaCompetencia, mes);
  if (
    modalidadeDaUsina &&
    modalidadeInformada &&
    modalidadeInformada !== modalidadeDaUsina.modalidade
  )
    falhar(
      "A modalidade informada difere da modalidade vigente da usina nesta competência.",
      409,
    );
  const modalidade = modalidadeDaUsina?.modalidade ?? modalidadeInformada;
  if (!modalidade)
    falhar("Informe a modalidade nesta fatura antes de calcular.");
  const desconto = semInjecao
    ? null
    : banco
        .prepare(
          "SELECT inicio,desconto FROM faturamento_descontos_uc WHERE unidade_id=? AND inicio<=? ORDER BY inicio DESC LIMIT 1",
        )
        .get(unidade.id, mes);
  if (!semInjecao && !desconto)
    falhar(
      "Cadastre um desconto vigente para esta UC e competência antes de calcular.",
    );
  const contrato = {
    ...validarContrato({
      modalidade,
      desconto: semInjecao ? "0" : desconto.desconto,
      inicio: mes,
    }),
    origem: semInjecao
      ? "sem_injecao_sem_desconto"
      : modalidadeDaUsina
        ? "modalidade_da_usina_desconto_na_uc"
        : "modalidade_na_fatura_desconto_na_uc",
    ...(modalidadeDaUsina
      ? {
          usina_id: usinaIdDaCompetencia,
          modalidade_inicio: modalidadeDaUsina.inicio,
        }
      : {}),
    ...(desconto ? { desconto_inicio: desconto.inicio } : {}),
  };
  const vencimento_equatorial = dataValida(dados.vencimento_equatorial);
  const vencimentoInformado = String(dados.vencimento_ecosol ?? "").trim();
  const vencimento_ecosol = vencimentoInformado
    ? dataValida(vencimentoInformado)
    : vencimento_equatorial;
  if (vencimento_ecosol.slice(0, 7) < mes)
    falhar("O vencimento Ecosol não pode anteceder a competência.");
  let unitario = dados.unitario,
    bandeira = dados.bandeira,
    fonte = { tipo: "propria", documento_id: d.id };
  if (semInjecao) {
    unitario = "0";
    bandeira = "0";
    fonte = { tipo: "nao_aplicavel", documento_id: d.id };
  } else if (dados.origem_tarifa === "referencia") {
    const referencia = documento(dados.referencia_id);
    if (
      referencia.id === d.id ||
      referencia.lote !== d.lote ||
      referencia.status !== APROVADA ||
      referencia.memoria?.contrato.modalidade !== "GDI"
    )
      falhar("Selecione uma GDI aprovada do mesmo lote como referência.");
    unitario = referencia.memoria.entradas.unitario;
    bandeira = referencia.memoria.entradas.bandeira;
    fonte = {
      tipo: "referencia",
      documento_id: referencia.id,
      lote: referencia.lote,
      versao: referencia.versao,
    };
  } else if (dados.origem_tarifa !== "propria")
    falhar("Selecione a origem da tarifa.");
  const resultado = calcularCobranca({
    ...dados,
    unitario,
    bandeira,
    desconto: contrato.desconto,
    modalidade: contrato.modalidade,
  });
  return {
    ...resultado,
    unidade: {
      ...unidade,
      usina_id: usinaIdDaCompetencia,
      usina_nome:
        usinaIdDaCompetencia === null
          ? null
          : banco
              .prepare("SELECT nome FROM usinas WHERE id=?")
              .get(usinaIdDaCompetencia)?.nome,
    },
    contrato,
    competencia: mes,
    vencimento_equatorial,
    vencimento_ecosol,
    fonte,
  };
}

router.post("/documentos/:id/previa", (req, res) => {
  const d = documento(req.params.id);
  conferirVersao(d, req.body);
  const dados = normalizarDadosConferencia(req.body.dados);
  const memoria = montarCalculo(d, dados);
  res.set("Cache-Control", "no-store").json({
    memoria,
    hash: hashCalculo(memoria),
    versao: d.versao,
  });
});

router.post("/documentos/:id/calcular", exigirNivel(2), (req, res) => {
  const numero = id(req.params.id);
  transacao(() => {
    const d = documento(numero);
    conferirVersao(d, req.body);
    if (req.body.conferido !== true)
      falhar("Confirme a conferência dos dados com o PDF.");
    const dados =
      req.body.dados === undefined
        ? d.dados
        : normalizarDadosConferencia(req.body.dados);
    if (req.body.dados !== undefined && req.body.previa_hash === undefined)
      falhar("Gere a prévia antes de salvar e calcular.", 409);
    const memoria = montarCalculo(d, dados);
    const dadosPersistidos = {
      ...dados,
      modalidade: memoria.contrato.modalidade,
      vencimento_ecosol:
        String(dados.vencimento_ecosol ?? "").trim() ||
        memoria.vencimento_ecosol,
    };
    if (
      req.body.previa_hash !== undefined &&
      (!/^[a-f0-9]{64}$/.test(String(req.body.previa_hash)) ||
        req.body.previa_hash !== hashCalculo(memoria))
    )
      falhar(
        "Os valores mudaram desde a prévia. Atualize-a antes de calcular.",
        409,
      );
    obterBanco()
      .prepare(
        "UPDATE faturamento_documentos SET dados=?,memoria=?,unidade_id=?,competencia=?,status='Calculada',versao=versao+1,atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(
        JSON.stringify(dadosPersistidos),
        JSON.stringify(memoria),
        memoria.unidade.id,
        memoria.competencia,
        numero,
      );
    if (req.body.dados !== undefined)
      historico(
        req,
        "Conferência salva",
        { anterior: d.dados, novo: dadosPersistidos },
        numero,
      );
    historico(req, "Cálculo conferido", memoria, numero, memoria.unidade.id);
  });
  res.json(documentoCompleto(numero));
});

router.post("/documentos/:id/aprovar", exigirNivel(3), (req, res) => {
  const numero = id(req.params.id);
  transacao(() => {
    const d = documento(numero);
    conferirVersao(d, req.body);
    if (d.status !== "Calculada" || !d.memoria)
      falhar("Calcule e confira a cobrança antes de aprovar.");
    const atual = montarCalculo(d);
    if (JSON.stringify(atual) !== JSON.stringify(d.memoria))
      falhar(
        "Cadastro ou contrato alterado. Calcule novamente antes de aprovar.",
        409,
      );
    obterBanco()
      .prepare(
        "UPDATE faturamento_documentos SET status=?,versao=versao+1,atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(APROVADA, numero);
    historico(
      req,
      "Aprovação interna — sem emissão",
      d.memoria,
      numero,
      d.unidade_id,
    );
  });
  res.json(documentoCompleto(numero));
});

router.use("/planilhas", rotasPlanilhas);
router.use("/usinas/vinculos", rotasVinculosUsinas);
router.use("/usinas/transferencias", rotasTransferenciasUsinas);
router.use((erro, _req, res, _next) => {
  if (/UNIQUE constraint failed/.test(erro.message))
    return res.status(409).json({
      erro: "Registro duplicado: verifique o PDF, a UC, a vigência ou a cobrança da mesma unidade e competência.",
    });
  if (erro.type === "entity.too.large")
    return res.status(413).json({
      erro: "O arquivo excede o tamanho permitido (PDF: 10 MB; Excel: 5 MB).",
    });
  if (erro.status && erro.status < 500)
    return res.status(erro.status).json({ erro: erro.message });
  console.error(
    "Falha no módulo de faturamento:",
    erro.name,
    erro.code ?? "interno",
  );
  res
    .status(500)
    .json({ erro: "Não foi possível concluir a operação de faturamento." });
});
