import { FormEvent, useState } from "react";
import { consultarServidor, usarConsulta } from "./comunicacaoComServidor";
import { EstadoDaConsulta } from "./ComponentesDoPainel";
import { usarAdministrador } from "./EstruturaAdministrativa";
import ImportacaoExcel from "./ImportacaoExcel";

export type Contrato = {
  id: number;
  modalidade: string;
  desconto: string;
  inicio: string;
};
export type Unidade = {
  usina_id?: number | null;
  usina_nome?: string | null;
  id: number;
  uc: string;
  nome: string;
  documento: string;
  email: string;
  dia_vencimento: number;
  versao: number;
  contratos: Contrato[];
};
const base = "/api/admin/faturamento/unidades";

export default function UnidadesDeCobranca() {
  const consulta = usarConsulta<Unidade[]>(base);
  const usinas =
    usarConsulta<{ id: number; nome: string }[]>("/api/admin/usinas");
  const { nivel } = usarAdministrador();
  const [edicao, setEdicao] = useState<Unidade | "nova" | null>(null);
  const [contrato, setContrato] = useState<Unidade | null>(null);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState("");
  const atual = edicao && edicao !== "nova" ? edicao : null;

  async function salvar(
    evento: FormEvent<HTMLFormElement>,
    novoContrato = false,
  ) {
    evento.preventDefault();
    setOcupado(true);
    setErro("");
    setMensagem("");
    const dados = Object.fromEntries(new FormData(evento.currentTarget));
    try {
      const endereco = novoContrato
        ? `${base}/${contrato!.id}/contratos`
        : atual
          ? `${base}/${atual.id}`
          : base;
      await consultarServidor(endereco, {
        method: !novoContrato && atual ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...dados, versao: atual?.versao }),
      });
      setEdicao(null);
      setContrato(null);
      consulta.atualizar();
      setMensagem(
        "Cadastro salvo. Cobranças já aprovadas permanecem com os dados originais.",
      );
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  function camposContrato() {
    return (
      <>
        <label>
          Modalidade
          <select name="modalidade" required>
            <option value="GDI">GDI</option>
            <option value="GDII">GDII</option>
          </select>
        </label>
        <label>
          Desconto contratado (%)
          <input
            name="desconto"
            inputMode="decimal"
            placeholder="Ex.: 25"
            required
          />
        </label>
        <label>
          Vigente a partir da competência
          <input name="inicio" type="month" required />
        </label>
      </>
    );
  }

  return (
    <>
      <div className="admin-aviso">
        Cadastre os dados de cobrança de cada UC. Um mesmo CPF/CNPJ pode ter
        várias unidades. Este cadastro não cria nem altera acessos ao portal.
      </div>
      <ImportacaoExcel
        aoImportar={consulta.atualizar}
        usinas={usinas.dados ?? []}
      />
      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
      <EstadoDaConsulta {...usinas} repetir={usinas.atualizar} />
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
      <section className="admin-cartao">
        <div className="admin-barra">
          <h2>Unidades e contratos</h2>
          <input
            aria-label="Buscar unidade"
            placeholder="Nome, documento ou UC"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {nivel >= 2 && (
            <button
              className="admin-botao"
              onClick={() => {
                setEdicao("nova");
                setContrato(null);
                setErro("");
              }}
            >
              + Cadastrar unidade
            </button>
          )}
        </div>
        <div className="admin-tabela">
          <table>
            <thead>
              <tr>
                <th>Cliente / UC</th>
                <th>CPF/CNPJ</th>
                <th>Contato / vencimento</th>
                <th>Contratos</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {consulta.dados
                ?.filter((u) =>
                  `${u.nome} ${u.documento} ${u.uc} ${u.usina_nome ?? ""}`
                    .toLowerCase()
                    .includes(busca.toLowerCase()),
                )
                .map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.nome}</strong>
                      <small>UC {u.uc}</small>
                      <small>
                        Usina: {u.usina_nome ?? "Alocação a definir"}
                      </small>
                    </td>
                    <td>{u.documento}</td>
                    <td>
                      {u.email}
                      <small>Dia preferido: {u.dia_vencimento}</small>
                    </td>
                    <td>
                      {u.contratos.map((c) => (
                        <small key={c.id}>
                          {c.inicio}: {c.modalidade} · {c.desconto}%
                        </small>
                      ))}
                    </td>
                    <td>
                      <div className="admin-acoes">
                        {nivel >= 2 && (
                          <button
                            className="admin-botao secundario"
                            disabled={ocupado}
                            onClick={() => {
                              setEdicao(u);
                              setContrato(null);
                            }}
                          >
                            Editar cadastro
                          </button>
                        )}
                        {nivel >= 3 && (
                          <button
                            className="admin-botao secundario"
                            disabled={ocupado}
                            onClick={() => {
                              setContrato(u);
                              setEdicao(null);
                            }}
                          >
                            Nova vigência
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {consulta.dados?.length === 0 && (
          <p>
            Cadastre a primeira unidade para vincular e calcular suas faturas.
          </p>
        )}
      </section>
      {edicao && (
        <form
          className="admin-formulario"
          key={atual?.id ?? "nova"}
          onSubmit={(e) => salvar(e)}
        >
          <h3>{atual ? "Editar unidade" : "Nova unidade e contrato"}</h3>
          <fieldset className="admin-campos" disabled={ocupado}>
            <label>
              Usina de alocação
              <select name="usina_id" defaultValue={atual?.usina_id ?? ""}>
                <option value="">Alocação a definir</option>
                {usinas.dados?.map((u) => (
                  <option value={u.id} key={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nome / razão social
              <input
                name="nome"
                defaultValue={atual?.nome}
                maxLength={160}
                required
              />
            </label>
            <label>
              CPF ou CNPJ
              <input
                name="documento"
                defaultValue={atual?.documento}
                maxLength={18}
                required
              />
            </label>
            <label>
              Unidade consumidora
              <input
                name="uc"
                defaultValue={atual?.uc}
                readOnly={!!atual}
                maxLength={30}
                required
              />
            </label>
            <label>
              E-mail de cobrança
              <input
                name="email"
                type="email"
                defaultValue={atual?.email}
                maxLength={180}
                required
              />
            </label>
            <label>
              Dia preferido de vencimento
              <input
                name="dia_vencimento"
                type="number"
                min={1}
                max={31}
                defaultValue={atual?.dia_vencimento}
                required
              />
            </label>
            {!atual && camposContrato()}
          </fieldset>
          <div className="admin-acoes">
            <button className="admin-botao" disabled={ocupado}>
              {ocupado ? "Salvando…" : "Salvar cadastro"}
            </button>
            <button
              type="button"
              className="admin-botao secundario"
              disabled={ocupado}
              onClick={() => setEdicao(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {contrato && (
        <form className="admin-formulario" onSubmit={(e) => salvar(e, true)}>
          <h3>Nova vigência — {contrato.nome}</h3>
          <p>
            O contrato anterior permanece no histórico. A nova condição vale a
            partir da competência escolhida.
          </p>
          <fieldset className="admin-campos" disabled={ocupado}>
            {camposContrato()}
          </fieldset>
          <div className="admin-acoes">
            <button className="admin-botao" disabled={ocupado}>
              Salvar vigência
            </button>
            <button
              type="button"
              className="admin-botao secundario"
              disabled={ocupado}
              onClick={() => setContrato(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </>
  );
}
