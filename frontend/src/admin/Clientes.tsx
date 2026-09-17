import { useState } from "react";
import { DadosDaEquipe } from "../dadosDaAplicacao";
import CampoDeCpf from "../componentes/CampoDeCpf";
import { usarAdministrador } from "./EstruturaAdministrativa";
import {
  alterarDados,
  consultarServidor,
  nomesDosNiveis,
  usarConsulta,
} from "./comunicacaoComServidor";
import {
  CabecalhoDoModulo,
  EstadoDaConsulta,
  FormularioAutomatico,
} from "./ComponentesDoPainel";

export default function Clientes() {
  const administrador = usarAdministrador();
  const consulta = usarConsulta<DadosDaEquipe>("/api/equipe/dados");
  const [busca, definirBusca] = useState("");
  const [secao, definirSecao] = useState("clientes");
  const [formulario, definirFormulario] = useState(false);
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
  const clientes = (consulta.dados?.clientes ?? []).filter((cliente) =>
    (cliente.name + cliente.cpf + cliente.email)
      .toLowerCase()
      .includes(busca.toLowerCase()),
  );

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

  return (
    <>
      <CabecalhoDoModulo
        titulo="Clientes"
        descricao="Relacionamentos, cadastros e acessos em um só lugar."
      >
        {secao === "clientes" && (
          <button
            className="admin-botao"
            onClick={() => definirFormulario(!formulario)}
          >
            {formulario ? "Fechar cadastro" : "+ Novo cliente"}
          </button>
        )}
      </CabecalhoDoModulo>
      <div className="admin-abas" aria-label="Seções de clientes">
        <button
          className={secao === "clientes" ? "selecionada" : ""}
          onClick={() => definirSecao("clientes")}
        >
          Clientes ({consulta.dados?.clientes.length ?? 0})
        </button>
        <button
          className={secao === "contatos" ? "selecionada" : ""}
          onClick={() => definirSecao("contatos")}
        >
          Contatos recebidos
        </button>
        {administrador.nivel === 3 && (
          <button
            className={secao === "acessos" ? "selecionada" : ""}
            onClick={() => definirSecao("acessos")}
          >
            Acessos da equipe
          </button>
        )}
      </div>
      {formulario && secao === "clientes" && (
        <div className="admin-grade">
          <FormularioAutomatico
            titulo="Cadastrar cliente"
            endereco="/api/equipe/clientes"
            aoSalvar={consulta.atualizar}
          >
            <label>
              Nome
              <input name="name" maxLength={120} required />
            </label>
            <CampoDeCpf id="novo-cliente" gerarTeste={import.meta.env.DEV} />
            <label>
              Email
              <input name="email" type="email" maxLength={180} required />
            </label>
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
        </div>
      )}
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
            <div className="admin-barra">
              <h2>Lista de clientes</h2>
              <input
                aria-label="Buscar clientes"
                placeholder="Nome, CPF ou email"
                value={busca}
                onChange={(evento) => definirBusca(evento.target.value)}
              />
            </div>
            <div className="admin-tabela">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>CPF</th>
                    <th>Email</th>
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
                      <td>{cliente.email}</td>
                      <td>
                        <span className="admin-status">
                          {cliente.ready ? "Ativo" : "Aguardando ativação"}
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
          </>
        )}
        {secao === "acessos" && administrador.nivel === 3 && (
          <>
            <div className="admin-barra">
              <h2>Acessos da equipe</h2>
              <button
                className="admin-botao"
                onClick={() => definirNovoAcesso(!novoAcesso)}
              >
                {novoAcesso ? "Fechar formulário" : "+ Novo acesso"}
              </button>
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
                  {consulta.dados?.administradores.map((pessoa) => (
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
            {consulta.dados?.administradores.length === 0 && (
              <p>Crie o primeiro acesso usando “Novo acesso”.</p>
            )}
          </>
        )}
        {secao === "contatos" && (
          <>
            <h2>Contatos recebidos</h2>
            {consulta.dados?.contatos.length === 0 && (
              <p>Nenhum contato recebido ainda.</p>
            )}
            {consulta.dados?.contatos.map((contato) => (
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
    </>
  );
}
