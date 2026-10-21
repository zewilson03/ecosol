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
  const semInjecao = memoria.regra.endsWith("-sem-injecao");
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
          ou ajuste GDII. Do total Equatorial são abatidos os juros e a multa
          informados.
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
          <dd>
            {memoria.consumo_bruto !== undefined
              ? `R$ ${decimalBr(memoria.consumo_bruto)}`
              : formatarDinheiro(memoria.consumo_centavos)}
          </dd>
        </div>
        <div>
          <dt>+ Total Equatorial</dt>
          <dd>{formatarDinheiro(memoria.equatorial_centavos)}</dd>
        </div>
        {Boolean(memoria.juros_centavos) && (
          <div>
            <dt>− Juros Equatorial</dt>
            <dd>{formatarDinheiro(memoria.juros_centavos!)}</dd>
          </div>
        )}
        {Boolean(memoria.multa_centavos) && (
          <div>
            <dt>− Multa Equatorial</dt>
            <dd>{formatarDinheiro(memoria.multa_centavos!)}</dd>
          </div>
        )}
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
      {Boolean(memoria.juros_centavos || memoria.multa_centavos) && (
        <p>
          Juros e multa já incluídos no total Equatorial são subtraídos, antes
          do ajuste GDII.
        </p>
      )}
      <p>
        {entrada.modalidade} · Vencimento Ecosol:{" "}
        {memoria.vencimento_ecosol.split("-").reverse().join("/")} · Fonte da
        tarifa:{" "}
        {semInjecao ? "não aplicável" : `fatura #${memoria.fonte.documento_id}`}
      </p>
      <small>
        {semInjecao
          ? memoria.juros_centavos || memoria.multa_centavos
            ? "Cálculo: 0 kWh injetado; total Equatorial menos juros e multa, sem desconto ou ajuste GDII."
            : "Cálculo: 0 kWh injetado; total Ecosol igual ao total Equatorial, sem desconto ou ajuste."
          : memoria.precisao?.etapa === "total"
            ? `Cálculo decimal sem arredondamento das parcelas: energia × tarifa × (1 − desconto/100) + total Equatorial − juros − multa − ajuste GDII. Somente o total da cobrança é arredondado a centavos (${memoria.precisao.arredondamento === "ROUND_HALF_EVEN" ? "HALF_EVEN" : "HALF_UP"}).`
            : entrada.modalidade === "GDII"
              ? "Cálculo: energia injetada × tarifa completa × (1 − desconto/100), arredondado a centavos; depois soma o total Equatorial e subtrai o ajuste GDII."
              : "Cálculo: energia injetada × tarifa completa × (1 − desconto/100), arredondado a centavos; depois soma o total Equatorial."}
      </small>
    </div>
  );
}
