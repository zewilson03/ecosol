import { obterBanco } from "../bancoDeDados.mjs";
import { conferirCredencialConfirmacao } from "../bancario/credencialConfirmacao.mjs";
import { temPapelCritico } from "../bancario/permissoes.mjs";

const categorias = new Set([
  "interno",
  "obra",
  "usina",
  "eletroposto",
  "outro",
]);
const origens = new Set(["energia", "produtos", "outro"]);
const formasPagamento = new Set([
  "boleto",
  "pix",
  "transferencia",
  "cartao",
  "dinheiro",
  "debito_automatico",
  "outro",
]);

function falhar(mensagem, status = 400, codigo = null) {
  const erro = new Error(mensagem);
  erro.status = status;
  erro.codigo = codigo;
  throw erro;
}

function texto(valor, nome, maximo, obrigatorio = true) {
  const resultado = String(valor ?? "").trim();
  if (
    (obrigatorio && !resultado) ||
    resultado.length > maximo ||
    /[\r\n]/.test(resultado)
  )
    falhar(`Informe ${nome} dentro do limite permitido.`);
  return resultado;
}

function dataIso(valor) {
  const resultado = String(valor ?? "");
  const data = new Date(`${resultado}T12:00:00Z`);
  if (
    !/^20\d{2}-\d{2}-\d{2}$/.test(resultado) ||
    Number.isNaN(data.getTime()) ||
    data.toISOString().slice(0, 10) !== resultado
  )
    falhar("Informe uma data de vencimento válida.");
  return resultado;
}

function quantidadeMilesimos(valor) {
  const normalizado = String(valor ?? "")
    .trim()
    .replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(normalizado))
    falhar("Informe uma quantidade positiva com até três casas decimais.");
  const [inteiro, decimal = ""] = normalizado.split(".");
  const resultado = Number(inteiro) * 1000 + Number(decimal.padEnd(3, "0"));
  if (!Number.isSafeInteger(resultado) || resultado <= 0)
    falhar("A quantidade precisa ser maior que zero.");
  return resultado;
}

function centavos(valor, nome = "valor") {
  const normalizado = String(valor ?? "")
    .trim()
    .replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalizado))
    falhar(`Informe ${nome} positivo com até duas casas decimais.`);
  const [inteiro, decimal = ""] = normalizado.split(".");
  const resultado = Number(inteiro) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(resultado) || resultado <= 0)
    falhar(`${nome} precisa ser maior que zero.`);
  return resultado;
}

function totalItem(quantidade, unitario) {
  const numerador = BigInt(quantidade) * BigInt(unitario);
  return Number((numerador + 500n) / 1000n);
}

