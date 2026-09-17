export function apenasDigitos(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

export function cpfTemFormato(valor) {
  return /^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(String(valor).trim());
}

export function cpfValido(valor) {
  const cpf = apenasDigitos(valor);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

  for (let posicao = 9; posicao <= 10; posicao += 1) {
    let soma = 0;
    for (let indice = 0; indice < posicao; indice += 1) {
      soma += Number(cpf[indice]) * (posicao + 1 - indice);
    }
    if (((soma * 10) % 11) % 10 !== Number(cpf[posicao])) return false;
  }

  return true;
}

export function cpfValidoParaCadastro(valor) {
  return cpfTemFormato(valor) && cpfValido(valor);
}
