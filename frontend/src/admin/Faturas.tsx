import PreparacaoFaturas from "./PreparacaoFaturas";
import { CabecalhoDoModulo } from "./ComponentesDoPainel";
import { Link } from "react-router-dom";

export default function Faturas() {
  return (
    <>
      <CabecalhoDoModulo
        titulo="Faturas e cobranças"
        descricao="Receba o PDF, confira os dados, calcule e aprove a cobrança em um único fluxo."
      >
        <Link className="admin-botao secundario" to="/admin/calculos">Ver cálculos</Link>
      </CabecalhoDoModulo>
      <PreparacaoFaturas />
    </>
  );
}
