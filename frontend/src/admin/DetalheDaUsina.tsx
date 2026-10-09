import { Link, useParams } from "react-router-dom";
import { CabecalhoDoModulo, EstadoDaConsulta } from "./ComponentesDoPainel";
import { usarConsulta } from "./comunicacaoComServidor";
import UnidadesDeCobranca from "./UnidadesDeCobranca";

type Usina = {
  id: number;
  nome: string;
  localizacao: string;
  modalidade_atual: "GDI" | "GDII" | null;
};

export default function DetalheDaUsina() {
  const { id } = useParams();
  const usinaId = Number(id);
  const consulta = usarConsulta<Usina[]>("/api/admin/usinas");
  const usina = consulta.dados?.find((item) => item.id === usinaId);
  return (
    <>
      <CabecalhoDoModulo
        titulo={usina?.nome ?? "Usina"}
        descricao="Confira os cadastros, ajuste as UCs e transfira unidades com histórico por competência."
      >
        <Link className="admin-botao secundario" to="/admin/usinas">
          Voltar às usinas
        </Link>
      </CabecalhoDoModulo>
      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
      {!consulta.carregando && !consulta.erro && !usina && (
        <p className="admin-aviso erro">Usina não encontrada.</p>
      )}
      {usina && (
        <>
          <section className="admin-cartao">
            <h2>
              {usina.nome.toLowerCase() === "ecosol"
                ? "Vínculos pendentes"
                : "Dados da usina"}
            </h2>
            <p>
              {usina.nome.toLowerCase() === "ecosol"
                ? "Ecosol é um vínculo provisório. Identifique e transfira cada UC para uma usina real."
                : `${usina.localizacao} · ${usina.modalidade_atual ?? "Modalidade pendente"}`}
            </p>
          </section>
          <UnidadesDeCobranca
            usinaFiltroId={usina.id}
            aoAtualizar={consulta.atualizar}
          />
        </>
      )}
    </>
  );
}
