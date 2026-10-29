import { useState } from "react";
import { useLocation } from "react-router-dom";
import { DadosDaEquipe } from "../dadosDaAplicacao";
import CampoDeCpf from "../componentes/CampoDeCpf";
import CadastroIntegradoCliente from "./CadastroIntegradoCliente";
import UnidadesDeCobranca from "./UnidadesDeCobranca";
import { usarAdministrador } from "./EstruturaAdministrativa";
import {
  alterarDados,
  consultarServidor,
  consultarServidorBancario,
  nomesDosNiveis,
  usarConsulta,
} from "./comunicacaoComServidor";
import {
  CabecalhoDoModulo,
  EstadoDaConsulta,
  FormularioAutomatico,
} from "./ComponentesDoPainel";

type SecaoDosCadastros = "unidades" | "clientes" | "contatos" | "acessos";

type PermissoesBancarias = {
  pode_gerenciar: boolean;
  papeis: { id: string; nome: string }[];
  pessoas: {
    id: number;
    name: string;
    email: string;
    access_level: number;
    papeis: string[];
  }[];
};

const nivelMinimoDoPapelBancario: Record<string, number> = {
  consulta_auditoria: 1,
  operador_financeiro: 2,
  aprovador_financeiro: 3,
  administrador_integracao: 3,
};

const secoesDosCadastros: {
  id: SecaoDosCadastros;
  numero: string;
  titulo: string;
  descricao: string;
  nivelMinimo?: number;
}[] = [
  {
    id: "unidades",
    numero: "01",
    titulo: "Unidades e contratos",
    descricao: "Dados usados no cálculo",
  },
  {
    id: "clientes",
    numero: "02",
    titulo: "Clientes",
    descricao: "Cadastro e acesso ao portal",
  },
  {
    id: "contatos",
    numero: "03",
    titulo: "Contatos recebidos",
    descricao: "Atendimento comercial",
  },
  {
    id: "acessos",
    numero: "04",
    titulo: "Acessos da equipe",
    descricao: "Permissões internas",
    nivelMinimo: 3,
  },
];

function ContatoObrigatorioDoCliente() {
  const [email, definirEmail] = useState("");
  const [telefone, definirTelefone] = useState("");
  return (
    <>
      <label>
        E-mail (ou informe telefone)
        <input
          name="email"
          type="email"
          maxLength={180}
          value={email}
          required={!telefone.trim()}
          onChange={(evento) => definirEmail(evento.target.value)}
        />
      </label>
      <label>
        Telefone (ou informe e-mail)
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={30}
          placeholder="(11) 99999-9999"
          value={telefone}
          required={!email.trim()}
          onChange={(evento) => definirTelefone(evento.target.value)}
        />
      </label>
      <p>Informe pelo menos um contato. O acesso ao portal exige e-mail.</p>
    </>
  );
}

