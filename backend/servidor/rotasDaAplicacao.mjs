import express from "express";
import nodemailer from "nodemailer";
import {
  exigirNivel,
  identificarAdministrador,
} from "./permissoesDaEquipe.mjs";
import { obterBanco } from "./bancoDeDados.mjs";
import {
  criarToken,
  encerrarSessao,
  hashPrecisaAtualizar,
  iniciarSessao,
  limitarTentativas,
  protegerSenha,
  resumoCriptografico,
  senhaConfere,
  sessaoAtual,
} from "./autenticacao.mjs";
import {
  apenasDigitos,
  cpfValido,
  cpfValidoParaCadastro,
} from "./validacaoDeCpf.mjs";

export const rotas = express.Router();
const formatoDeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emDesenvolvimento = process.env.NODE_ENV !== "production";
let transporteDeEmail;

function obterTransporteDeEmail() {
  if (transporteDeEmail) return transporteDeEmail;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD) {
    throw new Error("SMTP não configurado");
  }

  transporteDeEmail = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  return transporteDeEmail;
}

function campo(requisicao, nome, tamanho = 1500) {
  return String(requisicao.body?.[nome] ?? "")
    .trim()
    .slice(0, tamanho);
}

function campoSenha(requisicao, nome) {
  return String(requisicao.body?.[nome] ?? "");
}

function emailValido(email) {
  return formatoDeEmail.test(email);
}

function senhaValida(senha) {
  return senha.length >= 8 && senha.length <= 128;
}

function cpfJaExiste(cpf) {
  return Boolean(
    obterBanco()
      .prepare(
        "SELECT 1 FROM customers WHERE cpf = ? UNION ALL SELECT 1 FROM staff_users WHERE cpf = ? LIMIT 1",
      )
      .get(cpf, cpf),
  );
}

function redirecionar(resposta, destino) {
  if (resposta.req.headers.accept?.includes("application/json")) {
    const status =
      new URL(destino, "http://localhost").searchParams.get("status") ?? "";
    const sucesso =
      status.endsWith("-criado") || status === "enviado" || !status;
    return resposta.status(sucesso ? 200 : 400).json({
      sucesso,
      erro: sucesso
        ? undefined
        : (mensagensDeCadastro[status] ?? "Confira os campos informados."),
    });
  }
  resposta.redirect(303, destino);
}

const mensagensDeCadastro = {
  "cliente-cpf-invalido": "CPF inválido. Confira os dígitos verificadores.",
  "admin-cpf-invalido": "CPF inválido. Confira os dígitos verificadores.",
  "cliente-existente": "Este CPF já está cadastrado.",
  "admin-cpf-existente": "Este CPF já está cadastrado.",
  "admin-existente": "Este email já está cadastrado.",
  "cliente-erro": "Confira nome, email e senha de 8 a 128 caracteres.",
  "admin-erro": "Confira nome, email, nível e senha de 8 a 128 caracteres.",
};
function exigirEquipe(requisicao, resposta, proximo) {
  if (!identificarAdministrador(requisicao)) {
    return resposta.status(403).json({ erro: "Acesso restrito à equipe." });
  }
  proximo();
}

rotas.get("/api/sessao", (requisicao, resposta) => {
  const sessao = sessaoAtual(requisicao);
  if (!sessao) return resposta.json({ perfil: null });

  if (sessao.role === "customer") {
    const cliente = obterBanco()
      .prepare("SELECT name, email, cpf FROM customers WHERE id = ?")
      .get(sessao.customer_id);
    return resposta.json({ perfil: cliente ? "cliente" : null, cliente });
  }

  const administrador = identificarAdministrador(requisicao);
  return resposta.json(
    administrador ? { perfil: "equipe", administrador } : { perfil: null },
  );
});

rotas.get("/api/equipe/dados", exigirEquipe, (_requisicao, resposta) => {
  const banco = obterBanco();
  const secao = String(_requisicao.query.secao ?? "");
  const todasAsSecoes = !["clientes", "contatos", "acessos"].includes(secao);
  const dados = {};

  if (todasAsSecoes || secao === "contatos") {
    dados.contatos = banco
      .prepare("SELECT * FROM leads ORDER BY id DESC")
      .all();
  }
  if (todasAsSecoes || secao === "clientes") {
    dados.clientes = banco
      .prepare(
        "SELECT id, name, cpf, email, (password_hash IS NOT NULL) AS ready FROM customers ORDER BY id DESC",
      )
      .all();
  }
  if (todasAsSecoes || secao === "acessos") {
    dados.administradores =
      identificarAdministrador(_requisicao)?.nivel === 3
        ? banco
            .prepare(
              "SELECT id, name, cpf, email, access_level FROM staff_users ORDER BY id DESC",
            )
            .all()
        : [];
  }

  resposta.json(dados);
});

