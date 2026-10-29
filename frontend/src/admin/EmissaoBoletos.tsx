import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EstadoDaConsulta } from "./ComponentesDoPainel";
import {
  consultarServidor,
  formatarData,
  formatarDinheiro,
  usarConsulta,
} from "./comunicacaoComServidor";
import type { Documento } from "./tiposFaturamento";
import "./estilosEmissaoBoletos.css";

type Operacao = {
  id: string;
  tipo: string;
  origem_id: string;
  valor_centavos: number;
  vencimento: string;
  estado: string;
  criado_em: string;
};
type Demonstrativo = {
  consumo_total_kwh: string | null;
  energia_injetada_kwh: string;
  tarifa_kwh: string;
  desconto_percentual: string;
  energia_sem_desconto_centavos: number;
  energia_com_desconto_centavos: number;
  equatorial_centavos: number | null;
  tarifa_minima_centavos: number;
  iluminacao_centavos: number;
  juros_equatorial_centavos: number;
  multa_equatorial_centavos: number;
  ajuste_gdii_centavos: number;
  encargos_atraso_centavos: number;
  referencia_sem_desconto_centavos: number;
  total_ecosol_centavos: number;
  economia_centavos: number;
};
type Detalhe = Operacao & {
  snapshot: {
    cliente?: { nome: string };
    unidade?: { uc: string; competencia: string };
    cobranca?: { vencimento: string };
    memoria_calculo?: { entradas?: { modalidade?: string } };
  };
  demonstrativo: Demonstrativo | null;
  pdf_disponivel: boolean;
};
type Estado = {
  ambiente: string;
  modo_configurado: string;
  pausado: boolean;
};

const numero = (valor: string) => valor.replace(".", ",");
const basePdf = "/api/admin/bancario/operacoes";

function Barra({
  nome,
  valor,
  maximo,
  classe,
}: {
  nome: string;
  valor: number;
  maximo: number;
  classe: string;
}) {
  return (
    <div className="emissao-barra-linha">
      <div>
        <span>{nome}</span>
        <strong>{formatarDinheiro(valor)}</strong>
      </div>
      <div className="emissao-barra-trilha" aria-hidden="true">
        <span
          className={classe}
          style={{
            width: `${Math.max(0, Math.min(100, (valor / maximo) * 100))}%`,
          }}
        />
      </div>
    </div>
  );
}

