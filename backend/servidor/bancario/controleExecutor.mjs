import { obterBanco } from "../bancoDeDados.mjs";

export function estadoDoExecutor() {
  const banco = obterBanco();
  const controle = banco
    .prepare("SELECT * FROM bancario_controle_executor WHERE id=1")
    .get();
  const contagens = Object.fromEntries(
    banco
      .prepare(
        `SELECT estado,COUNT(*) AS quantidade
         FROM bancario_intencoes GROUP BY estado`,
      )
      .all()
      .map((item) => [item.estado, item.quantidade]),
  );
  return {
    pausado: Boolean(controle.pausado),
    alterado_por_nome: controle.alterado_por_nome,
    alterado_em: controle.alterado_em,
    modo_configurado: String(
      process.env.BANCARIO_EXECUTOR_MODO ?? "desligado",
    ).toLowerCase(),
    ambiente: String(
      process.env.SICOOB_AMBIENTE ?? "homologacao",
    ).toLowerCase(),
    fila: contagens,
  };
}

export function alterarEstadoDoExecutor(pausado, administrador) {
  if (typeof pausado !== "boolean") {
    const erro = new Error("Informe se o executor deve ficar pausado.");
    erro.status = 400;
    throw erro;
  }
  const modo = String(process.env.BANCARIO_EXECUTOR_MODO ?? "desligado")
    .trim()
    .toLowerCase();
  const ambiente = String(process.env.SICOOB_AMBIENTE ?? "homologacao")
    .trim()
    .toLowerCase();
  if (!pausado && modo === "desligado") {
    const erro = new Error(
      "Ative um modo de executor no servidor antes de retomar a fila.",
    );
    erro.status = 409;
    throw erro;
  }
  if (!pausado && modo === "simulado" && ambiente !== "homologacao") {
    const erro = new Error("O simulador só pode ser retomado em homologação.");
    erro.status = 409;
    throw erro;
  }
  const banco = obterBanco();
  banco.exec("BEGIN IMMEDIATE");
  try {
    banco
      .prepare(
        `UPDATE bancario_controle_executor
         SET pausado=?,alterado_por=?,alterado_por_nome=?,alterado_em=CURRENT_TIMESTAMP
         WHERE id=1`,
      )
      .run(pausado ? 1 : 0, administrador.id, administrador.nome);
    banco
      .prepare(
        `INSERT INTO bancario_auditoria_executor(ator_id,ator_nome,acao)
         VALUES(?,?,?)`,
      )
      .run(
        administrador.id,
        administrador.nome,
        pausado ? "pausado" : "retomado",
      );
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
  return estadoDoExecutor();
}
