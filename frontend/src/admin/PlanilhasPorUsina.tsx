import { useState } from "react";
import { consultarServidor, usarConsulta } from "./comunicacaoComServidor";

type Fonte = { arquivo: string; usina: string };
type Estrutura = {
  compativel: boolean;
  motivo: string;
  aba?: string;
  cabecalho?: number;
  modelo?: string;
  linhas?: number;
  linhas_pendentes?: number;
  linhas_preenchidas?: number;
  problemas: string[];
  ucs_repetidas?: string[];
};
type Consulta = Fonte & {
  hash: string;
  abas: {
    nome: string;
    total_linhas: number;
    amostra: { valor: string; tipo: string }[][];
  }[];
  estrutura: Estrutura;
};
type Diagnostico = {
  total: number;
  prontas: number;
  problemas: number;
  duplicadas: { uc: string; usinas: string[] }[];
  itens: (Fonte & Estrutura)[];
};
const base = "/api/admin/faturamento/planilhas";

export default function PlanilhasPorUsina({
  aoPreparar,
  bloqueado,
}: {
  aoPreparar: (fonte: Fonte & { aba: string }) => void;
  bloqueado: boolean;
}) {
  const catalogo = usarConsulta<Fonte[]>(base + "/pasta");
  const [arquivo, setArquivo] = useState("");
  const [busca, setBusca] = useState("");
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [aba, setAba] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [diagnostico, setDiagnostico] = useState<Diagnostico | null>(null);
  const fontes = catalogo.dados ?? [];
  const fonteSelecionada = fontes.find((f) => f.arquivo === arquivo);
  const fontesFiltradas = fontes
    .filter((f) => f.usina.toLowerCase().includes(busca.trim().toLowerCase()))
    .slice(0, 7);
  const sheet = consulta?.abas.find((a) => a.nome === aba);
  async function abrir() {
    setOcupado(true);
    setErro("");
    setConsulta(null);
    try {
      const resultado = await consultarServidor<Consulta>(
        base + "/consultar-local",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ arquivo }),
        },
      );
      setConsulta(resultado);
      setAba(resultado.estrutura.aba ?? "");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  async function validarPasta() {
    setOcupado(true);
    setErro("");
    try {
      setDiagnostico(
        await consultarServidor<Diagnostico>(base + "/pasta/diagnostico"),
      );
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <section className="planilhas-painel">
      <div className="planilhas-cabecalho">
        <span className="planilhas-icone" aria-hidden="true">
          ☀
        </span>
        <div>
          <span className="admin-legenda">FONTE DE DADOS</span>
          <h3>Planilhas por usina</h3>
        </div>
      </div>
      <p className="planilhas-descricao">
        Os nomes abaixo vêm dos arquivos da pasta 00 - Planilhas Atualizadas. A
        consulta não altera a planilha nem cadastra clientes.
      </p>
      <div className="planilhas-validacao-geral">
        <div>
          <strong>Validação prévia da pasta</strong>
          <span>
            Confere estrutura, abas mensais e UCs repetidas antes de importar.
          </span>
        </div>
        <button
          type="button"
          className="admin-botao secundario"
          disabled={ocupado}
          onClick={validarPasta}
        >
          {ocupado ? "Validando…" : "Validar todas as planilhas"}
        </button>
      </div>
      {diagnostico && (
        <div className="planilhas-diagnostico">
          <div className="planilhas-diagnostico-resumo">
            <span>
              <strong>{diagnostico.total}</strong> planilhas
            </span>
            <span className="correto">
              <strong>{diagnostico.prontas}</strong> prontas
            </span>
            <span className={diagnostico.problemas ? "erro" : "correto"}>
              <strong>{diagnostico.problemas}</strong> com problema
            </span>
            <span
              className={diagnostico.duplicadas.length ? "atencao" : "correto"}
            >
              <strong>{diagnostico.duplicadas.length}</strong> UCs em mais de
              uma usina
            </span>
          </div>
          <div className="planilhas-diagnostico-lista">
            {diagnostico.itens.map((item) => (
              <article
                className={item.compativel ? "correto" : "erro"}
                key={item.arquivo}
              >
                <span>{item.compativel ? "✓" : "!"}</span>
                <div>
                  <strong>{item.usina}</strong>
                  <small>
                    {item.aba
                      ? `${item.aba} · ${item.modelo} · ${item.linhas} linhas (${item.linhas_pendentes} pendentes)`
                      : item.arquivo}
                  </small>
                  <p>{item.motivo}</p>
                  {!!item.problemas.length && <p>{item.problemas[0]}</p>}
                </div>
              </article>
            ))}
          </div>
          {!!diagnostico.duplicadas.length && (
            <details>
              <summary>Ver UCs encontradas em mais de uma usina</summary>
              {diagnostico.duplicadas.map((item) => (
                <p key={item.uc}>
                  UC {item.uc}: {item.usinas.join(" e ")}
                </p>
              ))}
            </details>
          )}
        </div>
      )}
      {(erro || catalogo.erro) && (
        <p role="alert" className="admin-aviso erro">
          {erro || catalogo.erro}
        </p>
      )}
      <div className="planilhas-seletor">
        <label htmlFor="busca-planilha-usina">Buscar usina</label>
        <div className="planilhas-busca">
          <span aria-hidden="true">⌕</span>
          <input
            id="busca-planilha-usina"
            type="search"
            autoComplete="off"
            placeholder="Digite o nome da usina"
            value={busca}
            disabled={ocupado}
            onChange={(e) => {
              setBusca(e.target.value);
              setArquivo("");
              setConsulta(null);
              setErro("");
            }}
          />
        </div>
        {busca.trim() && !arquivo && (
          <div
            className="planilhas-resultados"
            role="listbox"
            aria-label="Usinas encontradas"
          >
            {fontesFiltradas.map((f) => (
              <button
                type="button"
                role="option"
                aria-selected="false"
                key={f.arquivo}
                onClick={() => {
                  setArquivo(f.arquivo);
                  setBusca(f.usina);
                  setConsulta(null);
                }}
              >
                <span>{f.usina}</span>
                <small>Planilha disponível</small>
              </button>
            ))}
            {!fontesFiltradas.length && <p>Nenhuma usina encontrada.</p>}
          </div>
        )}
        {fonteSelecionada && (
          <div className="planilhas-selecionada">
            <span>✓</span>
            <div>
              <small>Usina selecionada</small>
              <strong>{fonteSelecionada.usina}</strong>
            </div>
            <button
              type="button"
              aria-label="Limpar seleção"
              onClick={() => {
                setArquivo("");
                setBusca("");
                setConsulta(null);
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>
      <div className="planilhas-acoes">
        <button
          className="admin-botao"
          disabled={ocupado || !arquivo}
          onClick={abrir}
        >
          {ocupado ? "Lendo…" : "Abrir planilha"}
        </button>
        <button
          className="admin-botao secundario compacto"
          disabled={ocupado}
          onClick={catalogo.atualizar}
          aria-label="Atualizar lista de planilhas"
        >
          ↻
        </button>
      </div>
      {consulta && (
        <>
          <div className="planilhas-arquivo">
            <span>Arquivo conectado</span>
            <strong>{consulta.arquivo}</strong>
          </div>
          <div
            className={`planilhas-estrutura ${consulta.estrutura.compativel ? "correto" : "erro"}`}
          >
            <span>{consulta.estrutura.compativel ? "✓" : "!"}</span>
            <div>
              <strong>{consulta.estrutura.motivo}</strong>
              {consulta.estrutura.aba && (
                <small>
                  {consulta.estrutura.aba} · {consulta.estrutura.modelo} ·
                  cabeçalho na linha {consulta.estrutura.cabecalho}
                </small>
              )}
            </div>
          </div>
          <label className="planilhas-aba">
            Aba mensal identificada
            <select value={aba} onChange={(e) => setAba(e.target.value)}>
              <option value="">Escolha a aba que deseja conferir</option>
              {consulta.abas.map((a) => (
                <option key={a.nome} value={a.nome}>
                  {a.nome}
                </option>
              ))}
            </select>
          </label>
          {sheet && (
            <>
              <button
                className="admin-botao"
                disabled={bloqueado || ocupado}
                onClick={() =>
                  aoPreparar({
                    arquivo: consulta.arquivo,
                    usina: consulta.usina,
                    aba,
                  })
                }
              >
                Preparar importação desta aba
              </button>
              <p>
                Amostra das primeiras {sheet.amostra.length} linhas. Fórmulas
                ficam sinalizadas para conferência; seus resultados não são
                assumidos como valores de cobrança.
              </p>
              <div className="admin-tabela importacao-previa">
                <table>
                  <thead>
                    <tr>
                      <th>Linha</th>
                      {sheet.amostra[0]?.map((_, i) => (
                        <th key={i}>Coluna {i + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.amostra.map((r, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        {r.map((c, j) => (
                          <td key={j}>{c.valor}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
