import { useState } from "react";
import {
  CabecalhoDoModulo,
  EstadoDaConsulta,
  ListaVazia,
} from "./ComponentesDoPainel";
import {
  formatarData,
  formatarDinheiro,
  usarConsulta,
} from "./comunicacaoComServidor";

type Fatura = {
  id: number;
  cliente: string;
  referencia: string;
  vencimento: string;
  valor_centavos: number;
  status: string;
};

export default function Faturas() {
  const consulta = usarConsulta<Fatura[]>("/api/admin/faturas");
  const [busca, definirBusca] = useState("");
  const [status, definirStatus] = useState("");
  const faturas = consulta.dados ?? [];
  const filtradas = faturas.filter(
    (fatura) =>
      fatura.cliente.toLowerCase().includes(busca.toLowerCase()) &&
      (!status || fatura.status === status),
  );
  return (
    <>
      <CabecalhoDoModulo
        titulo="Faturas"
        descricao="Consulte as cobranças dos clientes e acompanhe sua situação."
      />
      <section className="admin-cartao">
        <div className="admin-barra">
          <h2>Faturas dos clientes</h2>
          <input
            aria-label="Buscar faturas por cliente"
            placeholder="Buscar cliente"
            value={busca}
            onChange={(evento) => definirBusca(evento.target.value)}
          />
          <select
            aria-label="Filtrar status de faturas"
            value={status}
            onChange={(evento) => definirStatus(evento.target.value)}
          >
            <option value="">Todos os status</option>
            <option>Pendente</option>
            <option>Pago</option>
          </select>
        </div>
        <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
        {!consulta.carregando &&
          !consulta.erro &&
          (faturas.length === 0 ? (
            <ListaVazia texto="As faturas aparecerão aqui quando o módulo de emissão for integrado. Nenhum boleto é emitido nesta etapa." />
          ) : (
            <div className="admin-tabela">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Referência</th>
                    <th>Vencimento</th>
                    <th>Valor</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((fatura) => (
                    <tr key={fatura.id}>
                      <td>{fatura.cliente}</td>
                      <td>{fatura.referencia}</td>
                      <td>{formatarData(fatura.vencimento)}</td>
                      <td>{formatarDinheiro(fatura.valor_centavos)}</td>
                      <td>{fatura.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtradas.length === 0 && (
                <p>Nenhum resultado para esses filtros.</p>
              )}
            </div>
          ))}
      </section>
    </>
  );
}
