export function normalizarIdentificadorGeracao(valor) {
  return String(valor ?? "")
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "");
}

export function identificarUsinaPorGeracao(banco, valor) {
  const numero = normalizarIdentificadorGeracao(valor);
  if (!numero)
    return { numero: null, situacao: "ausente", usina: null, candidatas: [] };
  const candidatas = banco
    .prepare(
      `SELECT DISTINCT s.id,s.nome
       FROM usinas_identificadores_geracao i
       JOIN usinas s ON s.id=i.usina_id
       WHERE i.numero=? ORDER BY s.nome,s.id`,
    )
    .all(numero);
  return {
    numero,
    situacao:
      candidatas.length === 1
        ? "identificada"
        : candidatas.length > 1
          ? "ambigua"
          : "sem_correspondencia",
    usina: candidatas.length === 1 ? candidatas[0] : null,
    candidatas,
  };
}
