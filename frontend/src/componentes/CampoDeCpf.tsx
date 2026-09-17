import { useState } from "react";
import { cpfTemFormato, cpfValidoParaCadastro } from "../validacaoDeCpf";

function gerarCpfParaTeste() {
  let digitos: number[];

  do {
    digitos = Array.from(
      crypto.getRandomValues(new Uint8Array(9)),
      (numero) => numero % 10,
    );
  } while (digitos.every((numero) => numero === digitos[0]));

  for (let posicao = 9; posicao <= 10; posicao += 1) {
    const soma = digitos.reduce(
      (total, digito, indice) => total + digito * (posicao + 1 - indice),
      0,
    );
    digitos.push(((soma * 10) % 11) % 10);
  }

  const cpf = digitos.join("");
  return (
    cpf.slice(0, 3) +
    "." +
    cpf.slice(3, 6) +
    "." +
    cpf.slice(6, 9) +
    "-" +
    cpf.slice(9)
  );
}

export default function CampoDeCpf({
  id = "cpf",
  gerarTeste = false,
}: {
  id?: string;
  gerarTeste?: boolean;
}) {
  const [cpf, setCpf] = useState("");
  const [foiAlterado, definirFoiAlterado] = useState(false);
  const valido = cpfValidoParaCadastro(cpf);

  let mensagem = "";
  if (foiAlterado && cpf) {
    if (!cpfTemFormato(cpf)) {
      mensagem = "Use 11 dígitos ou o formato 000.000.000-00.";
    } else if (valido) {
      mensagem = "Formato e dígitos do CPF válidos.";
    } else {
      mensagem = "Os dígitos verificadores do CPF não conferem.";
    }
  }

  return (
    <div className="cpf-field">
      <label htmlFor={id}>
        CPF
        <input
          id={id}
          name="cpf"
          inputMode="numeric"
          value={cpf}
          onChange={(evento) => {
            setCpf(evento.target.value);
            definirFoiAlterado(true);
          }}
          onBlur={() => definirFoiAlterado(true)}
          maxLength={14}
          pattern="(?:[0-9]{11}|[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2})"
          placeholder="000.000.000-00"
          aria-describedby={id + "-message"}
          aria-invalid={foiAlterado && !!cpf && !valido}
          required
        />
      </label>
      {mensagem && (
        <small
          id={id + "-message"}
          className={valido ? "cpf-valid" : "cpf-invalid"}
        >
          {mensagem}
        </small>
      )}
      {gerarTeste && (
        <button
          className="text-link"
          type="button"
          onClick={() => {
            setCpf(gerarCpfParaTeste());
            definirFoiAlterado(true);
          }}
        >
          Gerar CPF de teste
        </button>
      )}
    </div>
  );
}
