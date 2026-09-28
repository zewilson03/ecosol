import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import {
  consultarServidor,
  formatarDinheiro,
  usarConsulta,
} from "./comunicacaoComServidor";
import { CabecalhoDoModulo, EstadoDaConsulta } from "./ComponentesDoPainel";
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
  extracao: { avisos: string[]; evidencias: Record<string, string> };
  memoria: Memoria | null;
  texto?: string;
  historico?: { acao: string; responsavel: string; criado_em: string }[];
};
const base = "/api/admin/faturamento/documentos";
const aprovada = "Aprovada — aguardando emissão";

export default function PreparacaoFaturas() {
  const consulta = usarConsulta<Documento[]>(base);
  const unidades = usarConsulta<Unidade[]>("/api/admin/faturamento/unidades");
  const { nivel } = usarAdministrador();
  const usinas =
    usarConsulta<{ id: number; nome: string }[]>("/api/admin/usinas");
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
      setMensagem(
        "PDF importado. Confira os dados sugeridos antes de calcular.",
      );
      form.reset();
    } catch (e) {
      setErro((e as Error).message);
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
        mostrar(d);
      }
      if (tipo !== "salvar") {
        d = await consultarServidor<Documento>(`${base}/${d.id}/${tipo}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versao: d.versao, conferido }),
        });
        mostrar(d);
      }
      mostrar(await consultarServidor<Documento>(`${base}/${d.id}`));
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
      : unidade?.contratos?.find((c) => c.inicio <= (dados.competencia ?? ""));
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
  const lista = (consulta.dados ?? []).filter(
    (d) =>
      (!filtro || d.status === filtro) &&
      `${d.nome} ${d.lote} ${d.dados.uc ?? ""}`
        .toLowerCase()
        .includes(busca.toLowerCase()),
  );

  return (
    <>
      <CabecalhoDoModulo
        titulo="Preparação de cobranças"
        descricao="Importe a fatura Equatorial, confira o cálculo e prepare a cobrança Ecosol."
      />
      <div className="admin-aviso">
        Etapa de conferência: aprovar registra o valor internamente. A emissão
        no Sicoob e o envio ao cliente serão habilitados em uma próxima etapa.
      </div>
      <div className="admin-resumos faturamento-resumos">
        <article>
          <span>Faturas importadas</span>
          <strong>{consulta.dados?.length ?? 0}</strong>
        </article>
        <article>
          <span>Aguardando conferência</span>
          <strong>
            {consulta.dados?.filter((d) => d.status === "Pendente de revisão")
              .length ?? 0}
          </strong>
        </article>
        <article className="solar">
          <span>Aprovadas para emissão futura</span>
          <strong>
            {consulta.dados?.filter((d) => d.status === aprovada).length ?? 0}
          </strong>
        </article>
      </div>
      <section className="admin-cartao">
        <div className="admin-barra">
          <h2>Exportar conferência</h2>
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
            Baixar Excel dos cálculos
          </a>
        </div>
        <p>
          Gera um arquivo novo com os cálculos salvos. Não altera nenhuma
          planilha original.
        </p>
      </section>
      {nivel >= 2 && (
        <form className="admin-formulario" onSubmit={importar}>
          <h2>Importar fatura Equatorial</h2>
          <fieldset className="admin-campos" disabled={ocupado}>
            <label>
              Lote
              <input
                name="lote"
                placeholder="Ex.: Setembro 2026 — Goiás"
                maxLength={80}
                required
              />
            </label>
            <label>
              Fatura em PDF (até 10 MB)
              <input
                name="pdf"
                type="file"
                accept="application/pdf,.pdf"
                required
              />
            </label>
          </fieldset>
          <button className="admin-botao" disabled={ocupado}>
            {ocupado ? "Processando…" : "Importar e ler PDF"}
          </button>
          <p>
            A leitura sugere campos. PDFs digitalizados podem exigir
            preenchimento manual.
          </p>
        </form>
      )}
      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
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
      {selecionado && (
        <section className="admin-cartao">
          <div className="admin-barra">
            <h2>Conferência #{selecionado.id}</h2>
            <a
              className="admin-botao secundario"
              href={`${base}/${selecionado.id}/pdf`}
            >
              Baixar PDF original
            </a>
            <button
              className="admin-botao secundario"
              disabled={ocupado}
              onClick={() => setSelecionado(null)}
            >
              Fechar
            </button>
          </div>
          <p>
            {selecionado.nome} · Lote: {selecionado.lote}
          </p>
          <span className="admin-status">{selecionado.status}</span>
          {selecionado.extracao.avisos.map((aviso, i) => (
            <p className="admin-aviso" key={i}>
              {aviso}
            </p>
          ))}
          <div className="admin-formulario faturamento-conferencia">
            <fieldset className="admin-campos" disabled={bloqueado}>
              {campo("uc", "Unidade consumidora")}
              {campo("competencia", "Competência", "month")}
              {campo("injecao", "Injeção SCEE (kWh)", "text", "Ex.: 1660")}
              {campo(
                "total_equatorial",
                "Total a pagar Equatorial (R$)",
                "text",
                "Ex.: 302,40",
              )}
              {campo(
                "ajuste_gdii",
                "Ajuste GDII (R$; informe 0 para GDI)",
                "text",
                "Ex.: 290,71",
              )}
              {campo("vencimento_equatorial", "Vencimento Equatorial", "date")}
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
                  <option value="referencia">GDI aprovada do mesmo lote</option>
                </select>
              </label>
              {dados.origem_tarifa === "referencia" ? (
                <label>
                  Fatura GDI de referência
                  <select
                    value={dados.referencia_id ?? ""}
                    onChange={(e) => mudar("referencia_id", e.target.value)}
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
            <p>
              Use valores sem separador de milhares. O total Equatorial já
              inclui mínimo, iluminação e encargos.
            </p>
            {!bloqueado && (
              <label className="faturamento-confirmacao">
                <input
                  type="checkbox"
                  checked={conferido}
                  onChange={(e) => setConferido(e.target.checked)}
                />
                Conferi os dados, a tarifa, o contrato e o vencimento com os
                documentos.
              </label>
            )}
            <div className="admin-acoes">
              {nivel >= 2 && selecionado.status !== aprovada && (
                <>
                  <button
                    className="admin-botao secundario"
                    disabled={ocupado}
                    onClick={() => acao("salvar")}
                  >
                    Salvar conferência
                  </button>
                  <button
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
                  className="admin-botao"
                  disabled={ocupado || alterado}
                  onClick={() => acao("aprovar")}
                >
                  Aprovar para emissão futura
                </button>
              )}
            </div>
          </div>
          {memoria && (
            <div className="faturamento-demonstrativo">
              <h3>Demonstrativo interno — sem validade para pagamento</h3>
              <p>
                Tarifa completa: R$ {memoria.tarifa_completa}/kWh · desconto:{" "}
                {memoria.contrato.desconto}% · fonte: fatura #
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
        </section>
      )}
      <section className="admin-cartao">
        <div className="admin-barra">
          <h2>Faturas em preparação</h2>
          <input
            aria-label="Buscar fatura importada"
            placeholder="Arquivo, lote ou UC"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <select
            aria-label="Filtrar preparação"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          >
            <option value="">Todos os estados</option>
            <option>Pendente de revisão</option>
            <option>Calculada</option>
            <option>{aprovada}</option>
          </select>
        </div>
        <div className="admin-tabela">
          <table>
            <thead>
              <tr>
                <th>Fatura / lote</th>
                <th>UC / competência</th>
                <th>Valor Ecosol</th>
                <th>Situação</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.nome}
                    <small>{d.lote}</small>
                  </td>
                  <td>
                    {d.dados.uc || "A conferir"}
                    <small>{d.dados.competencia}</small>
                  </td>
                  <td>
                    {d.memoria
                      ? formatarDinheiro(d.memoria.total_centavos)
                      : "A calcular"}
                  </td>
                  <td>
                    <span className="admin-status">{d.status}</span>
                  </td>
                  <td>
                    <button
                      className="admin-botao secundario"
                      disabled={ocupado}
                      onClick={() => abrir(d.id)}
                    >
                      Conferir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!lista.length && (
          <p>
            Nenhuma fatura encontrada. Importe um PDF para iniciar a
            conferência.
          </p>
        )}
      </section>
    </>
  );
}
