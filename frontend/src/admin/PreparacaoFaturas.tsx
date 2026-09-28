import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import {
  consultarServidor,
  formatarDinheiro,
  usarConsulta,
} from "./comunicacaoComServidor";
import { EstadoDaConsulta } from "./ComponentesDoPainel";
import { usarAdministrador } from "./EstruturaAdministrativa";
import type { Unidade, Contrato } from "./UnidadesDeCobranca";

type Memoria = {
  regra: string;
  tarifa_completa: string;
  consumo_centavos: number;
  equatorial_centavos: number;
  ajuste_centavos: number;
  total_centavos: number;
  unidade: Unidade;
  contrato: Contrato;
  vencimento_ecosol: string;
  fonte: { tipo: string; documento_id: number };
};
type Documento = {
  id: number;
  nome: string;
  lote: string;
  status: string;
  versao: number;
  dados: Record<string, string>;
  extracao: {
    avisos: string[];
    evidencias: Record<string, string>;
    paginas?: number;
    qualidade?: {
      modo: string;
      campos_identificados: number;
      campos_esperados: number;
      percentual: number;
      pendencias: string[];
    };
  };
  memoria: Memoria | null;
  texto?: string;
  historico?: { acao: string; responsavel: string; criado_em: string }[];
};
type Recebimento = {
  id: number;
  nome: string;
  lote: string;
  resultado: "Recebida" | "Requer atenção" | "Erro";
  codigo: "ok" | "duplicada" | "ilegivel" | "invalida";
  motivo: string;
  documento_id: number | null;
  estado_documento: string | null;
  criado_em: string;
  dados: Record<string, string> | null;
  memoria: Memoria | null;
};
const base = "/api/admin/faturamento/documentos";
const aprovada = "Aprovada — aguardando emissão";