rotas.get("/api/dev/links", (_requisicao, resposta) => {
  if (!emDesenvolvimento) return resposta.sendStatus(404);
  resposta.json(
    obterBanco()
      .prepare(
        "SELECT recipient, subject, url, created_at FROM dev_mail ORDER BY id DESC LIMIT 20",
      )
      .all(),
  );
});

rotas.get("/api/acesso/validar", (requisicao, resposta) => {
  const token = String(requisicao.query.token ?? "");
  const valido =
    /^[a-f0-9]{64}$/.test(token) &&
    Boolean(
      obterBanco()
        .prepare(
          "SELECT id FROM auth_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
        )
        .get(resumoCriptografico(token), Date.now()),
    );
  resposta.json({ valido });
});

rotas.post("/api/contatos", (requisicao, resposta) => {
  const nome = campo(requisicao, "name", 120);
  const email = campo(requisicao, "email", 180).toLowerCase();
  const telefone = campo(requisicao, "phone", 30);
  const cidade = campo(requisicao, "city", 100);
  const mensagem = campo(requisicao, "message", 1500);

  if (
    !nome ||
    !emailValido(email) ||
    !telefone ||
    !cidade ||
    !mensagem ||
    campo(requisicao, "website")
  ) {
    return redirecionar(resposta, "/contato?status=erro");
  }

  obterBanco()
    .prepare(
      "INSERT INTO leads (name, email, phone, city, message) VALUES (?, ?, ?, ?, ?)",
    )
    .run(nome, email, telefone, cidade, mensagem);
  redirecionar(resposta, "/contato?status=enviado");
});

rotas.post("/api/clientes/cadastro", async (requisicao, resposta) => {
  if (!emDesenvolvimento) return resposta.sendStatus(404);

  const nome = campo(requisicao, "name", 120);
  const cpfInformado = campo(requisicao, "cpf", 14);
  const cpf = apenasDigitos(cpfInformado);
  const email = campo(requisicao, "email", 180).toLowerCase();
  const senha = campoSenha(requisicao, "password");
  const confirmacao = campoSenha(requisicao, "confirm");

  if (!cpfValidoParaCadastro(cpfInformado)) {
    return redirecionar(resposta, "/cadastro?status=cpf-invalido");
  }
  if (cpfJaExiste(cpf)) {
    return redirecionar(resposta, "/cadastro?status=cpf-existente");
  }
  if (
    !nome ||
    !emailValido(email) ||
    !senhaValida(senha) ||
    senha !== confirmacao
  ) {
    return redirecionar(resposta, "/cadastro?status=erro");
  }

  try {
    const hash = await protegerSenha(senha);
    obterBanco()
      .prepare(
        "INSERT INTO customers (name, cpf, email, password_hash) VALUES (?, ?, ?, ?)",
      )
      .run(nome, cpf, email, hash);
  } catch {
    return redirecionar(resposta, "/cadastro?status=cpf-existente");
  }

  redirecionar(resposta, "/entrar?status=cadastro-criado");
});

rotas.post("/api/clientes/login", async (requisicao, resposta) => {
  const cpf = apenasDigitos(campo(requisicao, "cpf", 14));
  const senha = campoSenha(requisicao, "password");
  const chave = `login:${resumoCriptografico(cpf)}`;

  if (!cpfValido(cpf) || limitarTentativas(chave)) {
    return redirecionar(resposta, "/entrar?status=erro");
  }

  const cliente = obterBanco()
    .prepare("SELECT id, password_hash FROM customers WHERE cpf = ?")
    .get(cpf);
  if (
    !cliente?.password_hash ||
    !(await senhaConfere(senha, cliente.password_hash))
  ) {
    return redirecionar(resposta, "/entrar?status=erro");
  }

  if (hashPrecisaAtualizar(cliente.password_hash)) {
    const hashAtualizado = await protegerSenha(senha);
    obterBanco()
      .prepare(
        "UPDATE customers SET password_hash = ? WHERE id = ? AND password_hash = ?",
      )
      .run(hashAtualizado, cliente.id, cliente.password_hash);
  }

  obterBanco().prepare("DELETE FROM login_attempts WHERE key = ?").run(chave);
  iniciarSessao(resposta, "customer", cliente.id);
  redirecionar(resposta, "/minha-area");
});

