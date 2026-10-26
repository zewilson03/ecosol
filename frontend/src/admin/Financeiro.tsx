import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { usarAdministrador } from "./EstruturaAdministrativa";
import {
  alterarDados,
  formatarData,
  formatarDinheiro,
  usarConsulta,
} from "./comunicacaoComServidor";
import {
  CabecalhoDoModulo,
  EstadoDaConsulta,
  ListaVazia,
} from "./ComponentesDoPainel";

type Conta = {
  id: number;
  descricao: string;
  favorecido: string;
  valor_centavos: number;
  vencimento: string;
  status: string;
  versao: number;
};
type Historico = {
  id: number;
  conta_id: number;
  responsavel: string;
  acao: string;
  valor_anterior: number | null;
  valor_novo: number;
  criado_em: string;
  dados_anteriores: string | null;
  dados_novos: string;
};
type DadosFinanceiros = { contas: Conta[]; historico: Historico[] };
type StatusRecebivel = "a_receber" | "vencido" | "pago" | "divergente";
type Recebivel = {
  id: string;
  documento_id: number | null;
  cliente: string;
  uc: string;
  competencia: string;
  valor_centavos: number;
  vencimento: string | null;
  status: StatusRecebivel;
  atualizado_em: string;
};
type VisaoDeRecebiveis = {
  hoje: string;
  totais: Record<
    StatusRecebivel,
    { quantidade: number; valor_centavos: number }
  >;
  recebiveis: Recebivel[];
};
type Divida = {
  uc: string;
  cliente: string;
  principal_centavos: number;
  encargos_centavos: number;
  total_centavos: number;
  alerta: boolean;
  cobrancas: Array<{
    operacao_id: string;
    competencia: string;
    vencimento: string;
    principal_centavos: number;
    encargos_centavos: number;
    total_centavos: number;
  }>;
};
type ApuracaoDeDividas = {
  data_referencia: string;
  limite_alerta_centavos: number;
  totais: {
    unidades: number;
    alertas: number;
    valor_centavos: number;
    cobrancas_sem_uc: number;
  };
  dividas: Divida[];
};

const nomesDosStatus: Record<StatusRecebivel, string> = {
  a_receber: "A receber",
  vencido: "Vencido",
  pago: "Pago",
  divergente: "Conferir",
};

export default function Financeiro() {
  const administrador = usarAdministrador();
  if (administrador.nivel < 2)
    return (
      <section className="admin-cartao">
        <h1>Acesso restrito</h1>
        <p>Seu perfil não tem acesso ao Financeiro.</p>
        <Link to="/admin/usinas">Voltar às usinas</Link>
      </section>
    );
  return <PainelFinanceiro podeEditar={administrador.nivel === 3} />;
}

function FormularioDeConta({
  conta,
  fechar,
  atualizar,
}: {
  conta: Conta | null;
  fechar: () => void;
  atualizar: () => void;
}) {
  const [salvando, definirSalvando] = useState(false);
  const [erro, definirErro] = useState("");
  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    definirSalvando(true);
    definirErro("");
    const campos = Object.fromEntries(new FormData(evento.currentTarget));
    try {
      await alterarDados(
        "/api/admin/financeiro" + (conta ? "/" + conta.id : ""),
        { ...campos, versao: conta?.versao },
        conta ? "PATCH" : "POST",
      );
      atualizar();
      fechar();
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirSalvando(false);
    }
  }
  return (
    <form className="admin-formulario admin-cartao" onSubmit={salvar}>
      <div className="admin-barra">
        <h2>{conta ? "Editar conta #" + conta.id : "Nova conta a pagar"}</h2>
        <button
          type="button"
          className="admin-botao secundario"
          onClick={fechar}
          disabled={salvando}
        >
          Cancelar
        </button>
      </div>
      {erro && (
        <p className="admin-aviso erro" role="alert">
          {erro}
        </p>
      )}
      <fieldset disabled={salvando} className="admin-campos">
        <label>
          Descrição
          <input
            name="descricao"
            defaultValue={conta?.descricao}
            maxLength={160}
            required
            autoFocus
          />
        </label>
        <label>
          Favorecido
          <input
            name="favorecido"
            defaultValue={conta?.favorecido}
            maxLength={120}
            required
          />
        </label>
        <label>
          Valor (R$)
          <input
            name="valor"
            type="number"
            min="0"
            max="999999999.99"
            step="0.01"
            defaultValue={conta ? (conta.valor_centavos / 100).toFixed(2) : ""}
            required
          />
        </label>
        <label>
          Vencimento
          <input
            name="vencimento"
            type="date"
            defaultValue={conta?.vencimento}
            required
          />
        </label>
        <label>
          Status
          <select name="status" defaultValue={conta?.status ?? "Pendente"}>
            <option>Pendente</option>
            <option>Pago</option>
          </select>
        </label>
      </fieldset>
      <button className="admin-botao" disabled={salvando}>
        {salvando ? "Salvando…" : "Salvar conta"}
      </button>
    </form>
  );
}