export default function PreparacaoFaturas() {
  const consulta = usarConsulta<Documento[]>(base);
  const recebimentos = usarConsulta<Recebimento[]>(
    "/api/admin/faturamento/recebimentos",
  );
  const unidades = usarConsulta<Unidade[]>("/api/admin/faturamento/unidades");
  const { nivel } = usarAdministrador();
  const [exportacaoAberta, setExportacaoAberta] = useState(false);
  const usinas = usarConsulta<{ id: number; nome: string }[]>(
    exportacaoAberta ? "/api/admin/usinas" : null,
  );
  const [usinaExportacao, setUsinaExportacao] = useState("");
  const [selecionado, setSelecionado] = useState<Documento | null>(null);
  const [dados, setDados] = useState<Record<string, string>>({});
  const [alterado, setAlterado] = useState(false);
  const [conferido, setConferido] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("");

  function mostrar(d: Documento) {
    setSelecionado(d);
    setDados(d.dados);
    setAlterado(false);
    setConferido(false);
  }
  async function abrir(numero: number) {
    setOcupado(true);
    setErro("");
    setMensagem("");
    try {
      mostrar(await consultarServidor<Documento>(`${base}/${numero}`));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  async function importar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    setErro("");
    setMensagem("");
    const form = e.currentTarget,
      campos = new FormData(form),
      arquivo = campos.get("pdf") as File;
    try {
      if (!arquivo?.size || arquivo.size > 10 * 1024 * 1024)
        throw new Error("Selecione um PDF com até 10 MB.");
      const params = new URLSearchParams({
        lote: String(campos.get("lote")).trim(),
        nome: arquivo.name,
      });
      const d = await consultarServidor<Documento>(`${base}?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: arquivo,
      });
      mostrar(d);
      consulta.atualizar();
      recebimentos.atualizar();
      setMensagem(
        "PDF importado. Confira os dados sugeridos antes de calcular.",
      );
      form.reset();
    } catch (e) {
      setErro((e as Error).message);
      recebimentos.atualizar();
    } finally {
      setOcupado(false);
    }
  }
  async function acao(tipo: "salvar" | "calcular" | "aprovar") {
    if (!selecionado) return;
    setOcupado(true);
    setErro("");
    setMensagem("");
    try {
      let d = selecionado;
      if (tipo !== "aprovar") {
        d = await consultarServidor<Documento>(`${base}/${d.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versao: d.versao, dados }),
        });
      }
      if (tipo !== "salvar") {
        d = await consultarServidor<Documento>(`${base}/${d.id}/${tipo}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versao: d.versao, conferido }),
        });
      }
      mostrar(d);
      setMensagem(
        tipo === "aprovar"
          ? "Aprovação interna registrada. A cobrança aguarda emissão futura."
          : tipo === "calcular"
            ? "Cálculo concluído. Confira o demonstrativo abaixo."
            : "Conferência salva.",
      );
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      consulta.atualizar();
      setOcupado(false);
    }
  }
  function mudar(chave: string, valor: string) {
    setDados((anterior) => ({ ...anterior, [chave]: valor }));
    setAlterado(true);
    setConferido(false);
  }
  function campo(
    chave: string,
    rotulo: string,
    tipo = "text",
    placeholder = "",
  ) {
    return (
      <label>
        {rotulo}
        <input
          type={tipo}
          value={dados[chave] ?? ""}
          maxLength={80}
          placeholder={placeholder}
          inputMode={tipo === "text" ? "decimal" : undefined}
          onChange={(e) => mudar(chave, e.target.value)}
        />
      </label>
    );
  }
  const uc = (dados.uc ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const unidade =
    selecionado?.status === aprovada && selecionado.memoria
      ? selecionado.memoria.unidade
      : unidades.dados?.find((u) => u.uc === uc);
  const contrato =
    selecionado?.status === aprovada && selecionado.memoria
      ? selecionado.memoria.contrato
      : unidade?.contratos
          ?.filter((c) => c.inicio <= (dados.competencia ?? ""))
          .sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
  const referencias =
    consulta.dados?.filter(
      (d) =>
        d.id !== selecionado?.id &&
        d.lote === selecionado?.lote &&
        d.status === aprovada &&
        d.memoria?.contrato.modalidade === "GDI",
    ) ?? [];
  const memoria = !alterado ? selecionado?.memoria : null;
  const bloqueado = ocupado || nivel < 2 || selecionado?.status === aprovada;
  const lista = (recebimentos.dados ?? []).filter(
    (r) =>
      (!filtro || r.resultado === filtro) &&
      `${r.nome} ${r.lote} ${r.dados?.uc ?? ""} ${r.motivo}`
        .toLowerCase()
        .includes(busca.toLowerCase()),
  );
  const preenchidos = [
    dados.uc,
    dados.competencia,
    dados.injecao,
    dados.total_equatorial,
    dados.vencimento_equatorial,
    dados.vencimento_ecosol,
    dados.origem_tarifa === "referencia"
      ? dados.referencia_id
      : dados.unitario && dados.bandeira !== undefined && dados.bandeira !== "",
    unidade,
    contrato,
  ].filter(Boolean).length;
  const etapa =
    selecionado?.status === aprovada ? 4 : memoria ? 3 : selecionado ? 2 : 1;
  const totalRecebidas =
    recebimentos.dados?.filter((r) => r.resultado === "Recebida").length ?? 0;
  const totalAtencao =
    recebimentos.dados?.filter((r) => r.resultado !== "Recebida").length ?? 0;
  const totalAprovadas =
    consulta.dados?.filter((d) => d.status === aprovada).length ?? 0;

  return (
    <>
      <div className="faturamento-contexto" role="note">
        <span aria-hidden="true">☀</span>
        <div>
          <strong>Conferência interna</strong>
          <p>
            Revise o PDF, calcule e aprove o valor. A emissão pelo Sicoob ainda
            não acontece nesta tela.
          </p>
        </div>
      </div>
      <ol className="faturamento-etapas" aria-label="Etapas da preparação">
        {["Receber PDF", "Conferir dados", "Calcular", "Aprovar"].map(
          (nome, indice) => (
            <li
              className={
                indice + 1 < etapa
                  ? "concluida"
                  : indice + 1 === etapa
                    ? "atual"
                    : ""
              }
              key={nome}
            >
              <span>{indice + 1}</span>
              <strong>{nome}</strong>
            </li>
          ),
        )}
      </ol>
      <div className="faturamento-indicadores" aria-label="Resumo das faturas">
        <span>
          <strong>{recebimentos.dados?.length ?? 0}</strong> recebidas
        </span>
        <span className="correto">
          <strong>{totalRecebidas}</strong> prontas
        </span>
        <span className={totalAtencao ? "atencao" : ""}>
          <strong>{totalAtencao}</strong> com atenção
        </span>
        <span className="solar">
          <strong>{totalAprovadas}</strong> aprovadas
        </span>
      </div>
      {nivel >= 2 && (
        <form className="faturamento-importacao" onSubmit={importar}>
          <div>
            <span className="faturamento-passo">1</span>
            <h2>Adicionar fatura</h2>
            <p>
              Informe o lote e selecione o PDF da Equatorial. O arquivo original
              fica preservado.
            </p>
          </div>
          <fieldset className="admin-campos" disabled={ocupado}>
            <label>
              Lote de processamento
              <input
                name="lote"
                placeholder="Ex.: Setembro 2026 — Goiás"
                maxLength={80}
                required
              />
            </label>
            <label className="faturamento-arquivo">
              <span>Arquivo PDF · até 10 MB</span>
              <input
                name="pdf"
                type="file"
                accept="application/pdf,.pdf"
                required
              />
            </label>
          </fieldset>
          <button className="admin-botao" disabled={ocupado}>
            {ocupado ? "Lendo PDF…" : "Adicionar à fila"}
          </button>
        </form>
      )}
      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
      <EstadoDaConsulta {...recebimentos} repetir={recebimentos.atualizar} />
      <EstadoDaConsulta {...unidades} repetir={unidades.atualizar} />
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
      <div className="faturamento-bancada">
        <aside className="faturamento-fila" aria-label="Fila de faturas">
          <header>
            <div>
              <span className="admin-sobretitulo">Fila de trabalho</span>
              <h2>Faturas recebidas</h2>
            </div>
            <strong>{lista.length}</strong>
          </header>
          <div className="faturamento-filtros">
            <input
              aria-label="Buscar fatura enviada"
              placeholder="Buscar por nome, lote ou UC"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <select
              aria-label="Filtrar resultado do envio"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            >
              <option value="">Todos os estados</option>
              <option value="Recebida">Prontas para revisar</option>
              <option value="Requer atenção">Requerem atenção</option>
              <option value="Erro">Com erro</option>
            </select>
          </div>
          <div className="faturamento-lista" role="list">
            {lista.map((r) => (
              <article
                className={`faturamento-item ${r.resultado === "Recebida" ? "correto" : r.resultado === "Erro" ? "erro" : "atencao"} ${selecionado?.id === r.documento_id ? "selecionado" : ""}`}
                key={r.id}
                role="listitem"
              >
                <span className="faturamento-estado-icone" aria-hidden="true">
                  {r.resultado === "Recebida"
                    ? "✓"
                    : r.resultado === "Erro"
                      ? "!"
                      : "i"}
                </span>
                <div className="faturamento-item-arquivo">
                  <strong title={r.nome}>{r.nome}</strong>
                  <span>{r.lote}</span>
                </div>
                <span
                  className={`faturamento-situacao ${r.resultado === "Recebida" ? "correto" : r.resultado === "Erro" ? "erro" : "atencao"}`}
                >
                  {r.resultado === "Recebida" ? "Pronta" : r.resultado}
                </span>
                <div className="faturamento-item-estado">
                  <span>{r.motivo}</span>
                  <small>
                    UC {r.dados?.uc || "não identificada"} ·{" "}
                    {r.dados?.competencia || "competência pendente"}
                  </small>
                </div>
                {r.documento_id ? (
                  <button
                    type="button"
                    className="faturamento-abrir"
                    disabled={ocupado}
                    onClick={() => abrir(r.documento_id!)}
                    aria-label={`Revisar ${r.nome}`}
                  >
                    {selecionado?.id === r.documento_id
                      ? "Em revisão"
                      : r.codigo === "duplicada"
                        ? "Abrir original"
                        : "Revisar"}
                    <span aria-hidden="true">→</span>
                  </button>
                ) : (
                  <span className="faturamento-sem-acao">
                    Envie outro PDF para continuar
                  </span>
                )}
              </article>
            ))}
            {!lista.length && (
              <div className="faturamento-fila-vazia">
                <span aria-hidden="true">☀</span>
                <strong>Nenhuma fatura encontrada</strong>
                <p>Altere os filtros ou adicione um PDF acima.</p>
              </div>
            )}
          </div>
        </aside>
        <section className="faturamento-revisao" aria-live="polite">
          {!selecionado ? (
            <div className="faturamento-selecione">
              <span aria-hidden="true">↗</span>
              <h2>Selecione uma fatura</h2>
              <p>
                Escolha “Revisar” na fila. Os dados extraídos e o PDF ficarão
                reunidos aqui.
              </p>
            </div>
          ) : (
            <>
              <header className="faturamento-revisao-cabecalho">
                <div>
                  <span className="admin-sobretitulo">
                    Conferência #{selecionado.id}
                  </span>
                  <h2>{selecionado.nome}</h2>
                  <p>Lote: {selecionado.lote}</p>
                </div>
                <div className="faturamento-revisao-opcoes">
                  <span className="admin-status">{selecionado.status}</span>
                  <a
                    className="admin-botao secundario"
                    href={`${base}/${selecionado.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir PDF
                  </a>
                  <button
                    className="faturamento-fechar"
                    disabled={ocupado}
                    onClick={() => setSelecionado(null)}
                    aria-label="Fechar conferência"
                  >
                    ×
                  </button>
                </div>
              </header>
              <div className="faturamento-qualidade">
                <div>
                  <strong>{preenchidos}/9 itens prontos</strong>
                  <span>Inclui cadastro, contrato, tarifa e vencimentos</span>
                </div>
                <progress value={preenchidos} max="9" />
                {selecionado.extracao.qualidade && (
                  <small>
                    Leitura do PDF:{" "}
                    {selecionado.extracao.qualidade.campos_identificados}/
                    {selecionado.extracao.qualidade.campos_esperados} campos
                    reconhecidos
                    {selecionado.extracao.qualidade.pendencias.length
                      ? ` · confira ${selecionado.extracao.qualidade.pendencias.join(", ")}`
                      : " · leitura completa"}
                  </small>
                )}
              </div>
              {selecionado.extracao.avisos.map((aviso, i) => (
                <p className="admin-aviso" key={i}>
                  {aviso}
                </p>
              ))}
              <div className="faturamento-conferencia">
                <section className="faturamento-grupo">
                  <div className="faturamento-grupo-titulo">
                    <span>01</span>
                    <div>
                      <h3>Identificação e consumo</h3>
                      <p>Compare estes dados diretamente com o PDF.</p>
                    </div>
                  </div>
                  <fieldset className="admin-campos" disabled={bloqueado}>
                    {campo("uc", "Unidade consumidora")}
                    {campo("competencia", "Competência", "month")}
                    {campo(
                      "injecao",
                      "Injeção SCEE (kWh)",
                      "text",
                      "Ex.: 1660",
                    )}
                    {campo(
                      "total_equatorial",
                      "Total a pagar Equatorial (R$)",
                      "text",
                      "Ex.: 302,40",
                    )}
                  </fieldset>
                </section>
                <section className="faturamento-grupo">
                  <div className="faturamento-grupo-titulo">
                    <span>02</span>
                    <div>
                      <h3>Contrato e tarifa</h3>
                      <p>Confirme a regra aplicada ao cliente.</p>
                    </div>
                  </div>
                  <fieldset className="admin-campos" disabled={bloqueado}>
                    {campo(
                      "ajuste_gdii",
                      "Ajuste GDII (R$; informe 0 para GDI)",
                      "text",
                      "Ex.: 290,71",
                    )}
                    {campo(
                      "vencimento_equatorial",
                      "Vencimento Equatorial",
                      "date",
                    )}
                    {campo(
                      "vencimento_ecosol",
                      "Vencimento Ecosol — confirmar manualmente",
                      "date",
                    )}
                    <label>
                      Origem da tarifa
                      <select
                        value={dados.origem_tarifa ?? "propria"}
                        onChange={(e) => mudar("origem_tarifa", e.target.value)}
                      >
                        <option value="propria">
                          Componentes conferidos nesta fatura
                        </option>
                        <option value="referencia">
                          GDI aprovada do mesmo lote
                        </option>
                      </select>
                    </label>
                    {dados.origem_tarifa === "referencia" ? (
                      <label>
                        Fatura GDI de referência
                        <select
                          value={dados.referencia_id ?? ""}
                          onChange={(e) =>
                            mudar("referencia_id", e.target.value)
                          }
                        >
                          <option value="">Selecione uma referência</option>
                          {referencias.map((r) => (
                            <option key={r.id} value={r.id}>
                              #{r.id} · UC {r.dados.uc} · R${" "}
                              {r.memoria?.tarifa_completa}/kWh
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <>
                        {campo("unitario", "Unitário com tributos (R$/kWh)")}
                        {campo(
                          "bandeira",
                          "Bandeira (R$/kWh; 0 se confirmada ausência)",
                        )}
                      </>
                    )}
                  </fieldset>
                  <div
                    className={`faturamento-vinculo ${unidade && contrato ? "correto" : "atencao"}`}
                  >
                    {unidade ? (
                      <p>
                        <strong>{unidade.nome}</strong> · Dia preferido:{" "}
                        {unidade.dia_vencimento}.{" "}
                        {contrato
                          ? `${contrato.modalidade} · desconto de ${contrato.desconto}% · vigente desde ${contrato.inicio}.`
                          : "Não há contrato vigente nesta competência."}
                      </p>
                    ) : (
                      <p>
                        Unidade não identificada.{" "}
                        <Link to="/admin/clientes">
                          Cadastre em Clientes → Unidades e contratos.
                        </Link>
                      </p>
                    )}
                  </div>
                </section>
                {!bloqueado && (
                  <section className="faturamento-confirmacao">
                    <div>
                      <span>03</span>
                      <div>
                        <strong>Confirmar dados</strong>
                        <p>
                          Marque após comparar todos os campos com o PDF
                          original.
                        </p>
                      </div>
                    </div>
                    <label className={conferido ? "marcada" : ""}>
                      <input
                        type="checkbox"
                        checked={conferido}
                        onChange={(e) => setConferido(e.target.checked)}
                      />
                      <span>
                        <strong>Conferi esta fatura</strong>
                        UC, consumo, tarifa, contrato e vencimentos estão
                        corretos.
                      </span>
                    </label>
                  </section>
                )}
                <div className="faturamento-acoes">
                  <small>
                    {alterado
                      ? "Existem alterações ainda não salvas."
                      : "Dados sincronizados."}
                  </small>
                  <div>
                    {nivel >= 2 && selecionado.status !== aprovada && (
                      <>
                        <button
                          type="button"
                          className="admin-botao secundario"
                          disabled={ocupado}
                          onClick={() => acao("salvar")}
                        >
                          Salvar conferência
                        </button>
                        <button
                          type="button"
                          className="admin-botao"
                          disabled={ocupado || !conferido}
                          onClick={() => acao("calcular")}
                        >
                          Salvar e calcular
                        </button>
                      </>
                    )}
                    {nivel >= 3 && selecionado.status === "Calculada" && (
                      <button
                        type="button"
                        className="admin-botao"
                        disabled={ocupado || alterado}
                        onClick={() => acao("aprovar")}
                      >
                        Aprovar para emissão futura
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {memoria && (
                <div className="faturamento-demonstrativo">
                  <h3>Demonstrativo interno — sem validade para pagamento</h3>
                  <p>
                    Tarifa completa: R$ {memoria.tarifa_completa}/kWh ·
                    desconto: {memoria.contrato.desconto}% · fonte: fatura #
                    {memoria.fonte.documento_id}
                  </p>
                  <dl>
                    <div>
                      <dt>Consumo com desconto</dt>
                      <dd>{formatarDinheiro(memoria.consumo_centavos)}</dd>
                    </div>
                    <div>
                      <dt>+ Total Equatorial</dt>
                      <dd>{formatarDinheiro(memoria.equatorial_centavos)}</dd>
                    </div>
                    <div>
                      <dt>− Ajuste GDII</dt>
                      <dd>{formatarDinheiro(memoria.ajuste_centavos)}</dd>
                    </div>
                    <div className="faturamento-total">
                      <dt>Valor Ecosol</dt>
                      <dd>{formatarDinheiro(memoria.total_centavos)}</dd>
                    </div>
                  </dl>
                  <p>
                    Vencimento Ecosol:{" "}
                    {memoria.vencimento_ecosol.split("-").reverse().join("/")}
                  </p>
                </div>
              )}
              <details className="admin-historico">
                <summary>Evidências da extração</summary>
                {Object.entries(selecionado.extracao.evidencias).map(
                  ([chave, valor]) => (
                    <p key={chave}>
                      <strong>{chave}:</strong> {valor}
                    </p>
                  ),
                )}
                {selecionado.texto && (
                  <pre className="faturamento-texto">{selecionado.texto}</pre>
                )}
              </details>
              <details className="admin-historico">
                <summary>Histórico de conferência</summary>
                {selecionado.historico?.map((h, i) => (
                  <p key={i}>
                    {h.criado_em} · {h.responsavel} · {h.acao}
                  </p>
                ))}
              </details>
            </>
          )}
        </section>
      </div>
      <details
        className="faturamento-exportacao"
        onToggle={(evento) => setExportacaoAberta(evento.currentTarget.open)}
      >
        <summary>Exportar cálculos conferidos</summary>
        <div>
          <select
            aria-label="Usina da exportação"
            value={usinaExportacao}
            onChange={(e) => setUsinaExportacao(e.target.value)}
          >
            <option value="">Todas as usinas</option>
            {usinas.dados?.map((u) => (
              <option value={u.id} key={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
          <a
            className="admin-botao secundario"
            href={
              "/api/admin/faturamento/planilhas/calculos" +
              (usinaExportacao ? "?usina_id=" + usinaExportacao : "")
            }
          >
            Baixar novo arquivo Excel
          </a>
          <p>
            O arquivo exportado é novo. As planilhas originais não são
            alteradas.
          </p>
        </div>
      </details>
    </>
  );
}
