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
  cliente_id?: number | null;
  cliente_provisorio_id?: number | null;
  cliente_nome?: string | null;
  usina_id?: number | null;
  usina_nome?: string | null;
  id: number;
  uc: string;
  uc_antiga?: string | null;
  nome: string;
  documento: string;
  email: string;
  dia_vencimento: number;
  descontos: { id: number; inicio: string; desconto: string }[];
  versao: number;
  contratos: Contrato[];
  modalidades_usina: { inicio: string; modalidade: "GDI" | "GDII" }[];
  vinculos_usina?: {
    inicio: string;
    usina_id: number;
    usina_nome: string;
    modalidades: { inicio: string; modalidade: "GDI" | "GDII" }[];
  }[];
};
const base = "/api/admin/faturamento/unidades";
const partesCompetencia = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
}).formatToParts(new Date());
const competenciaAtual = `${partesCompetencia.find((p) => p.type === "year")?.value}-${partesCompetencia.find((p) => p.type === "month")?.value}`;

function usinaVigente(unidade: Unidade) {
  const vinculo = unidade.vinculos_usina?.find(
    (item) => item.inicio <= competenciaAtual,
  );
  return vinculo?.usina_id ?? unidade.usina_id;
}

function transferenciaProgramada(unidade: Unidade) {
  return unidade.vinculos_usina?.find((item) => item.inicio > competenciaAtual);
}

