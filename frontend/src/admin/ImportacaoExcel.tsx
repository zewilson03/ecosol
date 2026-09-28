import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { consultarServidor } from "./comunicacaoComServidor";
import { usarAdministrador } from "./EstruturaAdministrativa";
import PlanilhasPorUsina from "./PlanilhasPorUsina";

type Campo = { chave: string; rotulo: string; aliases: string[] };
type Celula = { valor: string; tipo: string };
type Analise = {
  id: string;
  nome: string;
  usina: string;
  abas: { nome: string; total_linhas: number; amostra: Celula[][] }[];
  campos: Campo[];
};
type Previa = {
  previa_id: string;
  validas: number;
  ignoradas: number;
  problemas: number;
  linhas: {
    linha: number;
    status: string;
    mensagem: string;
    dados: Record<string, string>;
  }[];
};
const base = "/api/admin/faturamento/planilhas";
const normal = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export default function ImportacaoExcel({
  aoImportar,
  usinas,
}: {
  aoImportar: () => void;
  usinas: { id: number; nome: string }[];
}) {
  const { nivel } = usarAdministrador();
  const [fonteLocal, setFonteLocal] = useState<{
    arquivo: string;
    usina: string;
    aba: string;
  } | null>(null);
  const [usinaSelecionada, setUsinaSelecionada] = useState("");
  const [correcoes, setCorrecoes] = useState<
    Record<string, Record<string, string>>
  >({});
  const [padroes, setPadroes] = useState({ modalidade: "", inicio: "" });
  const [revisar, setRevisar] = useState(false);
  const [aberto, setAberto] = useState(false),
    [ocupado, setOcupado] = useState(false),
    [erro, setErro] = useState(""),
    [mensagem, setMensagem] = useState("");
  const [analise, setAnalise] = useState<Analise | null>(null),
    [aba, setAba] = useState(""),
    [cabecalho, setCabecalho] = useState(1);
  const [mapa, setMapa] = useState<Record<string, number | string>>({}),
    [previa, setPrevia] = useState<Previa | null>(null),
    [confirma, setConfirma] = useState(false);
  const sheet = analise?.abas.find((a) => a.nome === aba);
  const colunas = sheet?.amostra[cabecalho - 1] ?? [];
  function escolher(a: Analise, nome: string, linha: number) {
    const headers =
        a.abas.find((s) => s.nome === nome)?.amostra[linha - 1] ?? [],
      m: Record<string, number | string> = {};
    for (const c of a.campos) {
      const novas = headers
        .map((h, i) => (normal(h.valor) === "nova uc" ? i : -1))
        .filter((i) => i >= 0);
      if (c.chave === "uc" && novas.length === 1) {
        m.uc = novas[0];
        continue;
      }
      const ids = headers
        .map((h, i) => (c.aliases.includes(normal(h.valor)) ? i : -1))
        .filter((i) => i >= 0);
      m[c.chave] = ids.length === 1 ? ids[0] : "";
    }
    setAba(nome);
    setCabecalho(linha);
    setMapa(m);
    setCorrecoes({});
    setPadroes({ modalidade: "", inicio: "" });
    setRevisar(false);
    setPrevia(null);
    setConfirma(false);
  }
  async function analisar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    setErro("");
    setMensagem("");
    setPrevia(null);
    setAnalise(null);
    setConfirma(false);
    const f = new FormData(e.currentTarget),
      arquivo = f.get("arquivo") as File;
    try {
      if (fonteLocal) {
        const a = await consultarServidor<Analise>(base + "/analisar-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            arquivo: fonteLocal.arquivo,
            usina_id: usinaSelecionada,
          }),
        });
        setAnalise(a);
        escolher(a, fonteLocal.aba, 1);
        return;
      }
      if (!arquivo?.size || arquivo.size > 5 * 1024 * 1024)
        throw new Error("Selecione um .xlsx com até 5 MB.");
      const query = new URLSearchParams({
        nome: arquivo.name,
        usina_id: String(f.get("usina_id")),
      });
      const a = await consultarServidor<Analise>(base + "/analisar?" + query, {
        method: "POST",
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: arquivo,
      });
      setAnalise(a);
      escolher(a, a.abas[0].nome, 1);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  async function gerarPrevia() {
    setOcupado(true);
    setErro("");
    setConfirma(false);
    setPrevia(null);
    try {
      setPrevia(
        await consultarServidor<Previa>(`${base}/${analise!.id}/previa`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aba, cabecalho, mapa, correcoes, padroes }),
        }),
      );
      setRevisar(false);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  async function importar() {
    setOcupado(true);
    setErro("");
    try {
      const r = await consultarServidor<{ quantidade: number }>(
        `${base}/${analise!.id}/confirmar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            previa_id: previa!.previa_id,
            confirmado: confirma,
          }),
        },
      );
      setMensagem(
        `${r.quantidade} unidade(s) importada(s) para ${analise!.usina}. A planilha original não foi alterada.`,
      );
      setAnalise(null);
      setPrevia(null);
      setConfirma(false);
      aoImportar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <section className="admin-cartao importacao-cartao">
      <div className="admin-barra">
        <h2>Importação de Excel por usina</h2>
        {nivel >= 2 && (
          <button
            className="admin-botao secundario"
            disabled={ocupado}
            onClick={() => setAberto(!aberto)}
          >
            {aberto ? "Recolher importação" : "Importar planilha"}
          </button>
        )}
        <a className="admin-botao secundario" href={base + "/modelo"}>
          Baixar modelo vazio
        </a>
      </div>
      <p>
        Somente leitura do arquivo de origem. Novos cadastros são gravados no
        sistema após sua conferência; registros existentes não são sobrescritos.
      </p>
      {nivel >= 2 && (
        <PlanilhasPorUsina
          bloqueado={ocupado}
          aoPreparar={(fonte) => {
            setFonteLocal(fonte);
            setAberto(true);
            setAnalise(null);
            setPrevia(null);
            setConfirma(false);
            setErro("");
            const chave = (s: string) => normal(s).replace(/^usina /, "");
            const candidatas = usinas.filter(
              (u) => chave(u.nome) === chave(fonte.usina),
            );
            setUsinaSelecionada(
              candidatas.length === 1 ? String(candidatas[0].id) : "",
            );
          }}
        />
      )}
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
      {aberto && nivel >= 2 && (
        <>
          <form className="admin-formulario" onSubmit={analisar}>
            <fieldset className="admin-campos" disabled={ocupado}>
              <label>
                Usina desta planilha
                <select
                  name="usina_id"
                  required
                  value={usinaSelecionada}
                  onChange={(e) => {
                    setUsinaSelecionada(e.target.value);
                    setAnalise(null);
                    setPrevia(null);
                    setConfirma(false);
                  }}
                >
                  <option value="">Selecione a usina</option>
                  {usinas.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
                </select>
              </label>
              {fonteLocal ? (
                <div>
                  <p>
                    Arquivo selecionado: {fonteLocal.arquivo} · Aba:{" "}
                    {fonteLocal.aba}
                  </p>
                  <p>
                    Confira a associação com a usina cadastrada acima. Se ela
                    ainda não existe,{" "}
                    <Link to="/admin/usinas">
                      cadastre {fonteLocal.usina} em Usinas
                    </Link>
                    .
                  </p>
                  <button
                    type="button"
                    className="admin-botao secundario"
                    onClick={() => {
                      setFonteLocal(null);
                      setAnalise(null);
                      setPrevia(null);
                    }}
                  >
                    Escolher outro arquivo manualmente
                  </button>
                </div>
              ) : (
                <label>
                  Arquivo Excel (.xlsx, até 5 MB)
                  <input type="file" name="arquivo" accept=".xlsx" required />
                </label>
              )}
            </fieldset>
            {!usinas.length && (
              <p>
                <Link to="/admin/usinas">
                  Cadastre a usina antes de importar.
                </Link>
              </p>
            )}
            <button
              className="admin-botao"
              disabled={ocupado || !usinas.length}
            >
              {ocupado ? "Processando…" : "Analisar planilha"}
            </button>
          </form>
          {analise && (
            <div className="admin-formulario">
              <h3>
                {analise.nome} · {analise.usina}
              </h3>
              <fieldset className="admin-campos" disabled={ocupado}>
                <label>
                  Aba
                  <select
                    value={aba}
                    onChange={(e) => escolher(analise, e.target.value, 1)}
                  >
                    {analise.abas.map((a) => (
                      <option key={a.nome}>{a.nome}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Linha dos títulos das colunas
                  <select
                    value={cabecalho}
                    onChange={(e) =>
                      escolher(analise, aba, Number(e.target.value))
                    }
                  >
                    {sheet?.amostra.map((_, i) => (
                      <option value={i + 1} key={i}>
                        {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>
              <p>
                Associe nome e UC às colunas. Campos ausentes podem ser
                completados na prévia, sem alterar a planilha.
              </p>
              <fieldset className="admin-campos" disabled={ocupado}>
                {analise.campos.map((c) => (
                  <label key={c.chave}>
                    {c.rotulo}
                    <select
                      value={mapa[c.chave] ?? ""}
                      onChange={(e) => {
                        setMapa({
                          ...mapa,
                          [c.chave]:
                            e.target.value === "" ? "" : Number(e.target.value),
                        });
                        setPrevia(null);
                        setCorrecoes({});
                        setRevisar(false);
                        setConfirma(false);
                      }}
                    >
                      <option value="">Preencher no sistema</option>
                      {colunas.map((col, i) => (
                        <option value={i} key={i}>
                          Coluna {i + 1}: {col.valor || "Sem título"}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </fieldset>
              <fieldset className="admin-campos" disabled={ocupado}>
                <label>
                  Modalidade quando não houver coluna
                  <select
                    value={padroes.modalidade}
                    onChange={(e) => {
                      setPadroes({ ...padroes, modalidade: e.target.value });
                      setPrevia(null);
                      setConfirma(false);
                    }}
                  >
                    <option value="">Conferir por unidade</option>
                    <option>GDI</option>
                    <option>GDII</option>
                  </select>
                </label>
                <label>
                  Vigência contratual quando não houver coluna
                  <input
                    type="month"
                    value={padroes.inicio}
                    onChange={(e) => {
                      setPadroes({ ...padroes, inicio: e.target.value });
                      setPrevia(null);
                      setConfirma(false);
                    }}
                  />
                </label>
              </fieldset>
              <details>
                <summary>Ver amostra da aba</summary>
                <div className="admin-tabela">
                  <table>
                    <thead>
                      <tr>
                        <th>Linha</th>
                        {colunas.map((c, i) => (
                          <th key={i}>{c.valor || `Coluna ${i + 1}`}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet?.amostra
                        .slice(cabecalho, cabecalho + 5)
                        .map((l, r) => (
                          <tr key={r}>
                            <td>{cabecalho + r + 1}</td>
                            {l.map((c, i) => (
                              <td key={i}>{c.valor}</td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <button
                className="admin-botao"
                disabled={ocupado}
                onClick={gerarPrevia}
              >
                Validar e mostrar prévia
              </button>
            </div>
          )}
          {previa && (
            <div>
              <p className="admin-aviso">
                {previa.validas} nova(s) válida(s) · {previa.ignoradas} já
                cadastrada(s) · {previa.problemas} com pendência.
              </p>
              <div className="admin-tabela importacao-previa">
                <table>
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Cliente / UC</th>
                      <th>Desconto</th>
                      <th>Situação</th>
                      <th>Detalhe</th>
                      <th>Completar no sistema</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previa.linhas.map((l) => (
                      <tr key={l.linha}>
                        <td>{l.linha}</td>
                        <td>
                          {l.dados.nome}
                          <small>{l.dados.uc}</small>
                        </td>
                        <td>{l.dados.desconto}%</td>
                        <td>{l.status}</td>
                        <td>{l.mensagem}</td>
                        <td>
                          <details>
                            <summary>Conferir dados da linha {l.linha}</summary>
                            {analise?.campos.map((c) => (
                              <label key={c.chave}>
                                {c.rotulo}
                                <input
                                  disabled={ocupado}
                                  maxLength={180}
                                  value={
                                    correcoes[l.linha]?.[c.chave] ??
                                    l.dados[c.chave] ??
                                    ""
                                  }
                                  onChange={(e) => {
                                    setCorrecoes({
                                      ...correcoes,
                                      [l.linha]: {
                                        ...correcoes[l.linha],
                                        [c.chave]: e.target.value,
                                      },
                                    });
                                    setRevisar(true);
                                    setConfirma(false);
                                  }}
                                />
                              </label>
                            ))}
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {revisar && (
                <p className="admin-aviso">
                  Há dados complementados. Valide novamente antes de confirmar a
                  importação.
                </p>
              )}
              <button
                className="admin-botao secundario"
                disabled={ocupado}
                onClick={gerarPrevia}
              >
                Validar complementos e atualizar prévia
              </button>
              <label className="importacao-confirmacao">
                <input
                  type="checkbox"
                  checked={confirma}
                  disabled={ocupado || revisar || !previa.validas}
                  onChange={(e) => setConfirma(e.target.checked)}
                />
                Conferi a prévia. Importar somente as {previa.validas} linhas
                válidas para {analise?.usina}; as demais não serão gravadas.
              </label>
              <button
                className="admin-botao"
                disabled={ocupado || revisar || !confirma || !previa.validas}
                onClick={importar}
              >
                Confirmar importação no sistema
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
