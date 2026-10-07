// Regra conservadora para o padrão de nomes das contas Equatorial recebidas.
// Um nome compatível é apenas candidato à triagem, nunca aprovação financeira.
export function candidatoFaturaPeloNome(nome) {
  if (typeof nome !== "string") return false;
  return /^20\d{2}(0[1-9]|1[0-2])\d{7}\.pdf$/i.test(nome.trim());
}
