import { FormEvent, useState } from "react";
import { consultarServidor } from "./comunicacaoComServidor";

type Analise = { id: string; aba: string; abas: string[]; linhas: number };
type Linha = {
  linha: number;
  nome: string;
  cpf: string;
  uc: string;
  email: string;
  telefone: string;
  acao: string;
  motivo: string;
};
type Previa = {
  previa_id: string;
  linhas: Linha[];
  resumo: { criar: number; completar: number; conferir: number };
};
const base = "/api/admin/clientes/planilhas";

export default function ImportacaoDadosClientes({
  aoImportar,
}: {
  aoImportar: () => void;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [aba, setAba] = useState("");
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");

  async function analisar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (
      !arquivo ||
      !/\.xlsx$/i.test(arquivo.name) ||
      arquivo.size > 5 * 1024 * 1024
    ) {
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
      setPrevia(
        await consultarServidor<Previa>(`${base}/${analise.id}/previa`, {
          method: "POST",
        }),
      );
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    if (!analise || !previa || !confirmado) return;
    setOcupado(true);
    setErro("");
    try {
      const resultado = await consultarServidor<{
        quantidade: number;
        conferir: number;
      }>(`${base}/${analise.id}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previa_id: previa.previa_id, confirmado: true }),
      });
      setMensagem(
        `${resultado.quantidade} cadastro(s) complementado(s) ou criado(s). ${resultado.conferir} linha(s) seguem para conferência manual.`,
      );
      setPrevia(null);
      setAnalise(null);
      setConfirmado(false);
      aoImportar();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="admin-cartao importacao-cartao">
      <h2>Completar dados de clientes</h2>
      <p>
        Leia uma planilha com Nome e CPF ou UC. E-mails e telefones preenchem
        apenas campos vazios; dados divergentes e mudanças de titularidade ficam
        para conferência manual. Clientes novos são criados sem senha e sem
        acesso ao portal.
      </p>
      <form className="admin-formulario" onSubmit={analisar}>
        <label>
          Planilha de clientes (.xlsx, até 5 MB)
          <input
            type="file"
            accept=".xlsx"
            required
            onChange={(evento) => {
              setArquivo(evento.target.files?.[0] ?? null);
              setAba("");
              setAnalise(null);
              setPrevia(null);
            }}
          />
        </label>
        {analise && (
          <label>
            Aba
            <select
              value={aba}
              onChange={(evento) => {
                setAba(evento.target.value);
                setPrevia(null);
              }}
            >
              {analise.abas.map((nome) => (
                <option key={nome} value={nome}>
                  {nome}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="admin-botao" disabled={ocupado || !arquivo}>
          {ocupado ? "Analisando…" : "Analisar planilha"}
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
            Aba <strong>{analise.aba}</strong>: {analise.linhas} linha(s)
            identificada(s). A leitura ainda não alterou cadastros.
          </p>
          <button
            className="admin-botao secundario"
            type="button"
            disabled={ocupado}
            onClick={gerarPrevia}
          >
            Gerar prévia
          </button>
        </div>
      )}
      {previa && (
        <div className="admin-formulario">
          <h3>Prévia dos dados extraídos</h3>
          <p>
            {previa.resumo.criar} novo(s), {previa.resumo.completar}{" "}
            complemento(s) e {previa.resumo.conferir} para conferência manual.
          </p>
          <div
            className="admin-importacao-linhas"
            role="region"
            aria-label="Linhas de clientes extraídas"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>UC</th>
                  <th>Cliente</th>
                  <th>CPF</th>
                  <th>E-mail</th>
                  <th>Telefone</th>
                  <th>Ação</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {previa.linhas.map((item) => (
                  <tr key={item.linha}>
                    <td>{item.linha}</td>
                    <td>{item.uc || "—"}</td>
                    <td>{item.nome || "—"}</td>
                    <td>{item.cpf || "—"}</td>
                    <td>{item.email || "—"}</td>
                    <td>{item.telefone || "—"}</td>
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
              onChange={(evento) => setConfirmado(evento.target.checked)}
            />
            Conferi a prévia. Linhas de titularidade divergente não serão
            alteradas.
          </label>
          <button
            className="admin-botao"
            type="button"
            disabled={
              ocupado ||
              !confirmado ||
              !(previa.resumo.criar + previa.resumo.completar)
            }
            onClick={confirmar}
          >
            Confirmar dados válidos
          </button>
        </div>
      )}
    </section>
  );
}
