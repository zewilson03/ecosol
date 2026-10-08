import { Router } from "express";
import { resumoCriptografico } from "./autenticacao.mjs";
import { obterBanco } from "./bancoDeDados.mjs";
import { registrarHistorico } from "./faturamento/registros.mjs";
import { exigirNivel } from "./permissoesDaEquipe.mjs";

export const rotasAdministrativas = Router();
const exigirAdministrador = exigirNivel(1);
rotasAdministrativas.use("/api/admin", (requisicao, resposta, proximo) => {
  // O retorno OAuth faz a própria validação de sessão e precisa tratar
  // sessões encerradas com um redirecionamento, não com uma resposta JSON.
  if (
    requisicao.method === "GET" &&
    requisicao.originalUrl.split("?", 1)[0] === "/api/admin/gmail/oauth/retorno"
  )
    return proximo();
  return exigirAdministrador(requisicao, resposta, proximo);
});

rotasAdministrativas.get("/api/admin/usinas", (_requisicao, resposta) => {
  resposta.json(
    obterBanco().prepare("SELECT * FROM usinas ORDER BY nome").all(),
  );
});

rotasAdministrativas.get("/api/admin/faturas", (_requisicao, resposta) => {
  resposta.json(
    obterBanco()
      .prepare(
        "SELECT f.*, COALESCE(c.name, f.cliente_nome, 'Cliente excluído') AS cliente FROM faturas f LEFT JOIN customers c ON c.id = f.cliente_id ORDER BY f.vencimento DESC",
      )
      .all(),
  );
});

rotasAdministrativas.delete(
  "/api/admin/clientes/:id",
  (requisicao, resposta) => {
    const id = Number(requisicao.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return resposta.status(400).json({ erro: "Cliente inválido." });
    }

    const banco = obterBanco();
    banco.exec("BEGIN IMMEDIATE");
    try {
      const cliente = banco
        .prepare("SELECT name, cpf FROM customers WHERE id = ?")
        .get(id);
      if (!cliente) {
        banco.exec("ROLLBACK");
        return resposta.status(404).json({ erro: "Cliente não encontrado." });
      }

      // A fatura permanece consultável com o nome registrado antes da exclusão.
      banco
        .prepare(
          "UPDATE faturas SET cliente_nome = ? WHERE cliente_id = ? AND cliente_nome IS NULL",
        )
        .run(cliente.name, id);
      banco.prepare("DELETE FROM sessions WHERE customer_id = ?").run(id);
      banco.prepare("DELETE FROM auth_tokens WHERE customer_id = ?").run(id);
      const unidadesVinculadas = banco
        .prepare("SELECT id,uc FROM faturamento_unidades WHERE cliente_id = ?")
        .all(id);
      banco
        .prepare(
          "UPDATE faturamento_unidades SET cliente_id = NULL, versao = versao + 1 WHERE cliente_id = ?",
        )
        .run(id);
      for (const unidade of unidadesVinculadas)
        registrarHistorico({
          responsavel: requisicao.administrador.nome,
          administradorId: requisicao.administrador.id,
          acao: "Desvinculação de UC por exclusão do cliente do portal",
          dados: { cliente_id: id, uc: unidade.uc },
          unidadeId: unidade.id,
        });
      banco
        .prepare("DELETE FROM login_attempts WHERE key = ?")
        .run(`login:${resumoCriptografico(cliente.cpf)}`);
      banco.prepare("DELETE FROM customers WHERE id = ?").run(id);
      banco.exec("COMMIT");
      resposta.json({ sucesso: true });
    } catch (erro) {
      banco.exec("ROLLBACK");
      throw erro;
    }
  },
);

rotasAdministrativas.patch(
  "/api/admin/administradores/:id/nivel",
  exigirNivel(3),
  (requisicao, resposta) => {
    const id = Number(requisicao.params.id);
    const nivel = Number(requisicao.body.nivel);
    if (!Number.isSafeInteger(id) || ![1, 2, 3].includes(nivel)) {
      return resposta.status(400).json({ erro: "Informe um nível de 1 a 3." });
    }
    if (id === requisicao.administrador.id) {
      return resposta.status(400).json({
        erro: "Use outro administrador avançado para alterar seu próprio nível.",
      });
    }
    const banco = obterBanco();
    const pessoa = banco
      .prepare("SELECT access_level FROM staff_users WHERE id = ?")
      .get(id);
    if (!pessoa)
      return resposta
        .status(404)
        .json({ erro: "Administrador não encontrado." });
    const avancados = banco
      .prepare(
        "SELECT COUNT(*) AS total FROM staff_users WHERE access_level = 3",
      )
      .get();
    if (pessoa.access_level === 3 && nivel !== 3 && avancados.total <= 1) {
      return resposta
        .status(400)
        .json({ erro: "Mantenha pelo menos um administrador avançado." });
    }
    banco
      .prepare("UPDATE staff_users SET access_level = ? WHERE id = ?")
      .run(nivel, id);
    resposta.json({ sucesso: true });
  },
);

