const digitos = (valor) => String(valor ?? "").replace(/\D/g, "");
const normalizar = (valor) =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

function assinatura(endereco) {
  return JSON.stringify([
    normalizar(endereco.logradouro),
    normalizar(endereco.bairro),
    digitos(endereco.cep),
    normalizar(endereco.cidade),
    normalizar(endereco.uf),
  ]);
}

export function registrarEnderecoDaFatura(banco, documentoId, extracao) {
  const endereco = extracao.endereco_fatura;
  if (!endereco) return null;
  const uc = digitos(extracao.dados?.uc).replace(/^0+(?=\d)/, "");
  const documentoTitular = digitos(endereco.documento_titular);
  const unidadeAtual = uc
    ? banco
        .prepare(
          `SELECT u.id,u.cliente_id,c.cpf AS documento_cliente
           FROM faturamento_unidades u
           LEFT JOIN customers c ON c.id=u.cliente_id
           WHERE u.uc=?`,
        )
        .get(uc)
    : null;
  const unidade =
    unidadeAtual ??
    (uc
      ? banco
          .prepare(
            `SELECT u.id,u.cliente_id,c.cpf AS documento_cliente
           FROM faturamento_unidades_aliases a
           JOIN faturamento_unidades u ON u.id=a.unidade_id
           LEFT JOIN customers c ON c.id=u.cliente_id
           WHERE a.uc=?`,
          )
          .get(uc)
      : null);
  let situacao = "pendente_cadastro";
  let unidadeId = null;
  let clienteId = null;
  if (unidade?.cliente_id) {
    unidadeId = unidade.id;
    if (digitos(unidade.documento_cliente) !== documentoTitular) {
      situacao = "documento_divergente";
    } else {
      clienteId = unidade.cliente_id;
      const anterior = banco
        .prepare(
          `SELECT endereco_json FROM faturamento_enderecos_faturas
           WHERE unidade_id=? AND cliente_id=? AND situacao='vinculado'
             AND documento_id<>?
           ORDER BY documento_id DESC LIMIT 1`,
        )
        .get(unidadeId, clienteId, documentoId);
      situacao =
        anterior &&
        assinatura(JSON.parse(anterior.endereco_json)) !== assinatura(endereco)
          ? "endereco_divergente"
          : "vinculado";
    }
  }
  banco
    .prepare(
      `INSERT INTO faturamento_enderecos_faturas
       (documento_id,uc,documento_titular,endereco_json,unidade_id,cliente_id,situacao)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(documento_id) DO UPDATE SET
         uc=excluded.uc,documento_titular=excluded.documento_titular,
         endereco_json=excluded.endereco_json,unidade_id=excluded.unidade_id,
         cliente_id=excluded.cliente_id,situacao=excluded.situacao,
         atualizado_em=CURRENT_TIMESTAMP`,
    )
    .run(
      documentoId,
      uc,
      documentoTitular,
      JSON.stringify(endereco),
      unidadeId,
      clienteId,
      situacao,
    );
  return { situacao, unidade_id: unidadeId, cliente_id: clienteId };
}

export function vincularEnderecosPendentesDaUc(banco, uc) {
  const atual = digitos(uc).replace(/^0+(?=\d)/, "");
  const unidade = banco
    .prepare("SELECT id FROM faturamento_unidades WHERE uc=?")
    .get(atual);
  const identificadores = unidade
    ? [
        atual,
        ...banco
          .prepare(
            "SELECT uc FROM faturamento_unidades_aliases WHERE unidade_id=?",
          )
          .all(unidade.id)
          .map((item) => item.uc),
      ]
    : [atual];
  const pendentes = banco
    .prepare(
      `SELECT documento_id,uc,endereco_json FROM faturamento_enderecos_faturas
       WHERE uc IN (${identificadores.map(() => "?").join(",")})
         AND situacao='pendente_cadastro' ORDER BY documento_id`,
    )
    .all(...identificadores);
  for (const item of pendentes)
    registrarEnderecoDaFatura(banco, item.documento_id, {
      dados: { uc: item.uc },
      endereco_fatura: JSON.parse(item.endereco_json),
    });
  return pendentes.length;
}