export default function Clientes() {
  const location = useLocation();
  const nomeInicialCliente =
    location.state &&
    typeof location.state === "object" &&
    "nomeInicialCliente" in location.state &&
    typeof location.state.nomeInicialCliente === "string"
      ? location.state.nomeInicialCliente.slice(0, 120)
      : "";
  const clienteParaVincular =
    location.state &&
    typeof location.state === "object" &&
    "clienteParaVincular" in location.state &&
    Number.isSafeInteger(Number(location.state.clienteParaVincular)) &&
    Number(location.state.clienteParaVincular) > 0
      ? Number(location.state.clienteParaVincular)
      : null;
  const ucInicial =
    location.state &&
    typeof location.state === "object" &&
    "ucInicial" in location.state &&
    typeof location.state.ucInicial === "string"
      ? location.state.ucInicial.slice(0, 30)
      : "";
  const documentoInicial =
    location.state &&
    typeof location.state === "object" &&
    "documentoInicial" in location.state &&
    typeof location.state.documentoInicial === "string"
      ? location.state.documentoInicial.replace(/\D/g, "").slice(0, 14)
      : "";
  const administrador = usarAdministrador();
  const [secao, definirSecao] = useState<SecaoDosCadastros>(
    nomeInicialCliente || clienteParaVincular || ucInicial
      ? "clientes"
      : "unidades",
  );
  const consulta = usarConsulta<DadosDaEquipe>(
    secao === "unidades" ? null : `/api/equipe/dados?secao=${secao}`,
  );
  const permissoesBancarias = usarConsulta<PermissoesBancarias>(
    secao === "acessos" && administrador.nivel === 3
      ? "/api/admin/bancario/permissoes"
      : null,
  );
  const provisorios = usarConsulta<
    { id: number; nome: string; unidades: number }[]
  >(
    secao === "clientes" ? "/api/admin/faturamento/clientes-provisorios" : null,
  );
  const operacionais = usarConsulta<
    {
      id: number;
      referencia_interna: string;
      nome: string;
      situacao: string;
      unidades: number;
    }[]
  >(
    secao === "clientes"
      ? "/api/admin/faturamento/clientes-operacionais"
      : null,
  );
  const [busca, definirBusca] = useState("");
  const [formulario, definirFormulario] = useState(
    Boolean(nomeInicialCliente || clienteParaVincular || ucInicial),
  );
  const [novoAcesso, definirNovoAcesso] = useState(false);
  const [clienteParaExcluir, definirClienteParaExcluir] = useState<
    number | null
  >(null);
  const [exclusaoPendente, definirExclusaoPendente] = useState<number | null>(
    null,
  );
  const [erro, definirErro] = useState("");
  const [mensagem, definirMensagem] = useState("");
  const [ocupado, definirOcupado] = useState(false);
  const [exportando, definirExportando] = useState(false);
  const todosClientes = consulta.dados?.clientes ?? [];
  const administradores = consulta.dados?.administradores ?? [];
  const contatos = consulta.dados?.contatos ?? [];
  const clientes = todosClientes.filter((cliente) =>
    (cliente.name + cliente.cpf + cliente.email + cliente.phone)
      .toLowerCase()
      .includes(busca.toLowerCase()),
  );

  function abrirSecao(novaSecao: SecaoDosCadastros) {
    definirSecao(novaSecao);
    definirFormulario(false);
    definirNovoAcesso(false);
    definirBusca("");
    definirErro("");
    definirMensagem("");
  }

  async function mudarNivel(id: number, nivel: string) {
    definirOcupado(true);
    definirErro("");
    definirMensagem("");
    try {
      await alterarDados(
        "/api/admin/administradores/" + id + "/nivel",
        { nivel },
        "PATCH",
      );
      consulta.atualizar();
      definirMensagem("Nível de acesso atualizado.");
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirOcupado(false);
    }
  }

  async function excluirAcesso(id: number) {
    definirOcupado(true);
    definirErro("");
    definirMensagem("");
    try {
      await consultarServidor("/api/admin/administradores/" + id, {
        method: "DELETE",
      });
      definirExclusaoPendente(null);
      definirMensagem(
        "Acesso excluído. As sessões dessa pessoa foram encerradas.",
      );
      consulta.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirOcupado(false);
    }
  }

  async function alterarPapelBancario(
    pessoaId: number,
    papel: string,
    conceder: boolean,
  ) {
    definirOcupado(true);
    definirErro("");
    definirMensagem("");
    try {
      await consultarServidorBancario(
        `/api/admin/bancario/permissoes/${pessoaId}/${papel}`,
        { method: conceder ? "PUT" : "DELETE" },
      );
      definirMensagem(
        conceder
          ? "Permissão bancária concedida e auditada."
          : "Permissão bancária removida e auditada.",
      );
      permissoesBancarias.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirOcupado(false);
    }
  }

  async function excluirCliente(id: number) {
    definirOcupado(true);
    definirErro("");
    definirMensagem("");
    try {
      await consultarServidor("/api/admin/clientes/" + id, {
        method: "DELETE",
      });
      definirClienteParaExcluir(null);
      definirMensagem(
        "Cliente excluído. Suas sessões foram encerradas e as faturas permanecem no histórico.",
      );
      consulta.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirOcupado(false);
    }
  }

  async function mudarContato(id: number, status: string) {
    definirOcupado(true);
    definirErro("");
    try {
      await consultarServidor("/api/equipe/contatos/status", {
        method: "POST",
        body: new URLSearchParams({ id: String(id), status }),
      });
      consulta.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirOcupado(false);
    }
  }

  async function exportarPlanilha() {
    if (exportando) return;
    definirExportando(true);
    definirErro("");
    try {
      const resposta = await fetch("/api/admin/clientes/exportar", {
        credentials: "same-origin",
        headers: {
          Accept:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      });
      if (
        !resposta.ok ||
        !resposta.headers.get("content-type")?.includes("spreadsheetml")
      )
        throw new Error(
          resposta.status === 403
            ? "Seu acesso não permite exportar os cadastros."
            : "Não foi possível gerar a planilha. Tente novamente.",
        );
      const arquivo = URL.createObjectURL(await resposta.blob());
      const link = document.createElement("a");
      link.href = arquivo;
      link.download = `clientes-ecosol-${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(arquivo), 60_000);
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirExportando(false);
    }
  }

  return (
    <>
      <CabecalhoDoModulo
        titulo="Cadastros"
        descricao="Organize unidades de cobrança, clientes, contatos e acessos da equipe."
      />
      <nav
        className="admin-abas admin-abas-destaque clientes-navegacao"
        aria-label="Seções de clientes"
      >
        {secoesDosCadastros
          .filter(
            (item) =>
              !item.nivelMinimo || administrador.nivel >= item.nivelMinimo,
          )
          .map((item) => (
            <button
              className={secao === item.id ? "selecionada" : ""}
              onClick={() => abrirSecao(item.id)}
              key={item.id}
            >
              <span>{item.numero}</span>
              <strong>{item.titulo}</strong>
              <small>{item.descricao}</small>
            </button>
          ))}
      </nav>
      {formulario && secao === "clientes" && (
        <div className="admin-grade">
          {administrador.nivel >= 2 ? (
            <CadastroIntegradoCliente
              nomeInicial={nomeInicialCliente}
              documentoInicial={documentoInicial}
              clienteInicialId={clienteParaVincular}
              ucInicial={ucInicial}
              aoSalvar={(texto) => {
                consulta.atualizar();
                definirFormulario(false);
                definirMensagem(texto);
              }}
            />
          ) : (
            <FormularioAutomatico
              titulo="Cadastrar cliente"
              endereco="/api/equipe/clientes"
              aoSalvar={() => {
                consulta.atualizar();
                definirFormulario(false);
                definirMensagem(
                  "Cliente cadastrado. Solicite à equipe autorizada o vínculo da UC.",
                );
              }}
            >
              <label>
                Nome
                <input
                  name="name"
                  maxLength={120}
                  defaultValue={nomeInicialCliente}
                  required
                />
              </label>
              <CampoDeCpf id="novo-cliente" gerarTeste={import.meta.env.DEV} />
              <ContatoObrigatorioDoCliente />
              {import.meta.env.DEV && (
                <label>
                  Senha inicial (opcional)
                  <input
                    name="test_password"
                    type="password"
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
              )}
            </FormularioAutomatico>
          )}
        </div>
      )}
      {secao === "unidades" && (
        <UnidadesDeCobranca clienteInicialId={clienteParaVincular} />
      )}
      {secao !== "unidades" && (
        <section className="admin-cartao">
          <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
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
          {secao === "clientes" && (
            <>
              <EstadoDaConsulta
                {...provisorios}
                repetir={provisorios.atualizar}
              />
              <EstadoDaConsulta
                {...operacionais}
                repetir={operacionais.atualizar}
              />
              <div className="admin-barra">
                <div>
                  <h2>Lista de clientes</h2>
                  <small>{clientes.length} resultado(s)</small>
                </div>
                <input
                  aria-label="Buscar clientes"
                  placeholder="Nome, CPF, e-mail ou telefone"
                  value={busca}
                  onChange={(evento) => definirBusca(evento.target.value)}
                />
                <div className="admin-barra-acoes">
                  {busca && (
                    <button
                      className="admin-botao secundario"
                      type="button"
                      onClick={() => definirBusca("")}
                    >
                      Limpar busca
                    </button>
                  )}
                  {administrador.nivel >= 3 && (
                    <button
                      className="admin-botao secundario"
                      type="button"
                      disabled={exportando}
                      onClick={exportarPlanilha}
                    >
                      {exportando ? "Gerando planilha…" : "Exportar clientes"}
                    </button>
                  )}
                  <button
                    className="admin-botao"
                    type="button"
                    onClick={() => definirFormulario(!formulario)}
                  >
                    {formulario ? "Fechar cadastro" : "+ Novo cliente"}
                  </button>
                </div>
              </div>
              <div className="admin-tabela">
                <table>
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>CPF</th>
                      <th>Contato</th>
                      <th>Acesso</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientes.map((cliente) => (
                      <tr key={cliente.id}>
                        <td>
                          <strong>{cliente.name}</strong>
                        </td>
                        <td>{cliente.cpf}</td>
                        <td>
                          {cliente.email || "Sem e-mail"}
                          {cliente.phone && (
                            <small> · Tel. {cliente.phone}</small>
                          )}
                        </td>
                        <td>
                          <span className="admin-status">
                            {cliente.ready
                              ? "Ativo"
                              : cliente.email
                                ? "Aguardando ativação"
                                : "Sem acesso ao portal"}
                          </span>
                        </td>
                        <td>
                          {clienteParaExcluir === cliente.id ? (
                            <div className="admin-confirmacao">
                              <span>
                                Excluir {cliente.name}? O acesso será encerrado.
                              </span>
                              <button
                                className="admin-botao perigo"
                                disabled={ocupado}
                                onClick={() => excluirCliente(cliente.id)}
                              >
                                Confirmar exclusão
                              </button>
                              <button
                                className="admin-botao secundario"
                                disabled={ocupado}
                                onClick={() => definirClienteParaExcluir(null)}
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              className="admin-botao secundario"
                              disabled={ocupado}
                              onClick={() =>
                                definirClienteParaExcluir(cliente.id)
                              }
                              aria-label={"Excluir cliente " + cliente.name}
                            >
                              Excluir cliente
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!consulta.carregando && clientes.length === 0 && (
                  <p>Nenhum cliente encontrado.</p>
                )}
              </div>
              {(operacionais.dados ?? []).length > 0 && (
                <details className="admin-tabela">
                  <summary>
                    Clientes operacionais de teste: {operacionais.dados?.length}{" "}
                    · documentação pendente, sem acesso e sem cobrança
                  </summary>
                  <table>
                    <thead>
                      <tr>
                        <th>Referência interna (não é CPF/CNPJ)</th>
                        <th>Nome informado</th>
                        <th>UCs</th>
                        <th>Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(operacionais.dados ?? [])
                        .filter((item) =>
                          `${item.nome} ${item.referencia_interna}`
                            .toLowerCase()
                            .includes(busca.toLowerCase()),
                        )
                        .map((item) => (
                          <tr key={item.id}>
                            <td>{item.referencia_interna}</td>
                            <td>{item.nome}</td>
                            <td>{item.unidades}</td>
                            <td>{item.situacao}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </details>
              )}
              {(provisorios.dados ?? []).some(
                (item) =>
                  item.unidades > 0 &&
                  item.nome.toLowerCase().includes(busca.toLowerCase()),
              ) && (
                <div className="admin-tabela">
                  <h3>Cadastros provisórios</h3>
                  <p>
                    Apenas nome, sem CPF e e-mail confirmados e sem acesso ao
                    portal. Para concluir, cadastre o cliente real e vincule
                    cada UC em Unidades e contratos.
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Cliente identificado</th>
                        <th>UCs vinculadas</th>
                        <th>Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(provisorios.dados ?? [])
                        .filter(
                          (item) =>
                            item.unidades > 0 &&
                            item.nome
                              .toLowerCase()
                              .includes(busca.toLowerCase()),
                        )
                        .map((item) => (
                          <tr key={item.id}>
                            <td>{item.nome}</td>
                            <td>{item.unidades}</td>
                            <td>Cadastro pendente, sem acesso</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {secao === "acessos" && administrador.nivel === 3 && (
            <>
              <div className="admin-barra">
                <h2>Acessos da equipe</h2>
                <div className="admin-barra-acoes">
                  <button
                    className="admin-botao"
                    onClick={() => definirNovoAcesso(!novoAcesso)}
                  >
                    {novoAcesso ? "Fechar formulário" : "+ Novo acesso"}
                  </button>
                </div>
              </div>
              <p>
                Crie acessos com email e senha, escolha o nível e gerencie as
                contas existentes.
              </p>
              {novoAcesso && (
                <FormularioAutomatico
                  titulo="Criar acesso administrativo"
                  endereco="/api/equipe/administradores"
                  aoSalvar={() => {
                    if (administrador.id === null) window.location.reload();
                    else consulta.atualizar();
                  }}
                >
                  <label>
                    Nome
                    <input name="name" maxLength={120} required />
                  </label>
                  <label>
                    Email de acesso
                    <input
                      name="email"
                      type="email"
                      maxLength={180}
                      autoComplete="off"
                      required
                    />
                  </label>
                  <label>
                    Senha inicial (8 a 128 caracteres)
                    <input
                      name="password"
                      type="password"
                      minLength={8}
                      maxLength={128}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                  <label>
                    Nível de acesso
                    <select name="nivel" defaultValue="1">
                      <option value="1">1 — Básico</option>
                      <option value="2">2 — Intermediário</option>
                      <option value="3">3 — Avançado</option>
                    </select>
                  </label>
                </FormularioAutomatico>
              )}
              <div className="admin-tabela">
                <table>
                  <thead>
                    <tr>
                      <th>Administrador</th>
                      <th>Email</th>
                      <th>Nível</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {administradores.map((pessoa) => (
                      <tr key={pessoa.id}>
                        <td>{pessoa.name}</td>
                        <td>{pessoa.email}</td>
                        <td>
                          <select
                            aria-label={"Nível de " + pessoa.name}
                            value={pessoa.access_level}
                            disabled={
                              ocupado ||
                              consulta.carregando ||
                              pessoa.id === administrador.id
                            }
                            onChange={(evento) =>
                              mudarNivel(pessoa.id, evento.target.value)
                            }
                          >
                            {[1, 2, 3].map((nivel) => (
                              <option value={nivel} key={nivel}>
                                {nivel} — {nomesDosNiveis[nivel]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {pessoa.id === administrador.id ? (
                            <small>Sua conta</small>
                          ) : exclusaoPendente === pessoa.id ? (
                            <div className="admin-confirmacao">
                              <span>Excluir o acesso de {pessoa.name}?</span>
                              <button
                                className="admin-botao perigo"
                                disabled={ocupado}
                                onClick={() => excluirAcesso(pessoa.id)}
                              >
                                Confirmar exclusão
                              </button>
                              <button
                                className="admin-botao secundario"
                                disabled={ocupado}
                                onClick={() => definirExclusaoPendente(null)}
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              className="admin-botao secundario"
                              disabled={ocupado}
                              onClick={() => definirExclusaoPendente(pessoa.id)}
                            >
                              Excluir acesso
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {administradores.length === 0 && (
                <p>Crie o primeiro acesso usando “Novo acesso”.</p>
              )}
              <div className="admin-barra">
                <div>
                  <h2>Permissões bancárias</h2>
                  <p>
                    Acesso negado por padrão. Preparação, aprovação, auditoria e
                    administração da integração são permissões independentes.
                  </p>
                </div>
              </div>
              {permissoesBancarias.carregando && (
                <p>Carregando permissões bancárias…</p>
              )}
              {permissoesBancarias.erro && (
                <p className="admin-erro">{permissoesBancarias.erro}</p>
              )}
              {permissoesBancarias.dados && (
                <>
                  {!permissoesBancarias.dados.pode_gerenciar && (
                    <p className="admin-aviso">
                      Somente um administrador da integração pode alterar estes
                      papéis. Outro administrador deve alterar os papéis da sua
                      própria conta.
                    </p>
                  )}
                  <div className="admin-tabela">
                    <table>
                      <thead>
                        <tr>
                          <th>Pessoa</th>
                          {permissoesBancarias.dados.papeis.map((papel) => (
                            <th key={papel.id}>{papel.nome}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {permissoesBancarias.dados.pessoas.map((pessoa) => (
                          <tr key={pessoa.id}>
                            <td>
                              <strong>{pessoa.name}</strong>
                              <br />
                              <small>
                                Nível {pessoa.access_level} · {pessoa.email}
                              </small>
                            </td>
                            {permissoesBancarias.dados!.papeis.map((papel) => {
                              const concedido = pessoa.papeis.includes(
                                papel.id,
                              );
                              const nivelInsuficiente =
                                pessoa.access_level <
                                (nivelMinimoDoPapelBancario[papel.id] ?? 3);
                              return (
                                <td key={papel.id}>
                                  <label>
                                    <input
                                      type="checkbox"
                                      aria-label={`${papel.nome} para ${pessoa.name}`}
                                      checked={concedido}
                                      disabled={
                                        ocupado ||
                                        !permissoesBancarias.dados!
                                          .pode_gerenciar ||
                                        pessoa.id === administrador.id ||
                                        nivelInsuficiente
                                      }
                                      onChange={() =>
                                        alterarPapelBancario(
                                          pessoa.id,
                                          papel.id,
                                          !concedido,
                                        )
                                      }
                                    />
                                    {nivelInsuficiente
                                      ? ` Exige nível ${nivelMinimoDoPapelBancario[papel.id]}`
                                      : concedido
                                        ? " Concedido"
                                        : " Sem acesso"}
                                  </label>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p>
                    <small>
                      Por segurança, ninguém altera os próprios papéis. No
                      primeiro uso, um administrador nível 3 deve nomear outro
                      nível 3 como administrador da integração.
                    </small>
                  </p>
                </>
              )}
            </>
          )}
          {secao === "contatos" && (
            <>
              <h2>Contatos recebidos</h2>
              {contatos.length === 0 && <p>Nenhum contato recebido ainda.</p>}
              {contatos.map((contato) => (
                <article className="admin-contato" key={contato.id}>
                  <div>
                    <h3>{contato.name}</h3>
                    <small>
                      {contato.email} · {contato.phone} · {contato.city}
                    </small>
                    <p>{contato.message}</p>
                  </div>
                  <label>
                    Status
                    <select
                      value={contato.status}
                      disabled={ocupado || consulta.carregando}
                      onChange={(evento) =>
                        mudarContato(contato.id, evento.target.value)
                      }
                    >
                      <option>Novo</option>
                      <option>Em contato</option>
                      <option>Concluído</option>
                    </select>
                  </label>
                </article>
              ))}
            </>
          )}
        </section>
      )}
    </>
  );
}