export default function EmissaoBoletos() {
  const documentos = usarConsulta<Documento[]>(
    "/api/admin/faturamento/documentos",
  );
  const operacoes = usarConsulta<Operacao[]>("/api/admin/bancario/operacoes");
  const estado = usarConsulta<Estado>("/api/admin/bancario/estado");
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const detalhe = usarConsulta<Detalhe>(
    selecionado ? `${basePdf}/${selecionado}` : null,
  );
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [previaAberta, setPreviaAberta] = useState(false);
  const [conferida, setConferida] = useState<string | null>(null);
  const cobrancas = useMemo(
    () => (operacoes.dados ?? []).filter((item) => item.tipo === "cobranca"),
    [operacoes.dados],
  );
  const prontas = useMemo(() => {
    const usadas = new Set(cobrancas.map((item) => item.origem_id));
    return (documentos.dados ?? []).filter(
      (item) =>
        item.status === "Aprovada — aguardando emissão" &&
        !usadas.has(String(item.id)),
    );
  }, [documentos.dados, cobrancas]);

  async function executar(acao: () => Promise<void>, sucesso: string) {
    if (ocupado) return;
    setOcupado(true);
    setErro("");
    setMensagem("");
    try {
      await acao();
      setMensagem(sucesso);
      operacoes.atualizar();
      documentos.atualizar();
      detalhe.atualizar();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const operacao = detalhe.dados;
  const demonstrativo = operacao?.demonstrativo;
  const boletoRegistrado = Boolean(
    operacao?.pdf_disponivel &&
      ["registrada", "liquidada"].includes(operacao.estado),
  );
  const urlPrevia = operacao
    ? `${basePdf}/${operacao.id}/demonstrativo.pdf${boletoRegistrado ? "?final=1" : ""}`
    : "";
  const chaveConferencia = operacao
    ? `${operacao.id}:${operacao.valor_centavos}:${operacao.vencimento}`
    : null;
  const maximo = demonstrativo
    ? Math.max(
        1,
        demonstrativo.referencia_sem_desconto_centavos,
        demonstrativo.total_ecosol_centavos,
        demonstrativo.equatorial_centavos ?? 0,
      )
    : 1;
  const emissaoReal =
    estado.dados?.ambiente === "producao" &&
    estado.dados.modo_configurado === "real";
  const simulacao =
    estado.dados?.ambiente === "homologacao" &&
    estado.dados.modo_configurado === "simulado";

  return (
    <section className="emissao-pagina">
      <header className="emissao-topo">
        <div>
          <span className="admin-sobretitulo">ETAPA 5 · EMITIR</span>
          <h2>Boletos e demonstrativos</h2>
          <p>
            Confira o cálculo aprovado, visualize o documento e acompanhe a
            emissão.
          </p>
        </div>
        <Link className="admin-botao secundario" to="/admin/bancario">
          Abrir painel bancário
        </Link>
      </header>
      <div className="emissao-ambiente" role="status">
        {estado.carregando
          ? "Verificando ambiente bancário…"
          : emissaoReal
            ? estado.dados?.pausado
              ? "Produção configurada · fila pausada"
              : "Produção ativa · envio real ao Sicoob"
            : simulacao
              ? "Simulação bancária · nenhum boleto real será emitido"
              : "Emissão indisponível · consulte o estado da integração"}
      </div>
      {erro && (
        <p className="admin-aviso erro" role="alert">
          {erro}
        </p>
      )}
      {mensagem && (
        <p className="admin-aviso sucesso" role="status">
          {mensagem}
        </p>
      )}
      <EstadoDaConsulta {...documentos} repetir={documentos.atualizar} />
      <EstadoDaConsulta {...operacoes} repetir={operacoes.atualizar} />
      <EstadoDaConsulta {...estado} repetir={estado.atualizar} />
      <div className="emissao-grade">
        <div className="emissao-fila">
          <section className="admin-cartao">
            <h3>Prontas para preparar</h3>
            {prontas.length === 0 && (
              <p>Nenhuma cobrança aprovada aguarda preparo.</p>
            )}
            {prontas.map((documento) => (
              <div className="emissao-item" key={documento.id}>
                <span>
                  <strong>
                    {documento.memoria?.unidade?.cliente_nome ?? documento.nome}
                  </strong>
                  <small>
                    UC {documento.memoria?.unidade?.uc ?? documento.dados.uc} ·{" "}
                    {formatarDinheiro(documento.memoria?.total_centavos ?? 0)}
                  </small>
                </span>
                <button
                  className="admin-botao secundario"
                  disabled={ocupado}
                  onClick={() =>
                    executar(async () => {
                      const resposta = await consultarServidor<{
                        operacao: Operacao;
                      }>("/api/admin/bancario/operacoes/cobrancas", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ documento_id: documento.id }),
                      });
                      setSelecionado(resposta.operacao.id);
                    }, "Cobrança preparada. Confira a prévia antes de enviar.")
                  }
                >
                  Preparar
                </button>
              </div>
            ))}
          </section>
          <section className="admin-cartao">
            <h3>Cobranças preparadas</h3>
            {cobrancas.length === 0 && <p>Nenhuma cobrança preparada.</p>}
            {cobrancas.map((item) => (
              <button
                className={`emissao-operacao${selecionado === item.id ? " ativa" : ""}`}
                key={item.id}
                onClick={() => setSelecionado(item.id)}
              >
                <span>
                  <strong>{formatarDinheiro(item.valor_centavos)}</strong>
                  <small>Vence {formatarData(item.vencimento)}</small>
                </span>
                <small>{item.estado.replaceAll("_", " ")}</small>
              </button>
            ))}
          </section>
        </div>
        <section className="admin-cartao emissao-previa">
          {!selecionado && (
            <p>Selecione uma cobrança para visualizar o boleto.</p>
          )}
          {selecionado && (
            <EstadoDaConsulta {...detalhe} repetir={detalhe.atualizar} />
          )}
          {operacao && !demonstrativo && (
            <p role="status">
              Esta cobrança não possui componentes suficientes para montar o
              demonstrativo. Confira a memória de cálculo da fatura antes de
              disponibilizar o boleto ao cliente.
            </p>
          )}
          {operacao && demonstrativo && (
            <>
              <div className="emissao-documento-topo">
                <span>ECOSOL · PRÉVIA DA COBRANÇA</span>
                <h3>{operacao.snapshot.cliente?.nome ?? "Cliente"}</h3>
                <p>
                  UC {operacao.snapshot.unidade?.uc ?? "—"} · Competência{" "}
                  {operacao.snapshot.unidade?.competencia ?? "—"} · Vence{" "}
                  {formatarData(operacao.vencimento)}
                </p>
              </div>
              <div className="emissao-passos">
                <h4>Como chegamos ao valor</h4>
                <p>
                  Energia injetada:{" "}
                  <strong>
                    {numero(demonstrativo.energia_injetada_kwh)} kWh
                  </strong>{" "}
                  × tarifa de{" "}
                  <strong>R$ {numero(demonstrativo.tarifa_kwh)}/kWh</strong> ={" "}
                  {formatarDinheiro(
                    demonstrativo.energia_sem_desconto_centavos,
                  )}
                </p>
                <p>
                  Desconto contratado:{" "}
                  <strong>{numero(demonstrativo.desconto_percentual)}%</strong>{" "}
                  · energia com desconto:{" "}
                  {formatarDinheiro(
                    demonstrativo.energia_com_desconto_centavos,
                  )}
                </p>
                {demonstrativo.equatorial_centavos !== null && (
                  <p>
                    + Fatura Equatorial:{" "}
                    {formatarDinheiro(demonstrativo.equatorial_centavos)}
                  </p>
                )}
                {demonstrativo.tarifa_minima_centavos > 0 && (
                  <p>
                    + Parcela mínima de energia:{" "}
                    {formatarDinheiro(demonstrativo.tarifa_minima_centavos)}
                  </p>
                )}
                {demonstrativo.iluminacao_centavos > 0 && (
                  <p>
                    + Iluminação pública:{" "}
                    {formatarDinheiro(demonstrativo.iluminacao_centavos)}
                  </p>
                )}
                {demonstrativo.juros_equatorial_centavos > 0 && (
                  <p>
                    − Juros já incluídos na Equatorial:{" "}
                    {formatarDinheiro(demonstrativo.juros_equatorial_centavos)}
                  </p>
                )}
                {demonstrativo.multa_equatorial_centavos > 0 && (
                  <p>
                    − Multa já incluída na Equatorial:{" "}
                    {formatarDinheiro(demonstrativo.multa_equatorial_centavos)}
                  </p>
                )}
                {demonstrativo.ajuste_gdii_centavos > 0 && (
                  <p>
                    − Ajuste GDII:{" "}
                    {formatarDinheiro(demonstrativo.ajuste_gdii_centavos)}
                  </p>
                )}
                {demonstrativo.encargos_atraso_centavos > 0 && (
                  <p>
                    + Encargos de boleto anterior:{" "}
                    {formatarDinheiro(demonstrativo.encargos_atraso_centavos)}
                  </p>
                )}
                <div className="emissao-total">
                  <span>Total Ecosol</span>
                  <strong>
                    {formatarDinheiro(demonstrativo.total_ecosol_centavos)}
                  </strong>
                </div>
                <small>
                  As parcelas são demonstrativas; o total aprovado é arredondado
                  no fechamento do cálculo.
                </small>
              </div>
              <div className="emissao-grafico">
                <h4>Energia e valores</h4>
                {demonstrativo.consumo_total_kwh ? (
                  <div className="emissao-energia">
                    <div>
                      <span>Consumo total</span>
                      <strong>
                        {numero(demonstrativo.consumo_total_kwh)} kWh
                      </strong>
                    </div>
                    <div className="emissao-barra-trilha">
                      <span
                        style={{
                          width: `${Math.min(100, (Number(demonstrativo.energia_injetada_kwh) / Number(demonstrativo.consumo_total_kwh)) * 100)}%`,
                        }}
                      />
                    </div>
                    <small>
                      Faixa colorida:{" "}
                      {numero(demonstrativo.energia_injetada_kwh)} kWh de
                      energia injetada.
                    </small>
                  </div>
                ) : (
                  <p>
                    Consumo total ainda não identificado com segurança na
                    fatura.
                  </p>
                )}
                {demonstrativo.equatorial_centavos !== null && (
                  <Barra
                    nome="Fatura Equatorial"
                    valor={demonstrativo.equatorial_centavos}
                    maximo={maximo}
                    classe="equatorial"
                  />
                )}
                <Barra
                  nome="Sem desconto Ecosol · estimativa"
                  valor={demonstrativo.referencia_sem_desconto_centavos}
                  maximo={maximo}
                  classe="referencia"
                />
                <Barra
                  nome="Ecosol a pagar"
                  valor={demonstrativo.total_ecosol_centavos}
                  maximo={maximo}
                  classe="ecosol"
                />
                <strong>
                  Economia estimada:{" "}
                  {formatarDinheiro(demonstrativo.economia_centavos)}
                </strong>
                <small>
                  A referência sem desconto é uma simulação com a mesma energia.
                  Não é outra fatura emitida pela Equatorial.
                </small>
              </div>
              <div className="emissao-acoes">
                <button
                  className="admin-botao secundario"
                  type="button"
                  onClick={() => setPreviaAberta(true)}
                >
                  Ver prévia completa
                </button>
                {operacao.pdf_disponivel &&
                  ["registrada", "liquidada"].includes(operacao.estado) && (
                    <a
                      className="admin-botao"
                      target="_blank"
                      rel="noreferrer"
                      href={`${basePdf}/${operacao.id}/demonstrativo.pdf?final=1`}
                    >
                      Abrir boleto final
                    </a>
                  )}
                {["aprovada", "aguardando_aprovacao"].includes(
                  operacao.estado,
                ) && (
                  <button
                    className="admin-botao"
                    disabled={
                      ocupado ||
                      conferida !== chaveConferencia ||
                      (!emissaoReal && !simulacao) ||
                      estado.dados?.pausado
                    }
                    onClick={() =>
                      executar(
                        () =>
                          consultarServidor(
                            `${basePdf}/${operacao.id}/enfileirar`,
                            { method: "POST" },
                          ).then(() => {}),
                        emissaoReal
                          ? "Cobrança enviada à fila bancária."
                          : "Cobrança enviada ao simulador.",
                      )
                    }
                  >
                    {emissaoReal ? "Enviar para emissão" : "Enviar à simulação"}
                  </button>
                )}
              </div>
              {["aprovada", "aguardando_aprovacao"].includes(
                operacao.estado,
              ) && conferida !== chaveConferencia && (
                <small>Abra e confira a prévia completa antes de enviar para emissão.</small>
              )}
              {!operacao.pdf_disponivel && (
                <small>
                  O PDF bancário aparecerá aqui quando o Sicoob o fornecer após
                  o registro.
                </small>
              )}
            </>
          )}
        </section>
      </div>
      {previaAberta && operacao && demonstrativo && (
        <div className="emissao-modal-fundo" role="presentation">
          <section
            className="emissao-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Prévia completa do boleto"
          >
            <header>
              <div>
                <h3>Prévia completa do boleto</h3>
                <p>
                  {boletoRegistrado
                    ? "Página 1: cálculo Ecosol. As páginas seguintes são o boleto original registrado pelo Sicoob."
                    : "Página 1: cálculo Ecosol. Página 2: dados previstos do boleto. O código de barras e a linha digitável só virão do Sicoob após o registro."}
                </p>
              </div>
              <button
                type="button"
                className="admin-botao secundario"
                onClick={() => setPreviaAberta(false)}
              >
                Fechar
              </button>
            </header>
            <iframe
              title="Prévia em PDF do boleto"
              src={urlPrevia}
            />
            <footer>
              <a
                className="admin-botao secundario"
                href={urlPrevia}
                target="_blank"
                rel="noreferrer"
              >
                Abrir PDF em outra aba
              </a>
              {["aprovada", "aguardando_aprovacao"].includes(
                operacao.estado,
              ) && (
                <button
                  type="button"
                  className="admin-botao"
                  onClick={() => {
                    setConferida(chaveConferencia);
                    setPreviaAberta(false);
                  }}
                >
                  Conferi os dados da prévia
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
