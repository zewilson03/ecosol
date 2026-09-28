import { useState } from "react";
import { consultarServidor, usarConsulta } from "./comunicacaoComServidor";

type Fonte = { arquivo: string; usina: string };
type Consulta = Fonte & {
  hash: string;
  abas: {
    nome: string;
    total_linhas: number;
    amostra: { valor: string; tipo: string }[][];
  }[];
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
      setAba("");
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
          <label className="planilhas-aba">
            Escolha o mês
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
