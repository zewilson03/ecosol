import { useState } from "react";
import { EstadoDaConsulta, ListaVazia } from "./ComponentesDoPainel";
import { alterarDados, usarConsulta } from "./comunicacaoComServidor";

type Pagamento = {
  id: number;
  nome: string;
  lote: string;
  criado_em: string;
  dados: {
    uc?: string;
    competencia?: string;
    total_equatorial?: string;
    vencimento_equatorial?: string;
  };
  extracao: {
    finalidade?: {
      motivo: string | null;
      evidencias: { quantidade_itens: number };
    };
  };
  solicitacao_pagamento_id: number | null;
  solicitacao_pagamento_status: string | null;
};

const reais = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default function Pagamentos() {
  const consulta = usarConsulta<Pagamento[]>(
    "/api/admin/faturamento/pagamentos",
  );
  const itens = consulta.dados ?? [];
  const [ocupado, definirOcupado] = useState<number | null>(null);
  const [mensagem, definirMensagem] = useState("");
  const [erro, definirErro] = useState("");

  async function cadastrar(item: Pagamento) {
    if (ocupado !== null) return;
    definirOcupado(item.id);
    definirMensagem("");
    definirErro("");
    try {
      const resultado = (await alterarDados(
        `/api/admin/faturamento/pagamentos/${item.id}/cadastrar`,
        {},
      )) as { atualizada?: boolean; existente?: boolean };
      definirMensagem(
        resultado.atualizada
          ? "Dados da fatura atualizados. Confira o valor e o vencimento antes de enviar para aprovação."
          : resultado.existente
            ? "A solicitação já está atualizada."
            : "Fatura cadastrada na área financeira para conferência.",
      );
      consulta.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirOcupado(null);
    }
  }
  return (
    <section className="admin-cartao">
      <div className="admin-barra">
        <div>
          <h2>Faturas a pagar</h2>
          <small>
            Faturas de clientes e das unidades próprias. O pagamento usa o
            vencimento e o valor integral informados pela distribuidora.
          </small>
        </div>
        <strong>{itens.length} documento(s)</strong>
      </div>
      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
      {mensagem && <p className="admin-aviso sucesso">{mensagem}</p>}
      {erro && (
        <p className="admin-aviso erro" role="alert">
          {erro}
        </p>
      )}
      {!consulta.carregando && !consulta.erro && itens.length === 0 && (
        <ListaVazia texto="Nenhuma fatura foi cadastrada para pagamento." />
      )}
      {itens.length > 0 && (
        <div className="admin-tabela">
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>UC / competência</th>
                <th>Vencimento</th>
                <th>Valor Equatorial</th>
                <th>Identificação</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.nome}</strong>
                    <small>{item.lote}</small>
                  </td>
                  <td>
                    UC {item.dados.uc ?? "a conferir"}
                    <small>
                      {item.dados.competencia ?? "Competência pendente"}
                    </small>
                  </td>
                  <td>{item.dados.vencimento_equatorial ?? "A conferir"}</td>
                  <td>
                    {item.dados.total_equatorial === undefined
                      ? "A conferir"
                      : reais.format(Number(item.dados.total_equatorial))}
                  </td>
                  <td>
                    <strong>Fatura Equatorial</strong>
                    <small>
                      {item.extracao.finalidade?.motivo ===
                      "grandezas_contratadas_com_demanda"
                        ? "Demanda e demanda de geração"
                        : `Consumo SCEE com ${item.extracao.finalidade?.evidencias.quantidade_itens ?? 0} itens`}
                    </small>
                  </td>
                  <td>
                    <div className="admin-acoes">
                      <a
                        className="admin-botao secundario"
                        href={`/api/admin/faturamento/pagamentos/${item.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Abrir PDF
                      </a>
                      {item.solicitacao_pagamento_id && (
                        <small>
                          Cadastrada · {item.solicitacao_pagamento_status}
                        </small>
                      )}
                      {!item.solicitacao_pagamento_id ||
                      !["paga", "cancelada"].includes(
                        item.solicitacao_pagamento_status ?? "",
                      ) ? (
                        <button
                          className="admin-botao"
                          disabled={ocupado !== null}
                          onClick={() => cadastrar(item)}
                          type="button"
                        >
                          {ocupado === item.id
                            ? "Cadastrando..."
                            : item.solicitacao_pagamento_id
                              ? "Revalidar dados"
                              : "Cadastrar pagamento"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
