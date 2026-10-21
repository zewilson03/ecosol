import { useState } from "react";
import { Link } from "react-router-dom";
import {
  consultarServidor,
  usarConsulta,
  formatarDinheiro,
} from "./comunicacaoComServidor";
import { usarAdministrador } from "./EstruturaAdministrativa";

type Item = {
  id: number | string;
  nome: string;
  origem: string;
  documento_id: number | null;
  estado: string;
  motivo: string;
  valor_centavos: number;
  versao: number | null;
  status: string | null;
};
type Lote = {
  lote: string;
  recebido: number;
  aptas: number;
  pendentes: number;
  duplicadas: number;
  valor_centavos: number;
  itens: Item[];
};

export default function LotesFaturamento() {
  const consulta = usarConsulta<Lote[]>("/api/admin/faturamento/lotes");
  const { nivel } = usarAdministrador();
  const [lote, setLote] = useState("");
  const [conferido, setConferido] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const atual = consulta.dados?.find((l) => l.lote === lote);
  const candidatas =
    atual?.itens.filter(
      (i) =>
        i.estado === "apta" && i.versao && i.status === "Pendente de revisão",
    ) ?? [];
  async function calcular() {
    if (!conferido || ocupado || !candidatas.length) return;
    setOcupado(true);
    setMensagem("");
    try {
      const mensagens: string[] = [];
      for (let inicio = 0; inicio < candidatas.length; inicio += 100) {
        const resposta = await consultarServidor<{
          resultados: { id: number; motivo: string }[];
        }>("/api/admin/faturamento/lotes/processar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lote,
            conferido: true,
            itens: candidatas
              .slice(inicio, inicio + 100)
              .map((i) => ({ id: i.documento_id, versao: i.versao })),
          }),
        });
        mensagens.push(
          ...resposta.resultados.map((r) => `#${r.id}: ${r.motivo}`),
        );
      }
      setMensagem(mensagens.join("\n"));
    } catch (erro) {
      setMensagem((erro as Error).message);
    } finally {
      setOcupado(false);
      setConferido(false);
      consulta.atualizar();
    }
  }
  return (
    <section aria-label="Lotes de faturamento">
      <h2>Processamento por lote</h2>
      <p>
        Recebimentos incluem erros e duplicatas. Aptas são candidatas com
        cadastro definitivo; emissão exige aprovação humana. O total soma
        somente cálculos salvos de recebimentos originais aptos.
      </p>
      <label>
        Lote{" "}
        <select
          value={lote}
          disabled={ocupado}
          onChange={(e) => {
            setLote(e.target.value);
            setConferido(false);
            setMensagem("");
          }}
        >
          <option value="">Selecione</option>
          {consulta.dados?.map((l) => (
            <option key={l.lote}>{l.lote}</option>
          ))}
        </select>
      </label>
      <button disabled={ocupado} onClick={consulta.atualizar}>
        Atualizar
      </button>
      {consulta.erro && <p role="alert">{consulta.erro}</p>}
      {consulta.carregando && <p>Carregando lotes…</p>}
      {atual && (
        <>
          <p>
            Recebidas: {atual.recebido} · Aptas: {atual.aptas} · Pendentes:{" "}
            {atual.pendentes} · Duplicadas: {atual.duplicadas} · Valor
            confirmado: {formatarDinheiro(atual.valor_centavos)}
          </p>
          <div className="admin-tabela">
            <table>
              <thead>
                <tr>
                  <th>Arquivo / origem</th>
                  <th>Situação</th>
                  <th>Motivo</th>
                  <th>Valor confirmado</th>
                  <th>Conferência</th>
                </tr>
              </thead>
              <tbody>
                {atual.itens.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.nome} · {i.origem}
                    </td>
                    <td>{i.estado}</td>
                    <td>{i.motivo}</td>
                    <td>{formatarDinheiro(i.valor_centavos)}</td>
                    <td>
                      {i.documento_id && i.versao && (
                        <Link
                          to={`/admin/faturas?etapa=${i.status === "Calculada" ? "aprovar" : "conferir"}&documento=${i.documento_id}`}
                        >
                          Abrir fatura #{i.documento_id}
                        </Link>
                      )}
                      {i.origem === "gmail" && !i.versao && nivel >= 3 && (
                        <Link to="/admin/gmail">Revisar captura / triagem</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nivel >= 2 && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={conferido}
                  disabled={ocupado}
                  onChange={(e) => setConferido(e.target.checked)}
                />
                Conferi os PDFs e dados das {candidatas.length} candidatas ao
                cálculo.
              </label>
              <button
                disabled={ocupado || !conferido || !candidatas.length}
                onClick={calcular}
              >
                {ocupado ? "Processando…" : "Calcular candidatas conferidas"}
              </button>
            </>
          )}
          <p>
            A aprovação permanece individual na etapa Aprovar. Valores já
            calculados ou aprovados são preservados.
          </p>
        </>
      )}
      {mensagem && (
        <pre role="status" style={{ whiteSpace: "pre-wrap" }}>
          {mensagem}
        </pre>
      )}
    </section>
  );
}
