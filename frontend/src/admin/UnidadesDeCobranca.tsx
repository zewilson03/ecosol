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
  origem?: string;
  desconto_inicio?: string;
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
  descontos: { id: number; inicio: string; desconto: string }[];
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
  const [descontoPara, setDescontoPara] = useState<Unidade | null>(null);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState("");
  const atual = edicao && edicao !== "nova" ? edicao : null;
  const unidadesFiltradas = (consulta.dados ?? []).filter((u) =>
    `${u.nome} ${u.documento} ${u.uc} ${u.usina_nome ?? ""}`
      .toLowerCase()
      .includes(busca.toLowerCase()),
  );

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setOcupado(true);
    setErro("");
    setMensagem("");
    const dados = Object.fromEntries(new FormData(evento.currentTarget));
    try {
      await consultarServidor(atual ? `${base}/${atual.id}` : base, {
        method: atual ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...dados, versao: atual?.versao }),
      });
      setEdicao(null);
      consulta.atualizar();
      setMensagem("UC salva. Informe a modalidade ao conferir cada fatura.");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function salvarDesconto(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!descontoPara) return;
    setOcupado(true);
    setErro("");
    setMensagem("");
    try {
      const dados = Object.fromEntries(new FormData(evento.currentTarget));
      await consultarServidor(`${base}/${descontoPara.id}/descontos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...dados, versao: descontoPara.versao }),
      });
      setDescontoPara(null);
      consulta.atualizar();
      setMensagem("Nova vigência de desconto registrada para a UC.");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <div className="admin-aviso">
        Cadastre a UC e o desconto percentual com sua competência inicial. Cada
        mudança do desconto cria uma nova vigência, preservando as anteriores. A
        modalidade será informada em cada fatura; não é necessário cadastrar
        contrato ou vincular uma usina agora. Este cadastro não cria acesso ao
        portal.
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
          <div>
            <h2>Unidades e contratos</h2>
            <small>{unidadesFiltradas.length} unidade(s) encontrada(s)</small>
          </div>
          <input
            aria-label="Buscar unidade"
            placeholder="Nome, documento ou UC"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {busca && (
            <button
              className="admin-botao secundario"
              onClick={() => setBusca("")}
            >
              Limpar
            </button>
          )}
          {nivel >= 2 && (
            <button
              className="admin-botao"
              onClick={() => {
                setEdicao("nova");
                setDescontoPara(null);
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
                <th>Descontos por competência</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {unidadesFiltradas.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.nome}</strong>
                    <small>UC {u.uc}</small>
                    <small>Usina: {u.usina_nome ?? "Alocação a definir"}</small>
                  </td>
                  <td>{u.documento}</td>
                  <td>
                    {u.email}
                    <small>Dia preferido: {u.dia_vencimento}</small>
                  </td>
                  <td>
                    {u.descontos.length === 0 && (
                      <small>Desconto a definir</small>
                    )}
                    {u.descontos.map((d) => (
                      <small key={d.id}>
                        {d.inicio}: {d.desconto}%
                      </small>
                    ))}
                    {u.contratos.map((c) => (
                      <small key={`contrato-${c.id}`}>
                        Contrato anterior {c.inicio}: {c.modalidade} ·{" "}
                        {c.desconto}%
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
                            setDescontoPara(null);
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
                            setDescontoPara(u);
                            setEdicao(null);
                            setErro("");
                          }}
                        >
                          Alterar desconto
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {unidadesFiltradas.length === 0 && (
          <p>
            {busca
              ? "Nenhuma unidade corresponde à busca."
              : "Cadastre a primeira unidade para vincular e calcular suas faturas."}
          </p>
        )}
      </section>
      {edicao && (
        <form
          className="admin-formulario"
          key={atual?.id ?? "nova"}
          onSubmit={(e) => salvar(e)}
        >
          <h3>{atual ? "Editar unidade" : "Nova unidade consumidora"}</h3>
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
            {!atual && (
              <>
                <label>
                  Desconto inicial da UC (%)
                  <input
                    name="desconto"
                    inputMode="decimal"
                    placeholder="Ex.: 25 ou 0"
                    required
                  />
                </label>
                <label>
                  Desconto válido desde a competência
                  <input name="desconto_inicio" type="month" required />
                </label>
              </>
            )}
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
      {descontoPara && (
        <form className="admin-formulario" onSubmit={salvarDesconto}>
          <h3>Alterar desconto — UC {descontoPara.uc}</h3>
          <p>
            Informe a competência a partir da qual a nova taxa vale. As taxas
            anteriores permanecem no histórico; cobranças aprovadas não mudam.
          </p>
          <fieldset className="admin-campos" disabled={ocupado}>
            <label>
              Novo desconto (%)
              <input
                name="desconto"
                inputMode="decimal"
                placeholder="Ex.: 20 ou 0"
                required
              />
            </label>
            <label>
              Vigente a partir da competência
              <input name="inicio" type="month" required />
            </label>
          </fieldset>
          <div className="admin-acoes">
            <button className="admin-botao" disabled={ocupado}>
              Salvar nova vigência
            </button>
            <button
              type="button"
              className="admin-botao secundario"
              disabled={ocupado}
              onClick={() => setDescontoPara(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </>
  );
}
