import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CabecalhoDoModulo,
  EstadoDaConsulta,
  ListaVazia,
} from "./ComponentesDoPainel";
import {
  consultarServidor,
  formatarData,
  formatarDinheiro,
  usarConsulta,
} from "./comunicacaoComServidor";
import { usarAdministrador } from "./EstruturaAdministrativa";
import DemonstrativoCalculo from "./DemonstrativoCalculo";
import {
  prepararLinhaCalculo,
  resumirCalculos,
  situacoesCalculo,
} from "./painelCalculos";
import type { LinhaCalculo, SituacaoCalculo } from "./painelCalculos";
import type { Documento, PreviaCalculo } from "./tiposFaturamento";
import type { Unidade } from "./UnidadesDeCobranca";
import "./estilosCalculos.css";

const base = "/api/admin/faturamento/documentos";
const normalizar = (valor: string) =>
  valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const mesLegivel = (valor: string) =>
  /^\d{4}-\d{2}$/.test(valor)
    ? `${valor.slice(5)}/${valor.slice(0, 4)}`
    : "Não informada";
const numeroLegivel = (valor?: string) =>
  valor ? valor.replace(".", ",") : "Não informado";
const porPagina = 15;

function Situacao({ linha }: { linha: LinhaCalculo }) {
  return (
    <span
      className={`admin-status ${linha.situacao === "pendente" ? "incompleta" : "aguardando"}`}
    >
      {situacoesCalculo[linha.situacao]}
    </span>
  );
}