rotas.post("/api/acesso/solicitar", async (requisicao, resposta) => {
  const cpf = apenasDigitos(campo(requisicao, "cpf", 14));
  const email = campo(requisicao, "email", 180).toLowerCase();
  const finalidade =
    campo(requisicao, "purpose") === "reset" ? "reset" : "activate";
  const chave = `request:${resumoCriptografico(cpf + email)}`;

  if (!limitarTentativas(chave, 4) && cpfValido(cpf) && emailValido(email)) {
    const cliente = obterBanco()
      .prepare(
        "SELECT id, password_hash FROM customers WHERE cpf = ? AND lower(email) = ?",
      )
      .get(cpf, email);
    const podeEnviar =
      cliente &&
      ((finalidade === "activate" && !cliente.password_hash) ||
        (finalidade === "reset" && cliente.password_hash));

    if (podeEnviar) {
      const token = criarToken();
      obterBanco()
        .prepare(
          "INSERT INTO auth_tokens (customer_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          cliente.id,
          resumoCriptografico(token),
          finalidade,
          Date.now() + 30 * 60 * 1000,
        );

      const endereco = `${process.env.APP_URL ?? "http://localhost:3000"}/definir-senha?token=${token}`;
      const assunto =
        finalidade === "reset"
          ? "Recuperar acesso à Ecosol"
          : "Ativar acesso à Ecosol";
      if (emDesenvolvimento) {
        obterBanco()
          .prepare(
            "INSERT INTO dev_mail (recipient, subject, url) VALUES (?, ?, ?)",
          )
          .run(email, assunto, endereco);
      } else {
        if (!process.env.SMTP_FROM) throw new Error("SMTP não configurado");
        await obterTransporteDeEmail().sendMail({
          from: process.env.SMTP_FROM,
          to: email,
          subject: assunto,
          text: `Acesse o link para continuar: ${endereco}`,
        });
      }
    }
  }

  redirecionar(resposta, "/acesso?status=solicitado");
});

rotas.post("/api/acesso/definir-senha", async (requisicao, resposta) => {
  const token = campo(requisicao, "token", 64);
  const senha = campoSenha(requisicao, "password");
  const confirmacao = campoSenha(requisicao, "confirm");
  if (
    !/^[a-f0-9]{64}$/.test(token) ||
    !senhaValida(senha) ||
    senha !== confirmacao
  ) {
    return redirecionar(
      resposta,
      `/definir-senha?token=${encodeURIComponent(token)}&status=erro`,
    );
  }

  const registro = obterBanco()
    .prepare(
      "SELECT customer_id FROM auth_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
    )
    .get(resumoCriptografico(token), Date.now());
  if (!registro) return redirecionar(resposta, "/acesso?status=expirado");

  const hash = await protegerSenha(senha);
  const banco = obterBanco();
  banco
    .prepare("UPDATE customers SET password_hash = ? WHERE id = ?")
    .run(hash, registro.customer_id);
  banco
    .prepare(
      "UPDATE auth_tokens SET used_at = ? WHERE customer_id = ? AND used_at IS NULL",
    )
    .run(Date.now(), registro.customer_id);
  banco
    .prepare("DELETE FROM sessions WHERE customer_id = ?")
    .run(registro.customer_id);
  redirecionar(resposta, "/entrar?status=senha-definida");
});

rotas.post("/api/equipe/login", async (requisicao, resposta) => {
  const email = campo(requisicao, "email", 180).toLowerCase();
  const senha = campoSenha(requisicao, "password");
  const chave = `staff:${resumoCriptografico(email)}`;
  if (limitarTentativas(chave, 6))
    return redirecionar(resposta, "/equipe?status=erro");

  const administrador = emailValido(email)
    ? obterBanco()
        .prepare(
          "SELECT id, password_hash FROM staff_users WHERE lower(email) = ?",
        )
        .get(email)
    : null;

  if (
    !administrador ||
    !(await senhaConfere(senha, administrador.password_hash))
  ) {
    return redirecionar(resposta, "/equipe?status=erro");
  }
  if (hashPrecisaAtualizar(administrador.password_hash)) {
    const hashAtualizado = await protegerSenha(senha);
    obterBanco()
      .prepare(
        "UPDATE staff_users SET password_hash = ? WHERE id = ? AND password_hash = ?",
      )
      .run(hashAtualizado, administrador.id, administrador.password_hash);
  }
  obterBanco().prepare("DELETE FROM login_attempts WHERE key = ?").run(chave);
  iniciarSessao(resposta, "staff", administrador.id);
  redirecionar(resposta, "/equipe");
});

rotas.post("/api/equipe/entrada-inicial", (requisicao, resposta) => {
  const senha = campoSenha(requisicao, "password");
  const configurada = process.env.ADMIN_PASSWORD;
  if (
    obterBanco().prepare("SELECT 1 FROM staff_users LIMIT 1").get() ||
    limitarTentativas("staff-bootstrap", 6) ||
    !configurada ||
    configurada === "troque-esta-senha-antes-de-publicar" ||
    senha !== configurada
  ) {
    return redirecionar(resposta, "/equipe?status=bootstrap-erro");
  }
  obterBanco()
    .prepare("DELETE FROM login_attempts WHERE key = ?")
    .run("staff-bootstrap");
  iniciarSessao(resposta, "staff");
  redirecionar(resposta, "/equipe");
});

