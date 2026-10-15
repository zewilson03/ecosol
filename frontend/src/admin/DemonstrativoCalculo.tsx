import { formatarDinheiro } from "./comunicacaoComServidor";
import type { Memoria } from "./tiposFaturamento";

export default function DemonstrativoCalculo({
  memoria,
  previa = false,
}: {
  memoria: Memoria;
  previa?: boolean;
}) {
  const entrada = memoria.entradas;
  const decimalBr = (valor: string) => valor.replace(".", ",");
  const semInjecao = memoria.regra === "ecosol-v1-sem-injecao";
  return (
    <div className="faturamento-demonstrativo">
      <h3>
        {previa
          ? "Prévia do cálculo — não salva"
          : "Demonstrativo interno — sem validade para pagamento"}
      </h3>
      {semInjecao && (
        <p>
          Sem injeção SCEE: não há cobrança de energia Ecosol, tarifa, desconto
          ou ajuste GDII. O total é somente o valor Equatorial.
        </p>
      )}
      <dl>
        <div>
          <dt>Energia injetada</dt>
          <dd>{decimalBr(entrada.injecao)} kWh</dd>
        </div>
        {!semInjecao && (
          <>
            <div>
              <dt>Unitário com tributos</dt>
              <dd>
                {entrada.unitario
                  ? `R$ ${decimalBr(entrada.unitario)}/kWh`
                  : "Não informado"}
              </dd>
            </div>
            <div>
              <dt>+ Bandeira</dt>
              <dd>
                {entrada.bandeira
                  ? `R$ ${decimalBr(entrada.bandeira)}/kWh`
                  : "Não informada"}
              </dd>
            </div>
            <div>
              <dt>
                {memoria.fonte.tarifa === "manual"
                  ? "Tarifa final informada"
                  : "= Tarifa completa"}
              </dt>
              <dd>R$ {decimalBr(memoria.tarifa_completa)}/kWh</dd>
            </div>
            <div>
              <dt>Desconto da UC</dt>
              <dd>{decimalBr(entrada.desconto)}%</dd>
            </div>
          </>
        )}
        <div>
          <dt>{semInjecao ? "Energia Ecosol" : "Consumo com desconto"}</dt>
          <dd>{formatarDinheiro(memoria.consumo_centavos)}</dd>
        </div>
        <div>
          <dt>+ Total Equatorial</dt>
          <dd>{formatarDinheiro(memoria.equatorial_centavos)}</dd>
        </div>
        {!semInjecao && entrada.modalidade === "GDII" && (
          <div>
            <dt>− Ajuste GDII</dt>
            <dd>{formatarDinheiro(memoria.ajuste_centavos)}</dd>
          </div>
        )}
        <div className="faturamento-total">
          <dt>Valor Ecosol</dt>
          <dd>{formatarDinheiro(memoria.total_centavos)}</dd>
        </div>
      </dl>
      <p>
        {entrada.modalidade} · Vencimento Ecosol:{" "}
        {memoria.vencimento_ecosol.split("-").reverse().join("/")} · Fonte da
        tarifa:{" "}
        {semInjecao ? "não aplicável" : `fatura #${memoria.fonte.documento_id}`}
      </p>
      <small>
        {semInjecao
          ? "Cálculo: 0 kWh injetado; total Ecosol igual ao total Equatorial, sem desconto ou ajuste."
          : entrada.modalidade === "GDII"
            ? "Cálculo: energia injetada × tarifa completa × (1 − desconto/100), arredondado a centavos; depois soma o total Equatorial e subtrai o ajuste GDII."
            : "Cálculo: energia injetada × tarifa completa × (1 − desconto/100), arredondado a centavos; depois soma o total Equatorial."}
      </small>
    </div>
  );
}
