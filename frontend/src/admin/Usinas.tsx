import { useState } from "react";
import {
  CabecalhoDoModulo,
  EstadoDaConsulta,
  ListaVazia,
} from "./ComponentesDoPainel";
import { usarConsulta } from "./comunicacaoComServidor";

type Usina = {
  id: number;
  nome: string;
  localizacao: string;
  potencia_kw: number;
  status: string;
};

export default function Usinas() {
  const consulta = usarConsulta<Usina[]>("/api/admin/usinas");
  const [busca, definirBusca] = useState("");
  const usinas = consulta.dados ?? [];
  const filtradas = usinas.filter((usina) =>
    (usina.nome + usina.localizacao)
      .toLowerCase()
      .includes(busca.toLowerCase()),
  );
  return (
    <>
      <CabecalhoDoModulo
        titulo="Usinas"
        descricao="Uma visão das unidades que produzem a nossa energia."
      />
      <div className="admin-resumos">
        <article>
          <span>Usinas cadastradas</span>
          <strong>{usinas.length}</strong>
          <small>Unidades no sistema</small>
        </article>
        <article>
          <span>Potência instalada</span>
          <strong>
            {usinas
              .reduce((total, usina) => total + usina.potencia_kw, 0)
              .toLocaleString("pt-BR")}{" "}
            <small>kW</small>
          </strong>
          <small>Capacidade das unidades cadastradas</small>
        </article>
      </div>
      <section className="admin-cartao">
        <div className="admin-barra">
          <h2>Suas usinas</h2>
          <input
            aria-label="Buscar usinas"
            placeholder="Buscar nome ou localização"
            value={busca}
            onChange={(evento) => definirBusca(evento.target.value)}
          />
        </div>
        <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
        {!consulta.carregando &&
          !consulta.erro &&
          (usinas.length === 0 ? (
            <ListaVazia texto="O módulo está preparado para receber as usinas. O cadastro e a integração de geração serão adicionados na próxima etapa." />
          ) : filtradas.length === 0 ? (
            <p>Nenhuma usina corresponde à busca.</p>
          ) : (
            <div className="admin-grade">
              {filtradas.map((usina) => (
                <article className="admin-usina" key={usina.id}>
                  <span>☀</span>
                  <h3>{usina.nome}</h3>
                  <p>{usina.localizacao}</p>
                  <strong>{usina.potencia_kw} kW</strong>
                  <small>{usina.status}</small>
                </article>
              ))}
            </div>
          ))}
      </section>
    </>
  );
}