rotas.post(
  "/api/equipe/contatos/status",
  exigirEquipe,
  (requisicao, resposta) => {
    const id = Number(campo(requisicao, "id", 10));
    const status = campo(requisicao, "status", 20);
    if (
      Number.isSafeInteger(id) &&
      id > 0 &&
      ["Novo", "Em contato", "Concluído"].includes(status)
    ) {
      obterBanco()
        .prepare("UPDATE leads SET status = ? WHERE id = ?")
        .run(status, id);
    }
    redirecionar(resposta, "/equipe");
  },
);

rotas.post(
  "/api/equipe/clientes",
  exigirEquipe,
  async (requisicao, resposta) => {
    const nome = campo(requisicao, "name", 120);
    const cpfInformado = campo(requisicao, "cpf", 14);
    const cpf = apenasDigitos(cpfInformado);
    const email = campo(requisicao, "email", 180).toLowerCase();
    const senha = campoSenha(requisicao, "test_password");
    const retorno = "/equipe/cadastros?status=";

    if (!cpfValidoParaCadastro(cpfInformado))
      return redirecionar(resposta, retorno + "cliente-cpf-invalido");
    if (cpfJaExiste(cpf))
      return redirecionar(resposta, retorno + "cliente-existente");
    if (
      !nome ||
      !emailValido(email) ||
      (senha && (!emDesenvolvimento || !senhaValida(senha)))
    ) {
      return redirecionar(resposta, retorno + "cliente-erro");
    }
    try {
      const hash = senha ? await protegerSenha(senha) : null;
      obterBanco()
        .prepare(
          "INSERT INTO customers (name, cpf, email, password_hash) VALUES (?, ?, ?, ?)",
        )
        .run(nome, cpf, email, hash);
    } catch {
      return redirecionar(resposta, retorno + "cliente-existente");
    }
    redirecionar(resposta, retorno + "cliente-criado");
  },
);

rotas.post(
  "/api/equipe/administradores",
  exigirNivel(3),
  async (requisicao, resposta) => {
    const nome = campo(requisicao, "name", 120);
    const cpfInformado = campo(requisicao, "cpf", 14);
    const cpf = cpfInformado ? apenasDigitos(cpfInformado) : null;
    const email = campo(requisicao, "email", 180).toLowerCase();
    const senha = campoSenha(requisicao, "password");
    const retorno = "/equipe/cadastros?status=";
    const nivel = Number(campo(requisicao, "nivel") || 1);

    if (cpfInformado && !cpfValidoParaCadastro(cpfInformado))
      return redirecionar(resposta, retorno + "admin-cpf-invalido");
    if (cpf && cpfJaExiste(cpf))
      return redirecionar(resposta, retorno + "admin-cpf-existente");
    if (
      !nome ||
      !emailValido(email) ||
      !senhaValida(senha) ||
      ![1, 2, 3].includes(nivel) ||
      (requisicao.administrador.id === null && nivel !== 3)
    ) {
      return redirecionar(resposta, retorno + "admin-erro");
    }
    try {
      const hash = await protegerSenha(senha);
      const banco = obterBanco();
      if (
        requisicao.administrador.id === null &&
        banco.prepare("SELECT 1 FROM staff_users LIMIT 1").get()
      ) {
        return redirecionar(resposta, retorno + "admin-erro");
      }
      if (
        banco
          .prepare("SELECT 1 FROM staff_users WHERE lower(email) = ?")
          .get(email)
      ) {
        return redirecionar(resposta, retorno + "admin-existente");
      }
      const criado = banco
        .prepare(
          "INSERT INTO staff_users (name, cpf, email, password_hash, access_level) VALUES (?, ?, ?, ?, ?)",
        )
        .run(nome, cpf, email, hash, nivel);
      if (requisicao.administrador.id === null) {
        banco
          .prepare(
            "DELETE FROM sessions WHERE role = 'staff' AND staff_id IS NULL",
          )
          .run();
        iniciarSessao(resposta, "staff", Number(criado.lastInsertRowid));
      }
    } catch {
      return redirecionar(resposta, retorno + "admin-existente");
    }
    redirecionar(resposta, retorno + "admin-criado");
  },
);

rotas.post("/api/sair", (requisicao, resposta) => {
  encerrarSessao(requisicao, resposta);
  redirecionar(resposta, "/");
});
