export function apenasDigitos(valor: string) {
  return valor.replace(/\D/g, "");
}

export function cpfTemFormato(valor: string) {
  const formatoSemPontuacao = /^\d{11}$/;
  const formatoComPontuacao = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;
  return (
    formatoSemPontuacao.test(valor.trim()) ||
    formatoComPontuacao.test(valor.trim())
  );
}

export function cpfValido(valor: string) {
  const cpf = apenasDigitos(valor);

  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  // Os dois últimos dígitos são calculados a partir dos anteriores.
  for (let posicao = 9; posicao <= 10; posicao += 1) {
    let soma = 0;

    for (let indice = 0; indice < posicao; indice += 1) {
      soma += Number(cpf[indice]) * (posicao + 1 - indice);
    }

    const digitoEsperado = ((soma * 10) % 11) % 10;
    if (digitoEsperado !== Number(cpf[posicao])) return false;
  }

  return true;
}

export function cpfValidoParaCadastro(valor: string) {
  return cpfTemFormato(valor) && cpfValido(valor);
}