rotasAdministrativas.delete(
  "/api/admin/administradores/:id",
  exigirNivel(3),
  (requisicao, resposta) => {
    const id = Number(requisicao.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return resposta.status(400).json({ erro: "Administrador inválido." });
    }
    if (id === requisicao.administrador.id) {
      return resposta
        .status(400)
        .json({ erro: "Você não pode excluir seu próprio acesso." });
    }

    const banco = obterBanco();
    banco.exec("BEGIN IMMEDIATE");
    try {
      const pessoa = banco
        .prepare("SELECT access_level FROM staff_users WHERE id = ?")
        .get(id);
      if (!pessoa) {
        banco.exec("ROLLBACK");
        return resposta
          .status(404)
          .json({ erro: "Administrador não encontrado." });
      }
      if (pessoa.access_level === 3) {
        const avancados = banco
          .prepare(
            "SELECT COUNT(*) AS total FROM staff_users WHERE access_level = 3",
          )
          .get();
        if (avancados.total <= 1) {
          banco.exec("ROLLBACK");
          return resposta.status(400).json({
            erro: "Mantenha pelo menos um administrador avançado.",
          });
        }
      }
      banco.prepare("DELETE FROM sessions WHERE staff_id = ?").run(id);
      banco.prepare("DELETE FROM staff_users WHERE id = ?").run(id);
      banco.exec("COMMIT");
      resposta.json({ sucesso: true });
    } catch (erro) {
      banco.exec("ROLLBACK");
      throw erro;
    }
  },
);

rotasAdministrativas.get(
  "/api/admin/financeiro",
  exigirNivel(2),
  (requisicao, resposta) => {
    const banco = obterBanco();
    const visao = String(requisicao.query.visao ?? "completa");
    const dados = {};

    if (visao !== "historico") {
      dados.contas = banco
        .prepare("SELECT * FROM contas_a_pagar ORDER BY vencimento, id DESC")
        .all();
    }
    if (visao !== "contas") {
      dados.historico = banco
        .prepare(
          "SELECT * FROM historico_financeiro ORDER BY id DESC LIMIT 100",
        )
        .all();
    }

    resposta.json(dados);
  },
);

function validarConta(campos) {
  const descricao = String(campos.descricao ?? "").trim();
  const favorecido = String(campos.favorecido ?? "").trim();
  const valor = String(campos.valor ?? "").replace(",", ".");
  const vencimento = String(campos.vencimento ?? "");
  const status = String(campos.status ?? "");
  if (
    !descricao ||
    descricao.length > 160 ||
    !favorecido ||
    favorecido.length > 120
  ) {
    throw new Error(
      "Informe descrição e favorecido dentro dos limites dos campos.",
    );
  }
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(valor)) {
    throw new Error("Informe um valor positivo com até duas casas decimais.");
  }
  const [inteiro, decimal = ""] = valor.split(".");
  const centavos = Number(inteiro) * 100 + Number(decimal.padEnd(2, "0"));
  const data = new Date(vencimento + "T12:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(vencimento) ||
    !Number.isFinite(data.getTime()) ||
    data.toISOString().slice(0, 10) !== vencimento
  ) {
    throw new Error("Informe uma data de vencimento válida.");
  }
  if (!["Pendente", "Pago"].includes(status))
    throw new Error("Status inválido.");
  return {
    descricao,
    favorecido,
    valor_centavos: centavos,
    vencimento,
    status,
  };
}

function salvarConta(requisicao, resposta) {
  let dados;
  try {
    dados = validarConta(requisicao.body);
  } catch (erro) {
    return resposta.status(400).json({ erro: erro.message });
  }
  const banco = obterBanco();
  const id = requisicao.params.id ? Number(requisicao.params.id) : null;
  if (id !== null && (!Number.isSafeInteger(id) || id <= 0)) {
    return resposta.status(400).json({ erro: "Conta inválida." });
  }
  // A conta e seu histórico são gravados juntos, ou nenhuma alteração é salva.
  banco.exec("BEGIN IMMEDIATE");
  try {
    const anterior = id
      ? banco.prepare("SELECT * FROM contas_a_pagar WHERE id = ?").get(id)
      : null;
    if (id && !anterior) {
      banco.exec("ROLLBACK");
      return resposta.status(404).json({ erro: "Conta não encontrada." });
    }
    if (anterior && Number(requisicao.body.versao) !== anterior.versao) {
      banco.exec("ROLLBACK");
      return resposta.status(409).json({
        erro: "Outra pessoa alterou esta conta. Atualize a lista antes de editar novamente.",
      });
    }
    const valores = [
      dados.descricao,
      dados.favorecido,
      dados.valor_centavos,
      dados.vencimento,
      dados.status,
    ];
    let contaId = id;
    if (id) {
      banco
        .prepare(
          "UPDATE contas_a_pagar SET descricao=?, favorecido=?, valor_centavos=?, vencimento=?, status=?, versao=versao+1 WHERE id=?",
        )
        .run(...valores, id);
    } else {
      contaId = Number(
        banco
          .prepare(
            "INSERT INTO contas_a_pagar (descricao, favorecido, valor_centavos, vencimento, status) VALUES (?, ?, ?, ?, ?)",
          )
          .run(...valores).lastInsertRowid,
      );
    }
    banco
      .prepare(
        "INSERT INTO historico_financeiro (conta_id, administrador_id, responsavel, acao, valor_anterior, valor_novo, dados_anteriores, dados_novos) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        contaId,
        requisicao.administrador.id,
        requisicao.administrador.nome,
        id ? "Edição" : "Criação",
        anterior?.valor_centavos ?? null,
        dados.valor_centavos,
        anterior ? JSON.stringify(anterior) : null,
        JSON.stringify(dados),
      );
    banco.exec("COMMIT");
    resposta.status(id ? 200 : 201).json({ sucesso: true });
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

rotasAdministrativas.post("/api/admin/financeiro", exigirNivel(3), salvarConta);
rotasAdministrativas.patch(
  "/api/admin/financeiro/:id",
  exigirNivel(3),
  salvarConta,
);