export default function Calculos({
  incorporado = false,
  modo = "calcular",
}: {
  incorporado?: boolean;
  modo?: "calcular" | "aprovar";
}) {
  const { nivel } = usarAdministrador();
  const [parametros] = useSearchParams();
  const consulta = usarConsulta<Documento[]>(base);
  const unidades = usarConsulta<Unidade[]>("/api/admin/faturamento/unidades");
  const [busca, setBusca] = useState("");
  const [usina, setUsina] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [situacao, setSituacao] = useState(
    modo === "aprovar" ? "calculada" : "",
  );
  const [pagina, setPagina] = useState(1);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const detalhe = useRef<HTMLElement>(null);
  const linhas = useMemo(() => {
    const documentos = consulta.dados ?? [];
    return documentos.map((d) =>
      prepararLinhaCalculo(d, unidades.dados ?? [], documentos),
    );
  }, [consulta.dados, unidades.dados]);
  const usinas = [
    ...new Map(
      linhas.map((l) => [String(l.usinaId ?? "sem-usina"), l.usinaNome]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const filtradas = linhas.filter(
    (l) =>
      (!busca ||
        normalizar(`${l.cliente} ${l.uc} ${l.documento.nome}`).includes(
          normalizar(busca.trim()),
        )) &&
      (!usina || String(l.usinaId ?? "sem-usina") === usina) &&
      (!competencia || l.competencia === competencia) &&
      (!situacao || l.situacao === situacao),
  );
  const resumo = resumirCalculos(filtradas);
  const paginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
  const paginaAtual = Math.min(pagina, paginas);
  const linhaSelecionada = linhas.find((l) => l.documento.id === selecionado);
  const carregando = consulta.carregando || unidades.carregando;
  const disponivel = !carregando && !consulta.erro && !unidades.erro;

  useEffect(() => {
    setSituacao(modo === "aprovar" ? "calculada" : "");
    setPagina(1);
    setSelecionado(null);
  }, [modo]);

  useEffect(() => {
    if (!disponivel) return;
    const id = Number(parametros.get("documento"));
    if (
      Number.isInteger(id) &&
      linhas.some((linha) => linha.documento.id === id)
    )
      setSelecionado(id);
  }, [disponivel, linhas, parametros]);

  useEffect(() => {
    if (selecionado === null || !disponivel) return;
    detalhe.current?.scrollIntoView({ block: "start" });
    detalhe.current
      ?.querySelector<HTMLElement>("h2")
      ?.focus({ preventScroll: true });
  }, [selecionado, disponivel]);

  function atualizar() {
    if (ocupado) return;
    consulta.atualizar();
    unidades.atualizar();
  }
  function limparFiltros() {
    setBusca("");
    setUsina("");
    setCompetencia("");
    setSituacao(modo === "aprovar" ? "calculada" : "");
    setPagina(1);
  }

  return (
    <>
      {!incorporado && (
        <CabecalhoDoModulo
          titulo="Faturas — Calcular"
          descricao="Etapa 3 do fluxo de Faturas: confira cada parcela e acompanhe os resultados."
        >
          <button
            className="admin-botao"
            disabled={ocupado || carregando}
            onClick={atualizar}
          >
            Atualizar
          </button>
        </CabecalhoDoModulo>
      )}
      <div className="calculos-contexto">
        <span aria-hidden="true">☀</span>
        <p>
          <strong>
            {modo === "aprovar" ? "Etapa 4 — Aprovar" : "Etapa 3 — Calcular"}
          </strong>
          <br />
          {modo === "aprovar"
            ? "Revise a memória já salva e confirme somente os cálculos prontos para emissão futura."
            : "Gere a prévia e salve o cálculo conferido. Prévias não entram no total antes da confirmação."}
        </p>
        <button
          className="admin-botao secundario"
          disabled={ocupado || carregando}
          onClick={atualizar}
        >
          Atualizar
        </button>
      </div>
      {mensagem && (
        <p className="admin-aviso sucesso" role="status">
          {mensagem}
        </p>
      )}
      <EstadoDaConsulta {...consulta} repetir={atualizar} />
      <EstadoDaConsulta {...unidades} repetir={atualizar} />
      {disponivel && (
        <>
          <div className="admin-resumos calculos-resumos">
            <article>
              <span>Faturas na seleção</span>
              <strong>{resumo.quantidade}</strong>
              <small>{resumo.prontas} com campos preenchidos para prévia</small>
            </article>
            <article>
              <span>Dados pendentes</span>
              <strong>{resumo.pendentes}</strong>
              <small>Precisam de conferência em Faturas</small>
            </article>
            <article className="solar">
              <span>Aguardando aprovação</span>
              <strong>{resumo.aguardandoAprovacao}</strong>
              <small>{resumo.aprovadas} aprovadas para emissão futura</small>
            </article>
            <article className="calculos-resumo-total">
              <span>Total calculado</span>
              <strong>{formatarDinheiro(resumo.totalCentavos)}</strong>
              <small>
                {resumo.calculadas} cálculo(s) salvo(s) · filtros aplicados
              </small>
            </article>
          </div>
          <section
            className="admin-cartao calculos-listagem"
            aria-labelledby="calculos-lista-titulo"
          >
            <div className="admin-barra">
              <div>
                <span className="admin-sobretitulo">CENTRAL DE CÁLCULOS</span>
                <h2 id="calculos-lista-titulo">Faturas e resultados</h2>
              </div>
            </div>
            <fieldset className="calculos-filtros" disabled={ocupado}>
              <legend className="calculos-somente-leitor">
                Filtrar faturas
              </legend>
              <label>
                Cliente, UC ou PDF
                <input
                  value={busca}
                  placeholder="Buscar na lista"
                  onChange={(e) => {
                    setBusca(e.target.value);
                    setPagina(1);
                  }}
                />
              </label>
              <label>
                Usina
                <select
                  value={usina}
                  onChange={(e) => {
                    setUsina(e.target.value);
                    setPagina(1);
                  }}
                >
                  <option value="">Todas as usinas</option>
                  {usinas.map(([id, nome]) => (
                    <option key={id} value={id}>
                      {nome}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Competência
                <input
                  type="month"
                  value={competencia}
                  onChange={(e) => {
                    setCompetencia(e.target.value);
                    setPagina(1);
                  }}
                />
              </label>
              <label>
                Situação
                <select
                  value={situacao}
                  onChange={(e) => {
                    setSituacao(e.target.value);
                    setPagina(1);
                  }}
                >
                  <option value="">Todas as situações</option>
                  {Object.entries(situacoesCalculo).map(([valor, texto]) => (
                    <option key={valor} value={valor}>
                      {texto}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="admin-botao secundario"
                onClick={limparFiltros}
              >
                Limpar
              </button>
            </fieldset>
            {linhas.length === 0 ? (
              <ListaVazia texto="Receba as faturas para preparar os cálculos. Elas aparecerão aqui com seus dados e resultados." />
            ) : filtradas.length === 0 ? (
              <p className="admin-vazio">
                Nenhuma fatura corresponde aos filtros. Altere a busca ou limpe
                os filtros.
              </p>
            ) : (
              <>
                <div className="admin-tabela calculos-tabela">
                  <table>
                    <caption className="calculos-somente-leitor">
                      Faturas filtradas e valores calculados
                    </caption>
                    <thead>
                      <tr>
                        <th>Cliente / UC</th>
                        <th>Usina / competência</th>
                        <th>Modalidade</th>
                        <th>Valor Ecosol</th>
                        <th>Situação</th>
                        <th>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtradas
                        .slice(
                          (paginaAtual - 1) * porPagina,
                          paginaAtual * porPagina,
                        )
                        .map((linha) => (
                          <tr
                            key={linha.documento.id}
                            className={
                              selecionado === linha.documento.id
                                ? "calculos-linha-selecionada"
                                : ""
                            }
                          >
                            <td>
                              <strong>{linha.cliente}</strong>
                              <small>UC {linha.uc}</small>
                              <small>{linha.documento.nome}</small>
                            </td>
                            <td>
                              {linha.usinaNome}
                              <small>{mesLegivel(linha.competencia)}</small>
                            </td>
                            <td>{linha.modalidade}</td>
                            <td className="calculos-valor">
                              {linha.memoria ? (
                                formatarDinheiro(linha.memoria.total_centavos)
                              ) : (
                                <span title="O cálculo ainda não foi salvo">
                                  —
                                </span>
                              )}
                            </td>
                            <td>
                              <Situacao linha={linha} />
                              {linha.pendencias.length > 0 && (
                                <small>
                                  {linha.pendencias.length} pendência(s)
                                </small>
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="admin-botao secundario"
                                aria-label={`Abrir cálculo da UC ${linha.uc}, fatura ${linha.documento.id}`}
                                disabled={ocupado}
                                onClick={() => {
                                  setSelecionado(linha.documento.id);
                                  setMensagem("");
                                }}
                              >
                                {linha.memoria ? "Ver cálculo" : "Preparar"}
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <div className="calculos-paginacao">
                  <span>
                    {filtradas.length} fatura(s) · Página {paginaAtual} de{" "}
                    {paginas}
                  </span>
                  <div className="admin-acoes">
                    <button
                      className="admin-botao secundario"
                      disabled={ocupado || paginaAtual === 1}
                      onClick={() => setPagina(paginaAtual - 1)}
                    >
                      Anterior
                    </button>
                    <button
                      className="admin-botao secundario"
                      disabled={ocupado || paginaAtual === paginas}
                      onClick={() => setPagina(paginaAtual + 1)}
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              </>
            )}
            {linhas.some((l) => l.memoria) && (
              <p className="calculos-exportacao">
                <a href="/api/admin/faturamento/planilhas/calculos">
                  Exportar todos os cálculos salvos em Excel
                </a>
                <span>
                  Inclui todas as usinas e competências, independentemente dos
                  filtros acima.
                </span>
              </p>
            )}
          </section>
          {linhaSelecionada && (
            <section
              className="admin-cartao calculos-detalhe"
              ref={detalhe}
              aria-label="Detalhes do cálculo"
            >
              <DetalheCalculo
                key={`${linhaSelecionada.documento.id}:${linhaSelecionada.documento.versao}`}
                linha={linhaSelecionada}
                nivel={nivel}
                aoOcupar={setOcupado}
                aoFechar={() => setSelecionado(null)}
                aoConcluir={(texto) => {
                  setMensagem(texto);
                  consulta.atualizar();
                  unidades.atualizar();
                }}
                modo={modo}
              />
            </section>
          )}
        </>
      )}
    </>
  );
}

function DetalheCalculo({
  linha,
  nivel,
  aoOcupar,
  aoFechar,
  aoConcluir,
  modo,
}: {
  linha: LinhaCalculo;
  nivel: number;
  aoOcupar: (valor: boolean) => void;
  aoFechar: () => void;
  aoConcluir: (mensagem: string) => void;
  modo: "calcular" | "aprovar";
}) {
  const [previa, setPrevia] = useState<PreviaCalculo | null>(null);
  const [conferido, setConferido] = useState(false);
  const [pdfAberto, setPdfAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const emCurso = useRef(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  const d = linha.documento;
  const memoria = previa?.memoria ?? linha.memoria;
  const aprovada = linha.situacao === "aprovada";
  const enderecoFatura = `/admin/faturas?etapa=conferir&documento=${d.id}`;

  async function executar(acao: "previa" | "calcular" | "aprovar") {
    if (emCurso.current || aprovada) return;
    if ((acao === "previa" || acao === "calcular") && modo !== "calcular")
      return;
    if (acao === "aprovar" && modo !== "aprovar") return;
    if (acao === "calcular" && (!previa || !conferido || nivel < 2)) return;
    if (
      acao === "aprovar" &&
      (previa || !conferido || nivel < 3 || linha.situacao !== "calculada")
    )
      return;
    emCurso.current = true;
    setOcupado(true);
    aoOcupar(true);
    setErro("");
    if (acao === "previa") {
      setPrevia(null);
      setConferido(false);
    }
    try {
      if (acao === "previa") {
        const resposta = await consultarServidor<PreviaCalculo>(
          `${base}/${d.id}/previa`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ versao: d.versao, dados: linha.dados }),
          },
        );
        if (montado.current) setPrevia(resposta);
      } else {
        await consultarServidor<Documento>(`${base}/${d.id}/${acao}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            versao: d.versao,
            conferido,
            ...(acao === "calcular"
              ? { dados: linha.dados, previa_hash: previa?.hash }
              : {}),
          }),
        });
        if (montado.current)
          aoConcluir(
            acao === "calcular"
              ? `Cálculo da fatura #${d.id} salvo. O resultado aguarda aprovação.`
              : `Fatura #${d.id} aprovada para emissão futura. Nenhum boleto foi emitido.`,
          );
      }
    } catch (falha) {
      if (montado.current) {
        setErro((falha as Error).message);
        setPrevia(null);
        setConferido(false);
      }
    } finally {
      emCurso.current = false;
      if (montado.current) setOcupado(false);
      aoOcupar(false);
    }
  }

  return (
    <>
      <header className="calculos-detalhe-cabecalho">
        <div>
          <span className="admin-sobretitulo">
            FATURA #{d.id} · {mesLegivel(linha.competencia)}
          </span>
          <h2 tabIndex={-1}>{linha.cliente}</h2>
          <p>
            UC {linha.uc} · {linha.usinaNome}
          </p>
          <small>{d.nome}</small>
        </div>
        <div className="admin-acoes">
          <Situacao linha={linha} />
          <button
            className="admin-botao secundario"
            disabled={ocupado}
            onClick={aoFechar}
          >
            Fechar
          </button>
        </div>
      </header>
      <div className="calculos-dados">
        <div>
          <span>Modalidade</span>
          <strong>{linha.modalidade}</strong>
        </div>
        <div>
          <span>Energia injetada</span>
          <strong>
            {numeroLegivel(memoria?.entradas.injecao ?? linha.dados.injecao)}
            {(memoria?.entradas.injecao ?? linha.dados.injecao) && " kWh"}
          </strong>
        </div>
        <div>
          <span>Competência</span>
          <strong>{mesLegivel(linha.competencia)}</strong>
        </div>
        <div>
          <span>Vencimento Ecosol</span>
          <strong>
            {memoria?.vencimento_ecosol ||
            linha.dados.vencimento_ecosol ||
            linha.dados.vencimento_equatorial
              ? formatarData(
                  memoria?.vencimento_ecosol ||
                    linha.dados.vencimento_ecosol ||
                    linha.dados.vencimento_equatorial,
                )
              : "Não informado"}
          </strong>
        </div>
      </div>
      {erro && (
        <p className="admin-aviso erro" role="alert">
          {erro} Atualize os dados ou abra a conferência da fatura.
        </p>
      )}
      {linha.pendencias.length > 0 && (
        <div className="calculos-pendencias">
          <h3>Complete os dados para calcular</h3>
          <ul>
            {linha.pendencias.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <Link className="admin-botao secundario" to={enderecoFatura}>
            Abrir conferência desta fatura
          </Link>
        </div>
      )}
      <div className="calculos-acoes-documento">
        <button
          className="admin-botao secundario"
          aria-expanded={pdfAberto}
          aria-controls="calculos-pdf"
          onClick={() => setPdfAberto(!pdfAberto)}
        >
          {pdfAberto ? "Ocultar PDF" : "Ver PDF da fatura"}
        </button>
        {!ocupado && (
          <Link to={enderecoFatura}>Conferir dados em Faturas ↗</Link>
        )}
        {modo === "calcular" && !aprovada && linha.pendencias.length === 0 && (
          <button
            className="admin-botao"
            disabled={ocupado}
            onClick={() => executar("previa")}
          >
            {ocupado
              ? "Processando…"
              : linha.memoria
                ? "Gerar nova prévia"
                : "Calcular prévia"}
          </button>
        )}
      </div>
      {pdfAberto && (
        <div id="calculos-pdf" className="calculos-pdf">
          <iframe
            src={`${base}/${d.id}/pdf`}
            title={`PDF da fatura ${d.nome}`}
          />
          <a href={`${base}/${d.id}/pdf`} target="_blank" rel="noreferrer">
            Abrir PDF em outra aba
          </a>
        </div>
      )}
      {memoria ? (
        <DemonstrativoCalculo memoria={memoria} previa={Boolean(previa)} />
      ) : (
        linha.pendencias.length === 0 && (
          <p className="calculos-orientacao">
            Os campos estão preenchidos. Gere a prévia para validar os dados e
            visualizar o valor calculado pelo sistema.
          </p>
        )
      )}
      {!aprovada &&
        ((modo === "calcular" && nivel >= 2 && previa) ||
          (modo === "aprovar" &&
            nivel >= 3 &&
            linha.situacao === "calculada")) && (
          <div className="calculos-confirmacao">
            <label>
              <input
                type="checkbox"
                checked={conferido}
                disabled={ocupado}
                onChange={(e) => setConferido(e.target.checked)}
              />
              <span>
                Conferi os dados com o PDF e revisei o resultado acima.
              </span>
            </label>
            <div className="admin-acoes">
              {modo === "calcular" ? (
                <button
                  className="admin-botao"
                  disabled={ocupado || !conferido}
                  onClick={() => executar("calcular")}
                >
                  {ocupado ? "Salvando…" : "Salvar cálculo conferido"}
                </button>
              ) : (
                <button
                  className="admin-botao"
                  disabled={ocupado || !conferido}
                  onClick={() => executar("aprovar")}
                >
                  {ocupado ? "Aprovando…" : "Aprovar para emissão futura"}
                </button>
              )}
            </div>
          </div>
        )}
      {aprovada && (
        <p className="admin-aviso">
          Cálculo aprovado e preservado no histórico. Aguarda a etapa de emissão
          de boleto.
        </p>
      )}
      {modo === "calcular" && linha.situacao === "calculada" && (
        <p className="calculos-orientacao">
          Cálculo salvo. Continue na{" "}
          <Link to={`/admin/faturas?etapa=aprovar&documento=${d.id}`}>
            etapa 4 — Aprovar
          </Link>
          .
        </p>
      )}
      {modo === "calcular" && nivel < 2 && (
        <p className="calculos-orientacao">
          Seu perfil permite consultar resultados e gerar prévias. O salvamento
          depende da equipe autorizada.
        </p>
      )}
      {modo === "aprovar" && nivel < 3 && (
        <p className="calculos-orientacao">
          A aprovação exige o perfil avançado da equipe.
        </p>
      )}
    </>
  );
}