function transacao(banco, acao) {
  banco.exec("BEGIN IMMEDIATE");
  try {
    const resultado = acao();
    banco.exec("COMMIT");
    return resultado;
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

export function prepararPagamentosECompras(banco = obterBanco()) {
  banco.exec(`
    CREATE TABLE IF NOT EXISTS financeiro_tipos_produto (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
      categoria TEXT NOT NULL CHECK(categoria IN ('interno','obra','usina','eletroposto','outro')),
      ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0,1)),
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS financeiro_produtos (
      id INTEGER PRIMARY KEY,
      tipo_id INTEGER NOT NULL REFERENCES financeiro_tipos_produto(id) ON DELETE RESTRICT,
      nome TEXT NOT NULL COLLATE NOCASE,
      unidade TEXT NOT NULL DEFAULT 'un',
      ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0,1)),
      versao INTEGER NOT NULL DEFAULT 1 CHECK(versao>=1),
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tipo_id,nome)
    );
    CREATE TABLE IF NOT EXISTS financeiro_solicitacoes_pagamento (
      id INTEGER PRIMARY KEY,
      origem TEXT NOT NULL CHECK(origem IN ('energia','produtos','outro')),
      descricao TEXT NOT NULL,
      favorecido TEXT NOT NULL,
      documento_favorecido TEXT,
      forma_pagamento TEXT NOT NULL DEFAULT 'boleto'
        CHECK(forma_pagamento IN ('boleto','pix','transferencia','cartao','dinheiro','debito_automatico','outro')),
      vencimento TEXT NOT NULL,
      valor_centavos INTEGER NOT NULL CHECK(valor_centavos>0),
      status TEXT NOT NULL DEFAULT 'rascunho'
        CHECK(status IN ('rascunho','aguardando_aprovacao','aprovada','rejeitada','paga','cancelada')),
      criado_por INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
      aprovado_por INTEGER REFERENCES staff_users(id) ON DELETE RESTRICT,
      pago_por INTEGER REFERENCES staff_users(id) ON DELETE RESTRICT,
      pago_em TEXT,
      referencia_pagamento TEXT,
      versao INTEGER NOT NULL DEFAULT 1 CHECK(versao>=1),
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS financeiro_itens_compra (
      id INTEGER PRIMARY KEY,
      solicitacao_id INTEGER NOT NULL REFERENCES financeiro_solicitacoes_pagamento(id) ON DELETE RESTRICT,
      produto_id INTEGER REFERENCES financeiro_produtos(id) ON DELETE RESTRICT,
      descricao TEXT NOT NULL,
      quantidade_milesimos INTEGER NOT NULL CHECK(quantidade_milesimos>0),
      valor_unitario_centavos INTEGER NOT NULL CHECK(valor_unitario_centavos>0),
      total_centavos INTEGER NOT NULL CHECK(total_centavos>0)
    );
    CREATE TABLE IF NOT EXISTS financeiro_auditoria_pagamentos (
      id INTEGER PRIMARY KEY,
      solicitacao_id INTEGER NOT NULL REFERENCES financeiro_solicitacoes_pagamento(id) ON DELETE RESTRICT,
      ator_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
      ator_nome TEXT NOT NULL,
      acao TEXT NOT NULL,
      estado_anterior TEXT,
      estado_novo TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS financeiro_solicitacoes_status
      ON financeiro_solicitacoes_pagamento(status,vencimento,id);
  `);
  const colunas = banco
    .prepare("PRAGMA table_info(financeiro_solicitacoes_pagamento)")
    .all();
  const nomes = new Set(colunas.map((coluna) => coluna.name));
  if (!nomes.has("forma_pagamento"))
    banco.exec(
      "ALTER TABLE financeiro_solicitacoes_pagamento ADD COLUMN forma_pagamento TEXT NOT NULL DEFAULT 'boleto'",
    );
  if (!nomes.has("pago_por"))
    banco.exec(
      "ALTER TABLE financeiro_solicitacoes_pagamento ADD COLUMN pago_por INTEGER REFERENCES staff_users(id)",
    );
  if (!nomes.has("pago_em"))
    banco.exec(
      "ALTER TABLE financeiro_solicitacoes_pagamento ADD COLUMN pago_em TEXT",
    );
  if (!nomes.has("referencia_pagamento"))
    banco.exec(
      "ALTER TABLE financeiro_solicitacoes_pagamento ADD COLUMN referencia_pagamento TEXT",
    );
  if (!nomes.has("faturamento_documento_id"))
    banco.exec(
      "ALTER TABLE financeiro_solicitacoes_pagamento ADD COLUMN faturamento_documento_id INTEGER REFERENCES faturamento_documentos(id) ON DELETE RESTRICT",
    );
  if (!nomes.has("faturamento_documento_versao"))
    banco.exec(
      "ALTER TABLE financeiro_solicitacoes_pagamento ADD COLUMN faturamento_documento_versao INTEGER",
    );
  if (!nomes.has("fatura_uc"))
    banco.exec(
      "ALTER TABLE financeiro_solicitacoes_pagamento ADD COLUMN fatura_uc TEXT",
    );
  if (!nomes.has("fatura_competencia"))
    banco.exec(
      "ALTER TABLE financeiro_solicitacoes_pagamento ADD COLUMN fatura_competencia TEXT",
    );
  banco.exec(`CREATE UNIQUE INDEX IF NOT EXISTS financeiro_solicitacao_fatura
    ON financeiro_solicitacoes_pagamento(faturamento_documento_id)
    WHERE faturamento_documento_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS financeiro_solicitacao_uc_competencia
    ON financeiro_solicitacoes_pagamento(fatura_uc,fatura_competencia)
    WHERE fatura_uc IS NOT NULL AND fatura_competencia IS NOT NULL`);
}

export function listarPagamentosECompras(banco = obterBanco()) {
  return {
    tipos: banco
      .prepare("SELECT * FROM financeiro_tipos_produto ORDER BY categoria,nome")
      .all(),
    produtos: banco
      .prepare(
        `SELECT p.*,t.nome AS tipo_nome,t.categoria FROM financeiro_produtos p JOIN financeiro_tipos_produto t ON t.id=p.tipo_id ORDER BY t.categoria,t.nome,p.nome`,
      )
      .all(),
    solicitacoes: banco
      .prepare(
        `
      SELECT s.*,c.name AS criado_por_nome,a.name AS aprovado_por_nome,
        (SELECT COUNT(*) FROM financeiro_itens_compra i WHERE i.solicitacao_id=s.id) AS quantidade_itens
      FROM financeiro_solicitacoes_pagamento s
      JOIN staff_users c ON c.id=s.criado_por
      LEFT JOIN staff_users a ON a.id=s.aprovado_por
      ORDER BY s.criado_em DESC,s.id DESC
    `,
      )
      .all(),
  };
}

export function criarTipoProduto(campos, administrador, banco = obterBanco()) {
  const nome = texto(campos?.nome, "o nome do tipo", 80);
  const categoria = String(campos?.categoria ?? "")
    .trim()
    .toLowerCase();
  if (!categorias.has(categoria)) falhar("Categoria de produto inválida.");
  try {
    const id = Number(
      banco
        .prepare(
          "INSERT INTO financeiro_tipos_produto(nome,categoria) VALUES(?,?)",
        )
        .run(nome, categoria).lastInsertRowid,
    );
    return { id, nome, categoria, criado_por: administrador.nome };
  } catch (erro) {
    if (String(erro?.message).includes("UNIQUE"))
      falhar("Este tipo de produto já existe.", 409);
    throw erro;
  }
}

export function criarProduto(campos, administrador, banco = obterBanco()) {
  const tipoId = Number(campos?.tipo_id);
  if (
    !Number.isSafeInteger(tipoId) ||
    tipoId <= 0 ||
    !banco
      .prepare("SELECT 1 FROM financeiro_tipos_produto WHERE id=? AND ativo=1")
      .get(tipoId)
  )
    falhar("Selecione um tipo de produto ativo.");
  const nome = texto(campos?.nome, "o nome do produto", 120);
  const unidade = texto(campos?.unidade || "un", "a unidade", 20);
  try {
    const id = Number(
      banco
        .prepare(
          "INSERT INTO financeiro_produtos(tipo_id,nome,unidade) VALUES(?,?,?)",
        )
        .run(tipoId, nome, unidade).lastInsertRowid,
    );
    return {
      id,
      tipo_id: tipoId,
      nome,
      unidade,
      criado_por: administrador.nome,
    };
  } catch (erro) {
    if (String(erro?.message).includes("UNIQUE"))
      falhar("Este produto já existe no tipo selecionado.", 409);
    throw erro;
  }
}

export function criarSolicitacaoPagamento(
  campos,
  administrador,
  banco = obterBanco(),
) {
  const origem = String(campos?.origem ?? "")
    .trim()
    .toLowerCase();
  if (!origens.has(origem)) falhar("Origem do pagamento inválida.");
  const descricao = texto(campos?.descricao, "a descrição", 160);
  const favorecido = texto(campos?.favorecido, "o favorecido", 120);
  const documento = texto(
    campos?.documento_favorecido,
    "o documento do favorecido",
    20,
    false,
  ).replace(/\D/g, "");
  if (documento && ![11, 14].includes(documento.length))
    falhar("CPF/CNPJ do favorecido inválido.");
  const vencimento = dataIso(campos?.vencimento);
  const formaPagamento = String(campos?.forma_pagamento ?? "boleto")
    .trim()
    .toLowerCase();
  if (!formasPagamento.has(formaPagamento))
    falhar("Forma de pagamento inválida.");
  const itensEntrada = Array.isArray(campos?.itens) ? campos.itens : [];
  if (origem === "produtos" && itensEntrada.length === 0)
    falhar("Inclua ao menos um produto na compra.");
  const itens = itensEntrada.map((item) => {
    const produtoId =
      item.produto_id == null || item.produto_id === ""
        ? null
        : Number(item.produto_id);
    const produto = produtoId
      ? banco
          .prepare(
            "SELECT nome FROM financeiro_produtos WHERE id=? AND ativo=1",
          )
          .get(produtoId)
      : null;
    if (produtoId && !produto)
      falhar("Um dos produtos não existe ou está inativo.");
    const quantidade = quantidadeMilesimos(item.quantidade);
    const unitario = centavos(item.valor_unitario, "valor unitário");
    return {
      produto_id: produtoId,
      descricao: texto(
        item.descricao || produto?.nome,
        "a descrição do item",
        120,
      ),
      quantidade_milesimos: quantidade,
      valor_unitario_centavos: unitario,
      total_centavos: totalItem(quantidade, unitario),
    };
  });
  const valor = itens.length
    ? itens.reduce((soma, item) => soma + item.total_centavos, 0)
    : centavos(campos?.valor);
  return transacao(banco, () => {
    const id = Number(
      banco
        .prepare(
          `INSERT INTO financeiro_solicitacoes_pagamento
      (origem,descricao,favorecido,documento_favorecido,forma_pagamento,vencimento,valor_centavos,criado_por)
      VALUES(?,?,?,?,?,?,?,?)`,
        )
        .run(
          origem,
          descricao,
          favorecido,
          documento || null,
          formaPagamento,
          vencimento,
          valor,
          administrador.id,
        ).lastInsertRowid,
    );
    const inserir = banco.prepare(`INSERT INTO financeiro_itens_compra
      (solicitacao_id,produto_id,descricao,quantidade_milesimos,valor_unitario_centavos,total_centavos)
      VALUES(?,?,?,?,?,?)`);
    for (const item of itens)
      inserir.run(
        id,
        item.produto_id,
        item.descricao,
        item.quantidade_milesimos,
        item.valor_unitario_centavos,
        item.total_centavos,
      );
    banco
      .prepare(
        `INSERT INTO financeiro_auditoria_pagamentos
      (solicitacao_id,ator_id,ator_nome,acao,estado_novo) VALUES(?,?,?,'Solicitação criada','rascunho')`,
      )
      .run(id, administrador.id, administrador.nome);
    return { id, status: "rascunho", valor_centavos: valor };
  });
}

function dadosDaFaturaParaPagamento(documentoId, banco) {
  const numero = Number(documentoId);
  if (!Number.isSafeInteger(numero) || numero <= 0)
    falhar("Documento de faturamento inválido.");
  const documento = banco
    .prepare(
      `SELECT id,dados,versao
         FROM faturamento_documentos
         WHERE id=? AND classificacao='fatura'
           AND finalidade IN ('cobranca','pagamento')
           AND excluido_em IS NULL`,
    )
    .get(numero);
  if (!documento) falhar("Fatura destinada a pagamento não encontrada.", 404);

  let dados;
  try {
    dados = JSON.parse(documento.dados);
  } catch {
    falhar("Os dados extraídos da fatura estão inválidos.", 409);
  }
  let vencimento;
  let valor;
  try {
    vencimento = dataIso(dados?.vencimento_equatorial);
    valor = centavos(dados?.total_equatorial, "valor total da fatura");
  } catch {
    falhar("Confirme o vencimento e o valor total da fatura.", 409);
  }
  const uc = String(dados?.uc ?? dados?.uc_geradora ?? "").trim();
  const competencia = String(dados?.competencia ?? "").trim();
  if (!/^\d{4,20}$/.test(uc) || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(competencia))
    falhar(
      "Confirme a UC e a competência da fatura antes de cadastrá-la para pagamento.",
      409,
    );
  const referencias = [
    uc && `UC ${uc}`,
    competencia && `competência ${competencia}`,
  ]
    .filter(Boolean)
    .join(" — ");
  const descricao = `Fatura Equatorial${referencias ? ` — ${referencias}` : ""}`;
  return { documento, vencimento, valor, uc, competencia, descricao };
}

function conferirSnapshotDaFatura(solicitacao, banco) {
  if (solicitacao.faturamento_documento_id == null) return;
  const atual = dadosDaFaturaParaPagamento(
    solicitacao.faturamento_documento_id,
    banco,
  );
  if (
    solicitacao.faturamento_documento_versao !== atual.documento.versao ||
    solicitacao.valor_centavos !== atual.valor ||
    solicitacao.vencimento !== atual.vencimento ||
    solicitacao.fatura_uc !== atual.uc ||
    solicitacao.fatura_competencia !== atual.competencia
  )
    falhar(
      "A fatura mudou após o cadastro do pagamento. Atualize-a e confira novamente antes de prosseguir.",
      409,
    );
}

export function cadastrarFaturaParaPagamentoNoBanco(
  documentoId,
  administrador,
  banco = obterBanco(),
) {
  if (!Number.isSafeInteger(administrador?.id) || administrador.id <= 0)
    falhar("Use uma conta nominal da equipe para cadastrar a fatura.", 403);
  const { documento, vencimento, valor, uc, competencia, descricao } =
    dadosDaFaturaParaPagamento(documentoId, banco);
  const existente = banco
    .prepare(
      `SELECT * FROM financeiro_solicitacoes_pagamento
         WHERE faturamento_documento_id=?`,
    )
    .get(documento.id);
  if (existente) {
    try {
      conferirSnapshotDaFatura(existente, banco);
      return { ...existente, existente: true, atualizada: false };
    } catch (erro) {
      if (erro.status !== 409) throw erro;
    }
    if (["paga", "cancelada"].includes(existente.status))
      falhar("Pagamento encerrado não pode ser atualizado.", 409);
    banco
      .prepare(
        `UPDATE financeiro_solicitacoes_pagamento
         SET descricao=?,vencimento=?,valor_centavos=?,faturamento_documento_versao=?,
             fatura_uc=?,fatura_competencia=?,status='rascunho',aprovado_por=NULL,
             versao=versao+1,atualizado_em=CURRENT_TIMESTAMP
         WHERE id=?`,
      )
      .run(
        descricao,
        vencimento,
        valor,
        documento.versao,
        uc,
        competencia,
        existente.id,
      );
    banco
      .prepare(
        `INSERT INTO financeiro_auditoria_pagamentos
          (solicitacao_id,ator_id,ator_nome,acao,estado_anterior,estado_novo)
         VALUES(?,?,?,?,?,'rascunho')`,
      )
      .run(
        existente.id,
        administrador.id,
        administrador.nome,
        `Fatura atualizada: valor ${existente.valor_centavos}→${valor} centavos, vencimento ${existente.vencimento}→${vencimento}, versão ${existente.faturamento_documento_versao}→${documento.versao}`,
        existente.status,
      );
    return {
      id: existente.id,
      status: "rascunho",
      valor_centavos: valor,
      vencimento,
      existente: true,
      atualizada: true,
    };
  }

  const resultado = banco
    .prepare(
      `INSERT INTO financeiro_solicitacoes_pagamento
          (origem,descricao,favorecido,forma_pagamento,vencimento,valor_centavos,
           criado_por,faturamento_documento_id,faturamento_documento_versao,
           fatura_uc,fatura_competencia)
         VALUES('energia',?,'Distribuidora de energia','boleto',?,?,?,?,?,?,?)`,
    )
    .run(
      descricao,
      vencimento,
      valor,
      administrador.id,
      documento.id,
      documento.versao,
      uc,
      competencia,
    );
  const id = Number(resultado.lastInsertRowid);
  banco
    .prepare(
      `INSERT INTO financeiro_auditoria_pagamentos
          (solicitacao_id,ator_id,ator_nome,acao,estado_novo)
         VALUES(?,?,?,'Fatura cadastrada para pagamento','rascunho')`,
    )
    .run(id, administrador.id, administrador.nome);
  return {
    id,
    status: "rascunho",
    valor_centavos: valor,
    vencimento,
    existente: false,
  };
}

export function cadastrarFaturaParaPagamento(
  documentoId,
  administrador,
  banco = obterBanco(),
) {
  return transacao(banco, () => {
    return cadastrarFaturaParaPagamentoNoBanco(
      documentoId,
      administrador,
      banco,
    );
  });
}

export function enviarParaAprovacao(id, administrador, banco = obterBanco()) {
  return transacao(banco, () => {
    const atual = banco
      .prepare("SELECT * FROM financeiro_solicitacoes_pagamento WHERE id=?")
      .get(id);
    if (!atual) falhar("Solicitação não encontrada.", 404);
    if (atual.status !== "rascunho")
      falhar("Somente um rascunho pode ser enviado para aprovação.", 409);
    conferirSnapshotDaFatura(atual, banco);
    banco
      .prepare(
        "UPDATE financeiro_solicitacoes_pagamento SET status='aguardando_aprovacao',versao=versao+1,atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(id);
    banco
      .prepare(
        `INSERT INTO financeiro_auditoria_pagamentos
      (solicitacao_id,ator_id,ator_nome,acao,estado_anterior,estado_novo) VALUES(?,?,?,'Enviada para aprovação','rascunho','aguardando_aprovacao')`,
      )
      .run(id, administrador.id, administrador.nome);
    return { id, status: "aguardando_aprovacao" };
  });
}

export async function aprovarSolicitacao(
  id,
  administrador,
  senha,
  banco = obterBanco(),
) {
  if (!temPapelCritico(administrador?.id, "proprietario"))
    falhar(
      "Somente Proprietário 1 ou Proprietário 2 pode aprovar pagamentos.",
      403,
    );
  await conferirCredencialConfirmacao(administrador, senha);
  return transacao(banco, () => {
    const atual = banco
      .prepare("SELECT * FROM financeiro_solicitacoes_pagamento WHERE id=?")
      .get(id);
    if (!atual) falhar("Solicitação não encontrada.", 404);
    if (atual.status !== "aguardando_aprovacao")
      falhar("O pagamento não está aguardando aprovação.", 409);
    conferirSnapshotDaFatura(atual, banco);
    banco
      .prepare(
        "UPDATE financeiro_solicitacoes_pagamento SET status='aprovada',aprovado_por=?,versao=versao+1,atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(administrador.id, id);
    banco
      .prepare(
        `INSERT INTO financeiro_auditoria_pagamentos
      (solicitacao_id,ator_id,ator_nome,acao,estado_anterior,estado_novo) VALUES(?,?,?,'Pagamento aprovado com senha financeira','aguardando_aprovacao','aprovada')`,
      )
      .run(id, administrador.id, administrador.nome);
    return { id, status: "aprovada" };
  });
}

export async function baixarPagamentoExterno(
  id,
  campos,
  administrador,
  banco = obterBanco(),
) {
  if (!temPapelCritico(administrador?.id, "proprietario"))
    falhar(
      "Somente Proprietário 1 ou Proprietário 2 pode dar baixa em pagamentos.",
      403,
    );
  await conferirCredencialConfirmacao(administrador, campos?.senha);
  const pagoEm = dataIso(campos?.pago_em);
  const referencia = texto(
    campos?.referencia_pagamento,
    "a referência do pagamento",
    120,
    false,
  );
  return transacao(banco, () => {
    const atual = banco
      .prepare("SELECT * FROM financeiro_solicitacoes_pagamento WHERE id=?")
      .get(id);
    if (!atual) falhar("Solicitação não encontrada.", 404);
    if (atual.status !== "aprovada")
      falhar("Somente um pagamento aprovado pode receber baixa.", 409);
    conferirSnapshotDaFatura(atual, banco);
    banco
      .prepare(
        `UPDATE financeiro_solicitacoes_pagamento
         SET status='paga',pago_por=?,pago_em=?,referencia_pagamento=?,
             versao=versao+1,atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
      )
      .run(administrador.id, pagoEm, referencia || null, id);
    banco
      .prepare(
        `INSERT INTO financeiro_auditoria_pagamentos
         (solicitacao_id,ator_id,ator_nome,acao,estado_anterior,estado_novo)
         VALUES(?,?,?,'Baixa manual de pagamento externo','aprovada','paga')`,
      )
      .run(id, administrador.id, administrador.nome);
    return {
      id,
      status: "paga",
      forma_pagamento: atual.forma_pagamento,
      pago_em: pagoEm,
    };
  });
}
