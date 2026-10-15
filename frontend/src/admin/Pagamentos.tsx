import { EstadoDaConsulta, ListaVazia } from "./ComponentesDoPainel";
import { usarConsulta } from "./comunicacaoComServidor";

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
};

const reais = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default function Pagamentos() {
  const consulta = usarConsulta<Pagamento[]>("/api/admin/faturamento/pagamentos");
  const itens = consulta.dados ?? [];
  return (
    <section className="admin-cartao">
      <div className="admin-barra">
        <div>
          <h2>Pagamentos das usinas</h2>
          <small>
            Contas próprias da Ecosol. Estes PDFs não geram cobrança nem boleto
            para clientes.
          </small>
        </div>
        <strong>{itens.length} documento(s)</strong>
      </div>
      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
      {!consulta.carregando && !consulta.erro && itens.length === 0 && (
        <ListaVazia texto="Nenhuma conta própria de usina foi identificada." />
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
                    <small>{item.dados.competencia ?? "Competência pendente"}</small>
                  </td>
                  <td>{item.dados.vencimento_equatorial ?? "A conferir"}</td>
                  <td>
                    {item.dados.total_equatorial === undefined
                      ? "A conferir"
                      : reais.format(Number(item.dados.total_equatorial))}
                  </td>
                  <td>
                    {item.extracao.finalidade?.motivo ===
                    "grandezas_contratadas_com_demanda"
                      ? "Demanda e demanda de geração"
                      : `Consumo SCEE com ${item.extracao.finalidade?.evidencias.quantidade_itens ?? 0} itens`}
                  </td>
                  <td>
                    <a
                      className="admin-botao secundario"
                      href={`/api/admin/faturamento/pagamentos/${item.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir PDF
                    </a>
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
