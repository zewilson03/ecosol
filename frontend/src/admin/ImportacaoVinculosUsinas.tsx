import { FormEvent, useState } from "react";
import { consultarServidor } from "./comunicacaoComServidor";

type Usina = { id: number; nome: string };
type Nome = {
  chave: string;
  nome: string;
  quantidade: number;
  usina_id_sugerida: number | null;
  modalidade_sugerida: "GDI" | "GDII" | null;
  ambigua: boolean;
  semelhante_gdii: boolean;
};
type Analise = {
  id: string;
  aba: string;
  abas: { nome: string; cabecalho: number; tem_coluna_usina: boolean }[];
  linhas: number;
  erros: number;
  nomes: Nome[];
};
type Linha = {
  linha: number;
  uc: string;
  uc_antiga: string;
  usina: string;
  cliente: string;
  acao: string;
  motivo: string;
};
type Previa = {
  previa_id: string;
  resumo: Record<string, number>;
  linhas: Linha[];
};
const base = "/api/admin/faturamento/usinas/vinculos";

export default function ImportacaoVinculosUsinas({
  usinas,
  aoImportar,
}: {
  usinas: Usina[];
  aoImportar: () => void;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [aba, setAba] = useState("");
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");

  async function analisar(evento: FormEvent) {
    evento.preventDefault();
    if (!arquivo || arquivo.size > 5 * 1024 * 1024) {
      setErro("Selecione uma planilha .xlsx com até 5 MB.");
      return;
    }
    setOcupado(true);
    setErro("");
    setMensagem("");
    setPrevia(null);
    try {
      const busca = new URLSearchParams({ nome: arquivo.name });
      if (aba) busca.set("aba", aba);
      const resposta = await consultarServidor<Analise>(
        `${base}/analisar?${busca}`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
          body: arquivo,
        },
      );
      setAnalise(resposta);
      setAba(resposta.aba);
      setEscolhas(
        Object.fromEntries(
          resposta.nomes.map((item) => [
            item.chave,
            item.usina_id_sugerida ? String(item.usina_id_sugerida) : "ignorar",
          ]),
        ),
      );
      setConfirmado(false);
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function gerarPrevia() {
    if (!analise) return;
    setOcupado(true);
    setErro("");
    setPrevia(null);
    setConfirmado(false);
    try {
      const resposta = await consultarServidor<Previa>(
        `${base}/${analise.id}/previa`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ escolhas }),
        },
      );
      setPrevia(resposta);
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function importar() {
    if (!analise || !previa || !confirmado) return;
    setOcupado(true);
    setErro("");
    try {
      const resposta = await consultarServidor<{
        quantidade: number;
        usinas_criadas: number;
      }>(`${base}/${analise.id}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previa_id: previa.previa_id, confirmado: true }),
      });
      setMensagem(
        `${resposta.quantidade} UC(s) criada(s), vinculada(s) ou complementada(s); ${resposta.usinas_criadas} usina(s) cadastrada(s). Pendências de transferência não foram alteradas.`,
      );
      setAnalise(null);
      setPrevia(null);
      setConfirmado(false);
      aoImportar();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const criadas =
    analise?.nomes.filter((item) =>
      ["criar", "criar_distinta"].includes(escolhas[item.chave]),
    ) ?? [];
  return (
    <section className="admin-cartao importacao-cartao">
      <h2>Identificar UCs e usinas por planilha</h2>
      <p>
        Leia uma planilha sem alterá-la. O sistema considera a coluna Usina; se
        ela não existir, usa o nome da aba ou do arquivo. Confira os nomes antes
        de confirmar. A UC atual é a referência; a UC antiga é opcional e fica
        associada ao mesmo cadastro. Novas UCs ficam provisórias e não liberam
        cálculo.
      </p>
      <form className="admin-formulario" onSubmit={analisar}>
        <label>
          Planilha (.xlsx, até 5 MB)
          <input
            type="file"
            accept=".xlsx"
            required
            onChange={(e) => {
              setArquivo(e.target.files?.[0] ?? null);
              setAba("");
              setAnalise(null);
              setPrevia(null);
            }}
          />
        </label>
        {analise && (
          <label>
            Aba a analisar
            <select
              value={aba}
              onChange={(e) => {
                setAba(e.target.value);
                setPrevia(null);
              }}
            >
              {analise.abas.map((item) => (
                <option key={item.nome} value={item.nome}>
                  {item.nome} · cabeçalho na linha {item.cabecalho}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="admin-botao" disabled={ocupado || !arquivo}>
          {ocupado
            ? "Analisando…"
            : analise
              ? "Analisar aba escolhida"
              : "Analisar planilha"}
        </button>
      </form>
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
      {analise && (
        <div className="admin-formulario">
          <p>
            Aba <strong>{analise.aba}</strong>: {analise.linhas} linha(s) com
            UC; {analise.erros} erro(s) de leitura. Só UC atual, UC antiga,
            cliente e usina foram separados para esta análise.
          </p>
          <h3>Usinas identificadas</h3>
          {analise.nomes.some((item) => item.chave === "ecosol") && (
            <p className="admin-aviso">
              “Ecosol” não identifica uma usina. Essas UCs ficarão pendentes até
              a usina real ser confirmada.
            </p>
          )}
          <div className="admin-importacao-usinas">
            {analise.nomes.map((item) => (
              <label key={item.chave}>
                <span>
                  {item.nome} · {item.quantidade} UC(s) ·{" "}
                  {item.modalidade_sugerida ?? "usina pendente"}
                </span>
                <select
                  value={escolhas[item.chave] ?? "ignorar"}
                  onChange={(e) => {
                    setEscolhas((anterior) => ({
                      ...anterior,
                      [item.chave]: e.target.value,
                    }));
                    setPrevia(null);
                    setConfirmado(false);
                  }}
                >
                  <option value="ignorar">Não importar estas UCs</option>
                  {usinas
                    .filter((usina) => usina.nome.toLowerCase() !== "ecosol")
                    .map((usina) => (
                      <option key={usina.id} value={usina.id}>
                        Usina existente: {usina.nome}
                      </option>
                    ))}
                  {item.chave !== "ecosol" &&
                    !item.usina_id_sugerida &&
                    !item.ambigua && (
                      <option
                        value={
                          item.semelhante_gdii ? "criar_distinta" : "criar"
                        }
                      >
                        {item.semelhante_gdii
                          ? `Cadastrar “${item.nome}” como usina DISTINTA (GDI)`
                          : `Cadastrar usina “${item.nome}” (localização pendente)`}
                      </option>
                    )}
                </select>
              </label>
            ))}
          </div>
          {criadas.length > 0 && (
            <p className="admin-aviso">
              Serão criadas {criadas.length} usina(s) com localização “A
              confirmar”. Modalidade GDII apenas para São Francisco, Solar Green
              e 2000 Solar; as demais serão GDI, com vigência desde
              outubro/2026.
            </p>
          )}
          <button
            className="admin-botao secundario"
            disabled={ocupado}
            onClick={gerarPrevia}
          >
            Gerar prévia de vínculos
          </button>
        </div>
      )}
      {previa && (
        <div className="admin-formulario">
          <h3>Prévia — nenhuma alteração gravada</h3>
          <p>
            {previa.resumo.criar_uc} UC(s) provisória(s),{" "}
            {previa.resumo.vincular} vínculo(s) existente(s),{" "}
            {previa.resumo.atualizar_uc_antiga} UC(s) antiga(s) a registrar,{" "}
            {previa.resumo.inalteradas} já correto(s),{" "}
            {previa.resumo.conferencia} para conferência manual e{" "}
            {previa.resumo.pendentes} pendência(s) de leitura ou usina.
          </p>
          <div
            className="admin-importacao-linhas"
            role="region"
            aria-label="Linhas da prévia"
          >
            <table>
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>UC atual</th>
                  <th>UC antiga</th>
                  <th>Cliente</th>
                  <th>Usina</th>
                  <th>Ação</th>
                  <th>Observação</th>
                </tr>
              </thead>
              <tbody>
                {previa.linhas.map((item) => (
                  <tr key={item.linha}>
                    <td>{item.linha}</td>
                    <td>{item.uc}</td>
                    <td>{item.uc_antiga || "—"}</td>
                    <td>{item.cliente || "—"}</td>
                    <td>{item.usina}</td>
                    <td>{item.acao.replaceAll("_", " ")}</td>
                    <td>{item.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="admin-confirmacao">
            <input
              type="checkbox"
              checked={confirmado}
              onChange={(e) => setConfirmado(e.target.checked)}
            />
            Conferi clientes, usinas e UCs. Entendo que transferências e linhas
            pendentes não serão aplicadas.
          </label>
          <button
            className="admin-botao"
            disabled={
              ocupado ||
              !confirmado ||
              !(
                previa.resumo.criar_uc +
                previa.resumo.vincular +
                previa.resumo.atualizar_uc_antiga
              )
            }
            onClick={importar}
          >
            Confirmar cadastros e vínculos
          </button>
        </div>
      )}
    </section>
  );
}
