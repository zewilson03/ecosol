import { FormEvent, useMemo, useState } from "react";
import type { Sessao } from "../dadosDaAplicacao";
import {
  alterarDados,
  executarComSenhaFinanceira,
  formatarData,
  formatarDinheiro,
  usarConsulta,
} from "./comunicacaoComServidor";
import {
  CabecalhoDoModulo,
  EstadoDaConsulta,
  ListaVazia,
} from "./ComponentesDoPainel";

type Tipo = { id: number; nome: string; categoria: string };
type Produto = {
  id: number;
  tipo_id: number;
  nome: string;
  unidade: string;
  tipo_nome: string;
  categoria: string;
};
type Solicitacao = {
  id: number;
  origem: string;
  descricao: string;
  favorecido: string;
  forma_pagamento: string;
  valor_centavos: number;
  vencimento: string;
  status: string;
  criado_por_nome: string;
  aprovado_por_nome: string | null;
  quantidade_itens: number;
};
type Dados = {
  tipos: Tipo[];
  produtos: Produto[];
  solicitacoes: Solicitacao[];
};
type Item = {
  produto_id: string;
  descricao: string;
  quantidade: string;
  valor_unitario: string;
};

const vazio: Item = {
  produto_id: "",
  descricao: "",
  quantidade: "1",
  valor_unitario: "",
};
const nomesStatus: Record<string, string> = {
  rascunho: "Rascunho",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovada: "Aprovada",
  rejeitada: "Rejeitada",
  paga: "Paga",
  cancelada: "Cancelada",
};