export default function UnidadesDeCobranca({
  clienteInicialId = null,
  usinaFiltroId = null,
  aoAtualizar,
}: {
  clienteInicialId?: number | null;
  usinaFiltroId?: number | null;
  aoAtualizar?: () => void;
}) {
  const consulta = usarConsulta<Unidade[]>(base);
  const clientes = usarConsulta<{ id: number; name: string }[]>(
    "/api/admin/faturamento/clientes",
  );
  const usinas =
    usarConsulta<
      { id: number; nome: string; modalidade_atual: string | null }[]
    >("/api/admin/usinas");
  const { nivel } = usarAdministrador();
  const [edicao, setEdicao] = useState<Unidade | "nova" | null>(null);
  const [descontoPara, setDescontoPara] = useState<Unidade | null>(null);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState("");
  const [selecionadas, setSelecionadas] = useState<number[]>([]);
  const [mostrarTransferencia, setMostrarTransferencia] = useState(false);
  const [destinoId, setDestinoId] = useState("");
  const [previaTransferencia, setPreviaTransferencia] = useState<{
    origem: { id: number; nome: string };
    destino: { id: number; nome: string; versao: number };
    linhas: {
      id: number;
      uc: string;
      versao: number;
      inicio: string;
      modalidade: "GDI" | "GDII";
    }[];
  } | null>(null);
  const [chaveTransferencia, setChaveTransferencia] = useState("");
  const atual = edicao && edicao !== "nova" ? edicao : null;
  const unidadesFiltradas = (consulta.dados ?? []).filter(
    (u) =>
      (usinaFiltroId === null || usinaVigente(u) === usinaFiltroId) &&
      `${u.nome} ${u.cliente_nome ?? ""} ${u.documento} ${u.uc} ${u.uc_antiga ?? ""} ${u.usina_nome ?? ""}`
        .toLowerCase()
        .includes(busca.toLowerCase()),
  );
  const usinaSelecionada = usinas.dados?.find((u) => u.id === usinaFiltroId);

  async function gerarPreviaTransferencia() {
    if (usinaFiltroId === null || !destinoId || !selecionadas.length) return;
    setOcupado(true);
    setErro("");
    try {
      const unidades = selecionadas.map((id) => {
        const unidade = consulta.dados?.find((item) => item.id === id);
        if (!unidade)
          throw new Error("Atualize a lista de UCs antes de transferir.");
        return { id, versao: unidade.versao };
      });
      const previa = await consultarServidor<
        NonNullable<typeof previaTransferencia>
      >("/api/admin/faturamento/usinas/transferencias/previa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origem_id: usinaFiltroId,
          destino_id: Number(destinoId),
          unidades,
        }),
      });
      setPreviaTransferencia(previa);
      setChaveTransferencia(crypto.randomUUID());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarTransferencia() {
    if (!previaTransferencia || !chaveTransferencia) return;
    setOcupado(true);
    setErro("");
    try {
      const resultado = await consultarServidor<{ quantidade: number }>(
        "/api/admin/faturamento/usinas/transferencias/confirmar",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chave: chaveTransferencia,
            origem_id: previaTransferencia.origem.id,
            destino_id: previaTransferencia.destino.id,
            destino_versao: previaTransferencia.destino.versao,
            linhas: previaTransferencia.linhas,
            confirmado: true,
          }),
        },
      );
      setMensagem(
        `${resultado.quantidade} UC(s) transferida(s) para ${previaTransferencia.destino.nome}.`,
      );
      setPreviaTransferencia(null);
      setSelecionadas([]);
      setMostrarTransferencia(false);
      setDestinoId("");
      consulta.atualizar();
      aoAtualizar?.();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!clientes.dados) {
      setErro("Carregue a lista de clientes antes de salvar a UC.");
      return;
    }
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
      aoAtualizar?.();
      setMensagem(
        "UC salva. A modalidade virá da usina vinculada; sem usina, continuará pendente de informação manual.",
      );
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
        modalidade vem da usina vinculada, conforme a competência da fatura. UCs
        ainda sem usina continuam com modalidade informada na conferência. Este
        cadastro não cria acesso ao portal. Selecione o cliente do portal no
        formulário da UC para criar um vínculo explícito; clientes com mais de
        uma UC podem ter várias unidades vinculadas.
      </div>
      {clienteInicialId && (
        <p className="admin-aviso">
          Vincule uma UC existente ao cliente selecionado usando “Editar
          cadastro”, ou cadastre uma nova UC. Confira os dados antes de salvar.
        </p>
      )}
      {usinaFiltroId === null && (
        <ImportacaoExcel
          aoImportar={consulta.atualizar}
          usinas={usinas.dados ?? []}
        />
      )}
      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
      <EstadoDaConsulta {...clientes} repetir={clientes.atualizar} />
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
            <h2>
              {usinaFiltroId === null
                ? "Unidades e contratos"
                : `UCs em ${usinaSelecionada?.nome ?? "esta usina"}`}
            </h2>
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
          {nivel >= 2 && usinaSelecionada?.nome.toLowerCase() !== "ecosol" && (
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
        {usinaFiltroId !== null && nivel === 3 && (
          <div className="admin-transferencia-acoes">
            <strong>{selecionadas.length} UC(s) selecionada(s)</strong>
            <small>
              Até 100 UCs por transferência. Use a busca para dividir lotes
              maiores.
            </small>
            {!mostrarTransferencia && (
              <button
                className="admin-botao"
                disabled={
                  ocupado || !selecionadas.length || selecionadas.length > 100
                }
                onClick={() => setMostrarTransferencia(true)}
              >
                Transferir selecionadas
              </button>
            )}
            {mostrarTransferencia && (
              <>
                <label>
                  Transferir para
                  <select
                    value={destinoId}
                    onChange={(e) => {
                      setDestinoId(e.target.value);
                      setPreviaTransferencia(null);
                    }}
                  >
                    <option value="">Selecione a usina de destino</option>
                    {usinas.dados
                      ?.filter(
                        (u) =>
                          u.id !== usinaFiltroId &&
                          u.nome.toLowerCase() !== "ecosol",
                      )
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nome}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="admin-botao"
                  disabled={
                    ocupado ||
                    !destinoId ||
                    !selecionadas.length ||
                    selecionadas.length > 100
                  }
                  onClick={gerarPreviaTransferencia}
                >
                  Conferir transferência
                </button>
              </>
            )}
          </div>
        )}
        {previaTransferencia && (
          <div
            className="admin-transferencia-previa"
            role="dialog"
            aria-label="Confirmar transferência de UCs"
          >
            <h3>Conferir transferência</h3>
            <p>
              {previaTransferencia.origem.nome} →{" "}
              {previaTransferencia.destino.nome}. A modalidade da usina de
              destino valerá somente a partir da próxima competência de cada UC.
              As faturas anteriores não serão alteradas.
            </p>
            <ul>
              {previaTransferencia.linhas.map((linha) => (
                <li key={linha.id}>
                  UC {linha.uc}: desde {linha.inicio.slice(5)}/
                  {linha.inicio.slice(0, 4)} · {linha.modalidade}
                </li>
              ))}
            </ul>
            <div className="admin-acoes">
              <button
                className="admin-botao secundario"
                disabled={ocupado}
                onClick={() => setPreviaTransferencia(null)}
              >
                Cancelar
              </button>
              <button
                className="admin-botao"
                disabled={ocupado}
                onClick={confirmarTransferencia}
              >
                {ocupado ? "Transferindo…" : "Confirmar transferência"}
              </button>
            </div>
          </div>
        )}
        <div className="admin-tabela">
          <table>
            <thead>
              <tr>
                {usinaFiltroId !== null && nivel === 3 && (
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Selecionar todas as UCs exibidas"
                      checked={
                        unidadesFiltradas.some(
                          (u) => !transferenciaProgramada(u),
                        ) &&
                        unidadesFiltradas
                          .filter((u) => !transferenciaProgramada(u))
                          .every((u) => selecionadas.includes(u.id))
                      }
                      onChange={(e) => {
                        const exibidas = unidadesFiltradas
                          .filter((u) => !transferenciaProgramada(u))
                          .map((u) => u.id);
                        setSelecionadas(
                          e.target.checked
                            ? [...new Set([...selecionadas, ...exibidas])]
                            : selecionadas.filter(
                                (id) => !exibidas.includes(id),
                              ),
                        );
                        setPreviaTransferencia(null);
                      }}
                    />
                  </th>
                )}
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
                  {usinaFiltroId !== null && nivel === 3 && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar UC ${u.uc}`}
                        disabled={!!transferenciaProgramada(u)}
                        checked={selecionadas.includes(u.id)}
                        onChange={(e) => {
                          setSelecionadas(
                            e.target.checked
                              ? [...selecionadas, u.id]
                              : selecionadas.filter((id) => id !== u.id),
                          );
                          setPreviaTransferencia(null);
                        }}
                      />
                    </td>
                  )}
                  <td>
                    <strong>{u.nome}</strong>
                    <small>UC {u.uc}</small>
                    {u.uc_antiga && <small>UC antiga {u.uc_antiga}</small>}
                    <small>
                      {u.cliente_provisorio_id
                        ? `Cadastro provisório: ${u.cliente_nome ?? "a conferir"}`
                        : `Portal: ${u.cliente_nome ?? "sem vínculo"}`}
                    </small>
                    <small>
                      Usina:{" "}
                      {u.vinculos_usina
                        ?.find((v) => v.usina_id === usinaVigente(u))
                        ?.usina_nome?.toLowerCase() === "ecosol"
                        ? "Pendente — vínculo provisório Ecosol"
                        : (u.vinculos_usina?.find(
                            (v) => v.usina_id === usinaVigente(u),
                          )?.usina_nome ??
                          u.usina_nome ??
                          "Alocação a definir")}
                    </small>
                    {transferenciaProgramada(u) && (
                      <small>
                        Transferência programada para{" "}
                        {transferenciaProgramada(u)?.usina_nome} em{" "}
                        {transferenciaProgramada(u)?.inicio.slice(5)}/
                        {transferenciaProgramada(u)?.inicio.slice(0, 4)}.
                      </small>
                    )}
                    {u.vinculos_usina && u.vinculos_usina.length > 1 && (
                      <small>
                        Histórico de usinas preservado por competência.
                      </small>
                    )}
                  </td>
                  <td>{u.documento || "Pendente"}</td>
                  <td>
                    {u.email || "E-mail pendente"}
                    <small>
                      Dia preferido: {u.dia_vencimento || "a definir"}
                    </small>
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
          <fieldset
            className="admin-campos"
            disabled={ocupado || !clientes.dados}
          >
            <label>
              Cliente do portal vinculado
              <select
                key={`${atual?.id ?? "nova"}-${clientes.dados?.length ?? "loading"}`}
                name="cliente_id"
                defaultValue={atual?.cliente_id ?? clienteInicialId ?? ""}
              >
                <option value="">Sem vínculo — selecionar depois</option>
                {clientes.dados?.map((cliente) => (
                  <option value={cliente.id} key={cliente.id}>
                    {cliente.name} (#{cliente.id})
                  </option>
                ))}
              </select>
              <small>
                Confirme a identidade do cliente antes de vincular esta UC.
              </small>
            </label>
            <label>
              Usina de alocação
              <select
                name="usina_id"
                defaultValue={atual?.usina_id ?? usinaFiltroId ?? ""}
              >
                <option value="">Alocação a definir</option>
                {usinas.dados
                  ?.filter(
                    (u) => usinaFiltroId === null || u.id === usinaFiltroId,
                  )
                  .map((u) => (
                    <option value={u.id} key={u.id}>
                      {u.nome} · {u.modalidade_atual ?? "modalidade pendente"}
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
