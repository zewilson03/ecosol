import PreparacaoFaturas from "./PreparacaoFaturas";
import { CabecalhoDoModulo } from "./ComponentesDoPainel";

export default function Faturas() {
  return (
    <>
      <CabecalhoDoModulo
        titulo="Faturas e cobranças"
        descricao="Receba o PDF, confira os dados, calcule e aprove a cobrança em um único fluxo."
      />
      <PreparacaoFaturas />
    </>
  );
}