function PainelFinanceiro({ podeEditar }: { podeEditar: boolean }) {
  const [historicoAberto, definirHistoricoAberto] = useState(false);
  const consulta = usarConsulta<Pick<DadosFinanceiros, "contas">>(
    "/api/admin/financeiro?visao=contas",
  );
  const consultaHistorico = usarConsulta<Pick<DadosFinanceiros, "historico">>(
    historicoAberto ? "/api/admin/financeiro?visao=historico" : null,
  );
  const [busca, definirBusca] = useState("");
  const [status, definirStatus] = useState("");
  const [editando, definirEditando] = useState<Conta | null | undefined>(
    undefined,
  );
  const [mensagem, definirMensagem] = useState("");
  const contas = consulta.dados?.contas ?? [];
  const filtradas = contas.filter(
    (conta) =>
      (conta.descricao + conta.favorecido)
        .toLowerCase()
        .includes(busca.toLowerCase()) &&
      (!status || conta.status === status),
  );
  const pendentes = contas.filter((conta) => conta.status === "Pendente");
  const hoje = new Date().toLocaleDateString("sv-SE");
  const vencidas = pendentes.filter((conta) => conta.vencimento < hoje);
  function atualizarAposSalvar() {
    definirMensagem("Conta salva. O histórico foi atualizado.");
    consulta.atualizar();
    if (historicoAberto) consultaHistorico.atualizar();
  }

  return (
    <>
      <CabecalhoDoModulo
        titulo="Financeiro"
        descricao="Acompanhe os compromissos e mantenha as contas organizadas."
      >
        {podeEditar ? (
          <button
            className="admin-botao"
            onClick={() => {
              definirEditando(null);
              definirMensagem("");
            }}
          >
            + Nova conta
          </button>
        ) : (
          <span className="admin-status">Acesso de consulta</span>
        )}
      </CabecalhoDoModulo>
      <RecebiveisConciliados />
      <DividasPorUc />
      <div className="admin-resumos">
        <article>
          <span>Contas pendentes</span>
          <strong>
            {formatarDinheiro(
              pendentes.reduce(
                (total, conta) => total + conta.valor_centavos,
                0,
              ),
            )}
          </strong>
          <small>{pendentes.length} compromisso(s) em aberto</small>
        </article>
        <article className="solar">
          <span>Contas vencidas</span>
          <strong>
            {formatarDinheiro(
              vencidas.reduce(
                (total, conta) => total + conta.valor_centavos,
                0,
              ),
            )}
          </strong>
          <small>{vencidas.length} conta(s) precisam de atenção</small>
        </article>
        <article>
          <span>Total de contas</span>
          <strong>{contas.length}</strong>
          <small>Registros no financeiro</small>
        </article>
      </div>
      {mensagem && (
        <p className="admin-aviso sucesso" role="status">
          {mensagem}
        </p>
      )}
      {editando !== undefined && podeEditar && (
        <FormularioDeConta
          key={editando ? editando.id + ":" + editando.versao : "nova"}
          conta={editando}
          fechar={() => definirEditando(undefined)}
          atualizar={atualizarAposSalvar}
        />
      )}
      <section className="admin-cartao">
        <div className="admin-barra">
          <h2>Contas a pagar</h2>
          <input
            aria-label="Buscar contas"
            placeholder="Descrição ou favorecido"
            value={busca}
            onChange={(evento) => definirBusca(evento.target.value)}
          />
          <select
            aria-label="Filtrar contas por status"
            value={status}
            onChange={(evento) => definirStatus(evento.target.value)}
          >
            <option value="">Todos os status</option>
            <option>Pendente</option>
            <option>Pago</option>
          </select>
          <button
            className="admin-botao secundario"
            onClick={consulta.atualizar}
            disabled={consulta.carregando}
          >
            Atualizar
          </button>
        </div>
        <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
        {!consulta.carregando &&
          !consulta.erro &&
          (contas.length === 0 ? (
            <ListaVazia
              texto={
                podeEditar
                  ? "Cadastre a primeira conta para acompanhar valores e vencimentos."
                  : "As contas cadastradas pelos administradores avançados aparecerão aqui."
              }
            />
          ) : (
            <div className="admin-tabela">
              <table>
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th>Favorecido</th>
                    <th>Vencimento</th>
                    <th>Valor</th>
                    <th>Status</th>
                    {podeEditar && <th>Ação</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((conta) => (
                    <tr key={conta.id}>
                      <td>
                        <strong>{conta.descricao}</strong>
                        <small>#{conta.id}</small>
                      </td>
                      <td>{conta.favorecido}</td>
                      <td>{formatarData(conta.vencimento)}</td>
                      <td>{formatarDinheiro(conta.valor_centavos)}</td>
                      <td>
                        <span
                          className={
                            "admin-status " +
                            (conta.status === "Pago" ? "pago" : "")
                          }
                        >
                          {conta.status}
                        </span>
                      </td>
                      {podeEditar && (
                        <td>
                          <button
                            className="admin-botao secundario"
                            onClick={() => {
                              definirEditando(conta);
                              definirMensagem("");
                            }}
                          >
                            Editar
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtradas.length === 0 && (
                <p>Nenhuma conta corresponde aos filtros.</p>
              )}
            </div>
          ))}
      </section>
      <details
        className="admin-cartao financeiro-historico"
        onToggle={(evento) => definirHistoricoAberto(evento.currentTarget.open)}
      >
        <summary>
          <span>
            <strong>Histórico de alterações</strong>
            <small>Auditoria dos últimos 100 registros</small>
          </span>
          <span aria-hidden="true">⌄</span>
        </summary>
        <EstadoDaConsulta
          {...consultaHistorico}
          repetir={consultaHistorico.atualizar}
        />
        {consultaHistorico.dados?.historico.length === 0 && (
          <p>Nenhuma alteração registrada.</p>
        )}
        {consultaHistorico.dados?.historico.map((registro) => (
          <details className="admin-historico" key={registro.id}>
            <summary>
              <strong>
                {registro.acao} · Conta #{registro.conta_id}
              </strong>
              <span>{registro.responsavel}</span>
              <span>
                {registro.valor_anterior === null
                  ? "—"
                  : formatarDinheiro(registro.valor_anterior)}{" "}
                → {formatarDinheiro(registro.valor_novo)}
              </span>
              <time>
                {new Date(
                  registro.criado_em.replace(" ", "T") + "Z",
                ).toLocaleString("pt-BR")}
              </time>
            </summary>
            <DetalhesDoHistorico registro={registro} />
          </details>
        ))}
      </details>
    </>
  );
}

function DividasPorUc() {
  const [uc, definirUc] = useState("");
  const [ucAplicada, definirUcAplicada] = useState("");
  const parametros = new URLSearchParams();
  if (ucAplicada) parametros.set("uc", ucAplicada);
  const consulta = usarConsulta<ApuracaoDeDividas>(
    `/api/admin/financeiro/dividas${parametros.size ? `?${parametros}` : ""}`,
  );

  return (
    <section className="admin-cartao financeiro-dividas">
      <div className="admin-barra">
        <div>
          <h2>Dívidas vencidas por UC</h2>
          <small>
            Somente cobranças registradas no banco e ainda não liquidadas.
            {consulta.dados?.data_referencia
              ? ` Referência: ${formatarData(consulta.dados.data_referencia)}.`
              : ""}
          </small>
        </div>
        <form
          className="financeiro-busca-uc"
          onSubmit={(evento) => {
            evento.preventDefault();
            definirUcAplicada(uc);
          }}
        >
          <input
            aria-label="Filtrar dívidas por UC"
            inputMode="numeric"
            placeholder="Filtrar por UC"
            value={uc}
            onChange={(evento) => definirUc(evento.target.value)}
          />
          <button className="admin-botao secundario">Buscar</button>
        </form>
      </div>
      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
      {consulta.dados && (
        <>
          <div className="admin-resumos financeiro-resumos-recebiveis">
            <article>
              <span>Total vencido</span>
              <strong>
                {formatarDinheiro(consulta.dados.totais.valor_centavos)}
              </strong>
              <small>{consulta.dados.totais.unidades} UC(s)</small>
            </article>
            <article
              className={consulta.dados.totais.alertas ? "solar" : undefined}
            >
              <span>Acima do limite</span>
              <strong>{consulta.dados.totais.alertas}</strong>
              <small>
                Limite:{" "}
                {formatarDinheiro(consulta.dados.limite_alerta_centavos)}
              </small>
            </article>
          </div>
          {consulta.dados.totais.cobrancas_sem_uc > 0 && (
            <p className="admin-aviso erro" role="alert">
              {consulta.dados.totais.cobrancas_sem_uc} cobrança(s) vencida(s)
              precisam de UC para entrar na apuração.
            </p>
          )}
          {consulta.dados.dividas.length === 0 ? (
            <ListaVazia texto="Nenhuma dívida vencida corresponde à UC informada." />
          ) : (
            <div className="admin-tabela">
              <table>
                <thead>
                  <tr>
                    <th>Cliente e UC</th>
                    <th>Cobranças</th>
                    <th>Principal</th>
                    <th>Encargos</th>
                    <th>Total</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {consulta.dados.dividas.map((divida) => (
                    <tr key={divida.uc}>
                      <td>
                        <strong>{divida.cliente}</strong>
                        <small>UC {divida.uc}</small>
                      </td>
                      <td>
                        <details className="financeiro-composicao-divida">
                          <summary>{divida.cobrancas.length} item(ns)</summary>
                          <ul>
                            {divida.cobrancas.map((cobranca) => (
                              <li key={cobranca.operacao_id}>
                                {cobranca.competencia || "Sem competência"} ·{" "}
                                {cobranca.vencimento
                                  ? formatarData(cobranca.vencimento)
                                  : "Sem vencimento"}{" "}
                                · {formatarDinheiro(cobranca.total_centavos)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                      <td>{formatarDinheiro(divida.principal_centavos)}</td>
                      <td>{formatarDinheiro(divida.encargos_centavos)}</td>
                      <td>
                        <strong>
                          {formatarDinheiro(divida.total_centavos)}
                        </strong>
                      </td>
                      <td>
                        <span
                          className={`admin-status ${divida.alerta ? "financeiro-vencido" : "financeiro-a_receber"}`}
                        >
                          {divida.alerta ? "Alerta interno" : "Em atraso"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function RecebiveisConciliados() {
  const [filtros, definirFiltros] = useState({
    uc: "",
    status: "",
    inicio: "",
    fim: "",
  });
  const [aplicados, definirAplicados] = useState(filtros);
  const parametros = new URLSearchParams();
  Object.entries(aplicados).forEach(([chave, valor]) => {
    if (valor) parametros.set(chave, valor);
  });
  const consulta = usarConsulta<VisaoDeRecebiveis>(
    `/api/admin/financeiro/recebiveis${parametros.size ? `?${parametros}` : ""}`,
  );
  const totais = consulta.dados?.totais;
  const recebiveis = consulta.dados?.recebiveis ?? [];

  function aplicar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    definirAplicados({ ...filtros });
  }

  return (
    <section className="admin-cartao financeiro-recebiveis">
      <div className="admin-barra">
        <div>
          <h2>Recebíveis conciliados</h2>
          <small>
            Valores derivados das cobranças bancárias, sem edição manual.
          </small>
        </div>
        <button
          className="admin-botao secundario"
          onClick={consulta.atualizar}
          disabled={consulta.carregando}
        >
          Atualizar
        </button>
      </div>
      <form className="admin-campos financeiro-filtros" onSubmit={aplicar}>
        <label>
          UC
          <input
            inputMode="numeric"
            value={filtros.uc}
            onChange={(evento) =>
              definirFiltros({ ...filtros, uc: evento.target.value })
            }
            placeholder="Número da UC"
          />
        </label>
        <label>
          Status
          <select
            value={filtros.status}
            onChange={(evento) =>
              definirFiltros({ ...filtros, status: evento.target.value })
            }
          >
            <option value="">Todos</option>
            <option value="a_receber">A receber</option>
            <option value="vencido">Vencido</option>
            <option value="pago">Pago</option>
            <option value="divergente">Conferir</option>
          </select>
        </label>
        <label>
          Vencimento inicial
          <input
            type="date"
            value={filtros.inicio}
            onChange={(evento) =>
              definirFiltros({ ...filtros, inicio: evento.target.value })
            }
          />
        </label>
        <label>
          Vencimento final
          <input
            type="date"
            value={filtros.fim}
            onChange={(evento) =>
              definirFiltros({ ...filtros, fim: evento.target.value })
            }
          />
        </label>
        <button className="admin-botao">Aplicar filtros</button>
      </form>
      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
      {totais && (
        <div className="admin-resumos financeiro-resumos-recebiveis">
          {(["a_receber", "vencido", "pago", "divergente"] as const).map(
            (status) => (
              <article
                key={status}
                className={status === "vencido" ? "solar" : undefined}
              >
                <span>{nomesDosStatus[status]}</span>
                <strong>
                  {formatarDinheiro(totais[status].valor_centavos)}
                </strong>
                <small>{totais[status].quantidade} cobrança(s)</small>
              </article>
            ),
          )}
        </div>
      )}
      {!consulta.carregando && !consulta.erro && recebiveis.length === 0 ? (
        <ListaVazia texto="Nenhuma cobrança corresponde aos filtros informados." />
      ) : (
        recebiveis.length > 0 && (
          <div className="admin-tabela">
            <table>
              <thead>
                <tr>
                  <th>Cliente e UC</th>
                  <th>Competência</th>
                  <th>Vencimento</th>
                  <th>Valor</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recebiveis.map((recebivel) => (
                  <tr key={recebivel.id}>
                    <td>
                      <strong>{recebivel.cliente}</strong>
                      <small>
                        {recebivel.uc
                          ? `UC ${recebivel.uc}`
                          : "UC não informada"}
                      </small>
                    </td>
                    <td>{recebivel.competencia || "—"}</td>
                    <td>
                      {recebivel.vencimento
                        ? formatarData(recebivel.vencimento)
                        : "—"}
                    </td>
                    <td>{formatarDinheiro(recebivel.valor_centavos)}</td>
                    <td>
                      <span
                        className={`admin-status financeiro-${recebivel.status}`}
                      >
                        {nomesDosStatus[recebivel.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  );
}

function DetalhesDoHistorico({ registro }: { registro: Historico }) {
  const antes = lerDadosDoHistorico(registro.dados_anteriores);
  const depois = lerDadosDoHistorico(registro.dados_novos);
  return (
    <dl className="admin-detalhes">
      {["descricao", "favorecido", "vencimento", "status"].map((campo) => (
        <div key={campo}>
          <dt>
            {
              {
                descricao: "Descrição",
                favorecido: "Favorecido",
                vencimento: "Vencimento",
                status: "Status",
              }[campo]
            }
          </dt>
          <dd>
            {antes[campo] ?? "—"} → {depois[campo]}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function lerDadosDoHistorico(texto: string | null) {
  if (!texto) return {};
  try {
    return JSON.parse(texto) as Record<string, string>;
  } catch {
    return {};
  }
}
