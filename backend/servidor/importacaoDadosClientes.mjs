import express, { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { obterBanco } from "./bancoDeDados.mjs";
import { exigirNivel } from "./permissoesDaEquipe.mjs";
import { lerExcel } from "./faturamento/planilhas.mjs";
import { falhar, texto } from "./faturamento/regras.mjs";
import { apenasDigitos, cpfValidoParaCadastro } from "./validacaoDeCpf.mjs";
import { validarContatoCliente } from "./validacaoDeContato.mjs";

export const rotasImportacaoDadosClientes = Router();
rotasImportacaoDadosClientes.use(exigirNivel(3));
const mime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const normal = (valor) =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const aliases = {
  nome: [
    "nome",
    "cliente",
    "nome do cliente",
    "nome razao social",
    "titular",
    "razao social",
  ],
  cpf: ["cpf", "cpf cnpj", "documento", "cpf do cliente"],
  uc: ["uc", "uc atual", "nova uc", "unidade consumidora", "numero da uc"],
  email: ["email", "e mail", "email de cobranca", "e mail de cobranca"],
  telefone: ["telefone", "celular", "fone", "whatsapp"],
};

function cabecalhoDaAba(aba) {
  for (let indice = 0; indice < Math.min(30, aba.linhas.length); indice++) {
    const valores = aba.linhas[indice].map((celula) => normal(celula.valor));
    const mapa = Object.fromEntries(
      Object.entries(aliases).map(([campo, nomes]) => [
        campo,
        valores.findIndex((valor) => nomes.includes(valor)),
      ]),
    );
    if (mapa.nome >= 0 && (mapa.uc >= 0 || mapa.cpf >= 0))
      return { linha: indice + 1, mapa };
  }
  return null;
}

export function extrairDadosClientes(abas, abaSolicitada) {
  const reconhecidas = abas
    .map((aba) => ({ nome: aba.nome, cabecalho: cabecalhoDaAba(aba) }))
    .filter((aba) => aba.cabecalho);
  if (!reconhecidas.length)
    falhar("Não foi encontrada uma aba com Nome e CPF ou UC.");
  const escolhida = abaSolicitada
    ? reconhecidas.find((aba) => aba.nome === abaSolicitada)
    : reconhecidas[0];
  if (!escolhida) falhar("A aba escolhida não tem cabeçalho reconhecido.");
  const aba = abas.find((item) => item.nome === escolhida.nome);
  const linhas = [];
  for (
    let indice = escolhida.cabecalho.linha;
    indice < aba.linhas.length;
    indice++
  ) {
    const celulas = aba.linhas[indice];
    const dado = { linha: indice + 1 };
    for (const [campo, coluna] of Object.entries(escolhida.cabecalho.mapa)) {
      const celula = coluna < 0 ? null : celulas[coluna];
      dado[campo] =
        celula?.tipo === "formula" || celula?.tipo === "erro"
          ? ""
          : String(celula?.valor ?? "")
              .trim()
              .slice(0, 180);
    }
    if (
      !Object.values(dado).some((valor) => typeof valor === "string" && valor)
    )
      continue;
    linhas.push(dado);
  }
  if (linhas.length > 2000) falhar("Analise até 2.000 clientes por planilha.");
  return {
    aba: escolhida.nome,
    abas: reconhecidas.map((item) => item.nome),
    linhas,
  };
}

function clienteDaUc(banco, uc) {
  if (!uc) return null;
  return banco
    .prepare(
      `SELECT u.id,u.uc,u.nome,u.documento,u.email,u.versao,u.cliente_id,
    u.cliente_provisorio_id,u.cliente_operacional_id
    FROM faturamento_unidades u
    WHERE u.uc=? OR u.id=(SELECT unidade_id FROM faturamento_unidades_aliases WHERE uc=?)`,
    )
    .get(uc, uc);
}

export function prepararDadosClientes(banco, linhas) {
  const vistos = new Map();
  const identidades = new Map();
  const conflitos = new Set();
  const linhasPorUc = new Map();
  const ucsDivergentes = new Set();
  for (const dado of linhas) {
    const cpf = apenasDigitos(dado.cpf);
    const uc = apenasDigitos(dado.uc);
    if (uc) {
      const assinatura = `${cpf}:${normal(dado.nome)}:${String(dado.email ?? "")
        .trim()
        .toLowerCase()}:${apenasDigitos(dado.telefone)}`;
      if (linhasPorUc.has(uc) && linhasPorUc.get(uc) !== assinatura)
        ucsDivergentes.add(uc);
      linhasPorUc.set(uc, assinatura);
    }
    if (!cpf) continue;
    const atual = {
      nome: normal(dado.nome),
      email: String(dado.email ?? "")
        .trim()
        .toLowerCase(),
      telefone: apenasDigitos(dado.telefone),
    };
    const anterior = identidades.get(cpf);
    if (
      anterior &&
      (anterior.nome !== atual.nome ||
        (anterior.email && atual.email && anterior.email !== atual.email) ||
        (anterior.telefone &&
          atual.telefone &&
          anterior.telefone !== atual.telefone))
    )
      conflitos.add(cpf);
    identidades.set(cpf, {
      nome: atual.nome,
      email: atual.email || anterior?.email || "",
      telefone: atual.telefone || anterior?.telefone || "",
    });
  }
  const resultado = [];
  for (const dado of linhas) {
    const nome = String(dado.nome ?? "").trim();
    const cpf = apenasDigitos(dado.cpf);
    const uc = apenasDigitos(dado.uc);
    const email = String(dado.email ?? "")
      .trim()
      .toLowerCase();
    const telefone = String(dado.telefone ?? "").trim();
    const item = {
      linha: dado.linha,
      nome,
      cpf,
      uc,
      email,
      telefone,
      acao: "conferir",
      motivo: "",
    };
    const unidade = clienteDaUc(banco, uc);
    const cliente = cpf
      ? banco
          .prepare("SELECT id,name,cpf,email,phone FROM customers WHERE cpf=?")
          .get(cpf)
      : null;
    const titular = unidade?.cliente_id
      ? banco
          .prepare("SELECT id,name,cpf,email,phone FROM customers WHERE id=?")
          .get(unidade.cliente_id)
      : null;
    const chave = uc || `cpf:${cpf}`;
    if (!nome || (!uc && !cpf)) item.motivo = "Informe nome e UC ou CPF.";
    else if (uc && (uc.length < 6 || uc.length > 20))
      item.motivo = "UC inválida.";
    else if (cpf && !cpfValidoParaCadastro(dado.cpf))
      item.motivo = "CPF inválido para cadastro no portal.";
    else if (uc && ucsDivergentes.has(uc))
      item.motivo =
        "UC repetida com titulares ou contatos divergentes na planilha. Confira manualmente.";
    else if (cpf && conflitos.has(cpf))
      item.motivo =
        "O mesmo CPF aparece com nome ou contatos divergentes na planilha.";
    else if (
      titular &&
      (!cpf || titular.cpf !== cpf || normal(titular.name) !== normal(nome))
    )
      item.motivo =
        "Possível mudança de titularidade. Confirme manualmente; nenhuma transferência será feita.";
    else if (
      vistos.has(chave) &&
      vistos.get(chave) !== `${cpf}:${normal(nome)}:${email}:${telefone}`
    )
      item.motivo =
        "UC ou cliente repetido com dados diferentes nesta planilha.";
    else if (unidade && !titular && normal(unidade.nome) !== normal(nome))
      item.motivo =
        "Nome da UC difere do titular da planilha. Conferência manual necessária.";
    else if (
      unidade &&
      !titular &&
      unidade.documento &&
      apenasDigitos(unidade.documento) !== cpf
    )
      item.motivo =
        "Documento da UC difere do CPF da planilha. Conferência manual necessária.";
    else if (
      unidade &&
      email &&
      unidade.email &&
      unidade.email.toLowerCase() !== email
    )
      item.motivo =
        "E-mail de cobrança da UC difere da planilha. Confira antes de alterar.";
    else if (
      unidade &&
      !titular &&
      banco
        .prepare(
          "SELECT 1 FROM faturamento_documentos WHERE unidade_id=? AND status='Aprovada — aguardando emissão' LIMIT 1",
        )
        .get(unidade.id)
    )
      item.motivo =
        "A UC possui cobrança aprovada. Confira o vínculo antes de alterá-lo.";
    else if (cliente && normal(cliente.name) !== normal(nome))
      item.motivo =
        "CPF já cadastrado com outro nome. Conferência manual necessária.";
    else if (!cpf)
      item.motivo =
        "CPF ausente: cliente do portal não será criado ou alterado.";
    else if (!email && !telefone && !cliente)
      item.motivo = "Novo cliente precisa de e-mail ou telefone válido.";
    else if ((email || telefone) && !validarContatoCliente(email, telefone))
      item.motivo = "E-mail ou telefone inválido.";
    else if (
      cliente &&
      ((email && cliente.email && cliente.email !== email) ||
        (telefone &&
          cliente.phone &&
          cliente.phone !== apenasDigitos(telefone)))
    )
      item.motivo =
        "Contato existente diferente. Confira antes de substituir manualmente.";
    else if (
      cliente &&
      unidade?.cliente_id &&
      (!email || cliente.email) &&
      (!telefone || cliente.phone) &&
      (!email || unidade.email) &&
      unidade.documento
    ) {
      item.acao = "sem_alteracao";
      item.motivo = "Cadastro já contém os dados informados.";
    } else if (cliente) {
      item.acao =
        unidade && !unidade.cliente_id
          ? "vincular_e_completar"
          : "completar_contato";
      item.motivo =
        unidade && !unidade.cliente_id
          ? "Vincular UC ao cliente de mesmo CPF e completar contatos vazios."
          : "Preencher apenas contatos vazios; dados existentes permanecem.";
    } else if (
      banco.prepare("SELECT 1 FROM staff_users WHERE cpf=?").get(cpf)
    ) {
      item.motivo = "CPF já pertence a uma conta da equipe.";
    } else {
      item.acao = unidade ? "criar_e_vincular" : "criar_cliente";
      item.motivo = unidade
        ? "Criar cliente sem acesso ao portal e vincular a UC após confirmação."
        : "Criar cliente sem acesso ao portal; UC não encontrada no sistema.";
    }
    if (chave && !vistos.has(chave))
      vistos.set(chave, `${cpf}:${normal(nome)}:${email}:${telefone}`);
    resultado.push(item);
  }
  return resultado;
}

function sessao(req, banco) {
  const atual = banco
    .prepare("SELECT * FROM importacoes_dados_clientes WHERE id=?")
    .get(String(req.params.id));
  if (!atual || atual.responsavel_id !== req.administrador.id)
    falhar("Análise não encontrada para este acesso.", 404);
  if (atual.status !== "Concluída" && atual.expira_em < Date.now())
    falhar("Análise expirada. Envie a planilha novamente.", 410);
  return atual;
}

rotasImportacaoDadosClientes.post(
  "/analisar",
  express.raw({ type: mime, limit: "5mb" }),
  async (req, res) => {
    const nome = texto(req.query.nome, "o nome do arquivo", 200);
    if (
      !/\.xlsx$/i.test(nome) ||
      !Buffer.isBuffer(req.body) ||
      req.body.length < 4 ||
      req.body.subarray(0, 2).toString() !== "PK"
    )
      falhar("Envie uma planilha .xlsx com até 5 MB.");
    let abas;
    try {
      abas = await lerExcel(req.body);
    } catch (erro) {
      falhar(`Não foi possível ler a planilha: ${erro.message}`);
    }
    const extraidos = extrairDadosClientes(abas, String(req.query.aba ?? ""));
    const banco = obterBanco();
    banco
      .prepare(
        "UPDATE importacoes_dados_clientes SET status='Expirada',linhas='[]',previa=NULL WHERE status='Pendente' AND expira_em<?",
      )
      .run(Date.now());
    const id = randomUUID();
    banco
      .prepare(
        "INSERT INTO importacoes_dados_clientes(id,responsavel_id,arquivo,hash,linhas,expira_em) VALUES(?,?,?,?,?,?)",
      )
      .run(
        id,
        req.administrador.id,
        nome,
        createHash("sha256").update(req.body).digest("hex"),
        JSON.stringify(extraidos.linhas),
        Date.now() + 60 * 60 * 1000,
      );
    res.status(201).json({
      id,
      aba: extraidos.aba,
      abas: extraidos.abas,
      linhas: extraidos.linhas.length,
    });
  },
);

rotasImportacaoDadosClientes.post("/:id/previa", (req, res) => {
  const banco = obterBanco();
  const atual = sessao(req, banco);
  if (atual.status !== "Pendente")
    falhar("Esta análise já foi concluída.", 409);
  const linhas = prepararDadosClientes(banco, JSON.parse(atual.linhas));
  const previaId = randomUUID();
  banco
    .prepare(
      "UPDATE importacoes_dados_clientes SET previa=?,previa_id=? WHERE id=?",
    )
    .run(JSON.stringify(linhas), previaId, atual.id);
  res.json({
    previa_id: previaId,
    linhas,
    resumo: {
      criar: linhas.filter((item) => item.acao.startsWith("criar")).length,
      completar: linhas.filter((item) =>
        ["completar_contato", "vincular_e_completar"].includes(item.acao),
      ).length,
      conferir: linhas.filter((item) => item.acao === "conferir").length,
    },
  });
});

rotasImportacaoDadosClientes.post("/:id/confirmar", (req, res) => {
  const banco = obterBanco();
  banco.exec("BEGIN IMMEDIATE");
  try {
    const atual = sessao(req, banco);
    if (atual.status === "Concluída") {
      banco.exec("COMMIT");
      return res.json({ quantidade: atual.quantidade, ja_concluida: true });
    }
    if (
      !atual.previa ||
      atual.previa_id !== req.body?.previa_id ||
      req.body?.confirmado !== true
    )
      falhar("Gere e confirme a prévia atual antes de importar.", 409);
    const anterior = JSON.parse(atual.previa);
    const agora = prepararDadosClientes(banco, JSON.parse(atual.linhas));
    if (JSON.stringify(agora) !== JSON.stringify(anterior))
      falhar("Os cadastros mudaram desde a prévia. Gere outra prévia.", 409);
    const criados = new Map();
    let quantidade = 0;
    for (const item of agora) {
      if (["conferir", "sem_alteracao"].includes(item.acao)) continue;
      const unidade = clienteDaUc(banco, item.uc);
      let cliente = banco
        .prepare("SELECT id,email,phone FROM customers WHERE cpf=?")
        .get(item.cpf);
      if (!cliente && criados.has(item.cpf))
        cliente = { id: criados.get(item.cpf), email: "", phone: "" };
      if (!cliente) {
        const id = Number(
          banco
            .prepare(
              "INSERT INTO customers(name,cpf,email,phone) VALUES(?,?,?,?)",
            )
            .run(
              item.nome,
              item.cpf,
              item.email,
              validarContatoCliente(item.email, item.telefone)?.phone ?? "",
            ).lastInsertRowid,
        );
        criados.set(item.cpf, id);
        cliente = {
          id,
          email: item.email,
          phone: validarContatoCliente(item.email, item.telefone)?.phone ?? "",
        };
      } else {
        const contato = validarContatoCliente(item.email, item.telefone);
        banco
          .prepare(
            "UPDATE customers SET email=CASE WHEN email='' THEN ? ELSE email END,phone=CASE WHEN phone='' THEN ? ELSE phone END WHERE id=?",
          )
          .run(item.email, contato?.phone ?? "", cliente.id);
      }
      if (unidade && !unidade.cliente_id) {
        banco
          .prepare(
            `UPDATE faturamento_unidades SET cliente_id=?,cliente_provisorio_id=NULL,
          cliente_operacional_id=NULL,pendencia_cadastro=NULL,versao=versao+1 WHERE id=? AND cliente_id IS NULL`,
          )
          .run(cliente.id, unidade.id);
      }
      if (unidade)
        banco
          .prepare(
            `UPDATE faturamento_unidades
          SET email=CASE WHEN email='' THEN ? ELSE email END,
              documento=CASE WHEN documento='' THEN ? ELSE documento END,
              versao=versao+1
          WHERE id=? AND ((email='' AND ?<>'') OR documento='')`,
          )
          .run(item.email, item.cpf, unidade.id, item.email);
      banco
        .prepare(
          "INSERT INTO faturamento_historico(unidade_id,responsavel,administrador_id,acao,dados) VALUES(?,?,?,?,?)",
        )
        .run(
          unidade?.id ?? null,
          req.administrador.nome,
          req.administrador.id,
          "Dados de cliente importados de planilha",
          JSON.stringify({
            importacao_id: atual.id,
            hash: atual.hash,
            linha: item.linha,
            acao: item.acao,
            cliente_id: cliente.id,
            uc: item.uc,
          }),
        );
      quantidade++;
    }
    banco
      .prepare(
        "UPDATE importacoes_dados_clientes SET status='Concluída',quantidade=?,linhas='[]',previa=NULL WHERE id=?",
      )
      .run(quantidade, atual.id);
    banco.exec("COMMIT");
    res.json({
      quantidade,
      conferir: agora.filter((item) => item.acao === "conferir").length,
    });
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
});