export default function PagamentosECompras() {
  const consulta = usarConsulta<Dados>("/api/admin/financeiro/pagamentos");
  const sessao = usarConsulta<Sessao>("/api/sessao");
  const proprietario =
    sessao.dados?.perfil === "equipe" &&
    sessao.dados.administrador.proprietario === true;
  const [aba, definirAba] = useState<"pagamentos" | "catalogo">("pagamentos");
  const [origem, definirOrigem] = useState("energia");
  const [itens, definirItens] = useState<Item[]>([{ ...vazio }]);
  const [mensagem, definirMensagem] = useState("");
  const [erro, definirErro] = useState("");
  const [ocupado, definirOcupado] = useState(false);
  const [baixa, definirBaixa] = useState<
    Record<number, { data: string; referencia: string }>
  >({});
  const dados = consulta.dados;
  const totalPendente = useMemo(
    () =>
      (dados?.solicitacoes ?? [])
        .filter((item) => item.status !== "paga" && item.status !== "cancelada")
        .reduce((soma, item) => soma + item.valor_centavos, 0),
    [dados],
  );

  async function executar(acao: () => Promise<unknown>, sucesso: string) {
    if (ocupado) return;
    definirOcupado(true);
    definirErro("");
    definirMensagem("");
    try {
      await acao();
      definirMensagem(sucesso);
      consulta.atualizar();
    } catch (falha) {
      definirErro((falha as Error).message);
    } finally {
      definirOcupado(false);
    }
  }

  async function criarSolicitacao(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const campos = Object.fromEntries(new FormData(formulario));
    await executar(
      () =>
        alterarDados("/api/admin/financeiro/solicitacoes", {
          ...campos,
          origem,
          itens: origem === "produtos" ? itens : [],
        }),
      "Solicitação cadastrada como rascunho.",
    );
    formulario.reset();
    definirItens([{ ...vazio }]);
  }

  return (
    <>
      <CabecalhoDoModulo
        titulo="Pagamentos e compras"
        descricao="Cadastre despesas, confira valores e encaminhe para aprovação dos Proprietários."
      />
      <nav className="admin-abas" aria-label="Pagamentos e compras">
        <button
          className={aba === "pagamentos" ? "ativo" : ""}
          onClick={() => definirAba("pagamentos")}
        >
          Pagamentos
        </button>
        <button
          className={aba === "catalogo" ? "ativo" : ""}
          onClick={() => definirAba("catalogo")}
        >
          Catálogo de produtos
        </button>
      </nav>
      {mensagem && (
        <p className="admin-aviso sucesso" role="status">
          {mensagem}
        </p>
      )}
      {erro && (
        <p className="admin-aviso erro" role="alert">
          {erro}
        </p>
      )}
      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
      {aba === "catalogo" ? (
        <Catalogo dados={dados} ocupado={ocupado} executar={executar} />
      ) : (
        <>
          <div className="admin-resumos">
            <article>
              <span>Compromissos em aberto</span>
              <strong>{formatarDinheiro(totalPendente)}</strong>
              <small>
                {dados?.solicitacoes.filter(
                  (item) => !["paga", "cancelada"].includes(item.status),
                ).length ?? 0}{" "}
                pagamento(s)
              </small>
            </article>
            <article className="solar">
              <span>Aguardando Proprietário</span>
              <strong>
                {dados?.solicitacoes.filter(
                  (item) => item.status === "aguardando_aprovacao",
                ).length ?? 0}
              </strong>
              <small>Somente Proprietários 1 e 2 aprovam</small>
            </article>
          </div>
          <form
            className="admin-cartao admin-formulario"
            onSubmit={criarSolicitacao}
          >
            <div className="admin-barra">
              <div>
                <span className="admin-legenda">NOVA DESPESA</span>
                <h2>Cadastrar pagamento ou compra</h2>
              </div>
            </div>
            <div className="admin-campos">
              <label>
                Origem
                <select
                  value={origem}
                  onChange={(e) => definirOrigem(e.target.value)}
                >
                  <option value="energia">Fatura de energia</option>
                  <option value="produtos">Compra de produtos</option>
                  <option value="outro">Outro pagamento</option>
                </select>
              </label>
              <label>
                Descrição
                <input name="descricao" maxLength={160} required />
              </label>
              <label>
                Favorecido
                <input name="favorecido" maxLength={120} required />
              </label>
              <label>
                CPF/CNPJ do favorecido
                <input name="documento_favorecido" inputMode="numeric" />
              </label>
              <label>
                Forma de pagamento
                <select name="forma_pagamento" defaultValue="boleto">
                  <option value="boleto">Boleto</option>
                  <option value="pix">Pix</option>
                  <option value="transferencia">Transferência</option>
                  <option value="cartao">Cartão</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="debito_automatico">Débito automático</option>
                  <option value="outro">Outro</option>
                </select>
              </label>
              <label>
                Vencimento
                <input name="vencimento" type="date" required />
              </label>
              {origem !== "produtos" && (
                <label>
                  Valor (R$)
                  <input
                    name="valor"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                  />
                </label>
              )}
            </div>
            {origem === "produtos" && (
              <Itens
                produtos={dados?.produtos ?? []}
                itens={itens}
                definir={definirItens}
              />
            )}
            <button className="admin-botao" disabled={ocupado}>
              Salvar rascunho
            </button>
          </form>
          <section className="admin-cartao">
            <div className="admin-barra">
              <h2>Solicitações</h2>
              <button
                className="admin-botao secundario"
                onClick={consulta.atualizar}
              >
                Atualizar
              </button>
            </div>
            {!dados?.solicitacoes.length ? (
              <ListaVazia texto="Nenhum pagamento foi cadastrado." />
            ) : (
              <div className="admin-tabela">
                <table>
                  <thead>
                    <tr>
                      <th>Despesa</th>
                      <th>Forma</th>
                      <th>Vencimento</th>
                      <th>Valor</th>
                      <th>Status</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.solicitacoes.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.descricao}</strong>
                          <small>
                            {item.favorecido} · {item.criado_por_nome}
                          </small>
                        </td>
                        <td>{item.forma_pagamento.replaceAll("_", " ")}</td>
                        <td>{formatarData(item.vencimento)}</td>
                        <td>{formatarDinheiro(item.valor_centavos)}</td>
                        <td>
                          <span className="admin-status">
                            {nomesStatus[item.status] ?? item.status}
                          </span>
                        </td>
                        <td>
                          <div className="admin-acoes">
                            {item.status === "rascunho" && (
                              <button
                                className="admin-botao secundario"
                                disabled={ocupado}
                                onClick={() =>
                                  executar(
                                    () =>
                                      alterarDados(
                                        `/api/admin/financeiro/solicitacoes/${item.id}/enviar`,
                                        {},
                                      ),
                                    "Enviada para aprovação.",
                                  )
                                }
                              >
                                Enviar para aprovação
                              </button>
                            )}
                            {proprietario &&
                              item.status === "aguardando_aprovacao" && (
                                <button
                                  className="admin-botao"
                                  disabled={ocupado}
                                  onClick={() =>
                                    executar(
                                      () =>
                                        executarComSenhaFinanceira(
                                          `/api/admin/financeiro/solicitacoes/${item.id}/aprovar`,
                                          {},
                                          "Aprovar pagamento",
                                        ),
                                      "Pagamento aprovado.",
                                    )
                                  }
                                >
                                  Aprovar
                                </button>
                              )}
                            {proprietario && item.status === "aprovada" && (
                              <div className="pagamentos-baixa">
                                <input
                                  type="date"
                                  aria-label="Data do pagamento"
                                  value={baixa[item.id]?.data ?? ""}
                                  onChange={(e) =>
                                    definirBaixa({
                                      ...baixa,
                                      [item.id]: {
                                        data: e.target.value,
                                        referencia:
                                          baixa[item.id]?.referencia ?? "",
                                      },
                                    })
                                  }
                                />
                                <input
                                  placeholder="Referência ou recibo"
                                  value={baixa[item.id]?.referencia ?? ""}
                                  onChange={(e) =>
                                    definirBaixa({
                                      ...baixa,
                                      [item.id]: {
                                        data: baixa[item.id]?.data ?? "",
                                        referencia: e.target.value,
                                      },
                                    })
                                  }
                                />
                                <button
                                  className="admin-botao"
                                  disabled={ocupado || !baixa[item.id]?.data}
                                  onClick={() =>
                                    executar(
                                      () =>
                                        executarComSenhaFinanceira(
                                          `/api/admin/financeiro/solicitacoes/${item.id}/baixar`,
                                          {
                                            pago_em: baixa[item.id].data,
                                            referencia_pagamento:
                                              baixa[item.id].referencia,
                                          },
                                          "Registrar pagamento externo",
                                        ),
                                      "Pagamento baixado.",
                                    )
                                  }
                                >
                                  Dar baixa
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function Itens({
  produtos,
  itens,
  definir,
}: {
  produtos: Produto[];
  itens: Item[];
  definir: (itens: Item[]) => void;
}) {
  const alterar = (indice: number, campo: keyof Item, valor: string) =>
    definir(
      itens.map((item, atual) =>
        atual === indice ? { ...item, [campo]: valor } : item,
      ),
    );
  return (
    <section className="pagamentos-itens">
      <div className="admin-barra">
        <h3>Itens da compra</h3>
        <button
          type="button"
          className="admin-botao secundario"
          onClick={() => definir([...itens, { ...vazio }])}
        >
          + Item
        </button>
      </div>
      {itens.map((item, indice) => (
        <div className="admin-campos" key={indice}>
          <label>
            Produto
            <select
              value={item.produto_id}
              onChange={(e) => alterar(indice, "produto_id", e.target.value)}
            >
              <option value="">Item avulso</option>
              {produtos.map((produto) => (
                <option key={produto.id} value={produto.id}>
                  {produto.nome} · {produto.tipo_nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            Descrição
            <input
              value={item.descricao}
              onChange={(e) => alterar(indice, "descricao", e.target.value)}
              required={!item.produto_id}
            />
          </label>
          <label>
            Quantidade
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={item.quantidade}
              onChange={(e) => alterar(indice, "quantidade", e.target.value)}
              required
            />
          </label>
          <label>
            Valor unitário
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={item.valor_unitario}
              onChange={(e) =>
                alterar(indice, "valor_unitario", e.target.value)
              }
              required
            />
          </label>
          {itens.length > 1 && (
            <button
              type="button"
              className="admin-botao secundario"
              onClick={() =>
                definir(itens.filter((_, atual) => atual !== indice))
              }
            >
              Remover
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function Catalogo({
  dados,
  ocupado,
  executar,
}: {
  dados: Dados | null;
  ocupado: boolean;
  executar: (acao: () => Promise<unknown>, sucesso: string) => Promise<void>;
}) {
  return (
    <div className="pagamentos-grade">
      <form
        className="admin-cartao admin-formulario"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          executar(
            () =>
              alterarDados(
                "/api/admin/financeiro/tipos-produto",
                Object.fromEntries(new FormData(form)),
              ),
            "Tipo cadastrado.",
          ).then(() => form.reset());
        }}
      >
        <h2>Novo tipo de produto</h2>
        <div className="admin-campos">
          <label>
            Nome
            <input name="nome" required />
          </label>
          <label>
            Segmento
            <select name="categoria">
              <option value="interno">Uso interno</option>
              <option value="obra">Obras</option>
              <option value="usina">Usinas</option>
              <option value="eletroposto">Eletropostos</option>
              <option value="outro">Outro</option>
            </select>
          </label>
        </div>
        <button className="admin-botao" disabled={ocupado}>
          Cadastrar tipo
        </button>
      </form>
      <form
        className="admin-cartao admin-formulario"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          executar(
            () =>
              alterarDados(
                "/api/admin/financeiro/produtos",
                Object.fromEntries(new FormData(form)),
              ),
            "Produto cadastrado.",
          ).then(() => form.reset());
        }}
      >
        <h2>Novo produto</h2>
        <div className="admin-campos">
          <label>
            Tipo
            <select name="tipo_id" required>
              <option value="">Selecione</option>
              {dados?.tipos.map((tipo) => (
                <option key={tipo.id} value={tipo.id}>
                  {tipo.nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            Produto
            <input name="nome" required />
          </label>
          <label>
            Unidade
            <input name="unidade" defaultValue="un" required />
          </label>
        </div>
        <button className="admin-botao" disabled={ocupado}>
          Cadastrar produto
        </button>
      </form>
      <section className="admin-cartao">
        <h2>Produtos cadastrados</h2>
        {!dados?.produtos.length ? (
          <ListaVazia texto="Nenhum produto cadastrado." />
        ) : (
          <div className="admin-tabela">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Tipo</th>
                  <th>Segmento</th>
                  <th>Unidade</th>
                </tr>
              </thead>
              <tbody>
                {dados.produtos.map((produto) => (
                  <tr key={produto.id}>
                    <td>{produto.nome}</td>
                    <td>{produto.tipo_nome}</td>
                    <td>{produto.categoria}</td>
                    <td>{produto.unidade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
