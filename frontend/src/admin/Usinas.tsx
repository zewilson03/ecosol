import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CabecalhoDoModulo,
  EstadoDaConsulta,
  ListaVazia,
  FormularioAutomatico,
} from "./ComponentesDoPainel";
import { usarConsulta } from "./comunicacaoComServidor";
import { usarAdministrador } from "./EstruturaAdministrativa";
import CadastroIntegradoCliente from "./CadastroIntegradoCliente";
import ImportacaoVinculosUsinas from "./ImportacaoVinculosUsinas";
import ImportacaoDadosClientes from "./ImportacaoDadosClientes";

type Usina = {
  id: number;
  nome: string;
  localizacao: string;
  potencia_kw: number;
  status: string;
  versao: number;
  unidades: number;
  modalidade_atual: "GDI" | "GDII" | null;
  modalidade_inicio: string | null;
  modalidades: { inicio: string; modalidade: "GDI" | "GDII" }[];
  identificadores_geracao?: {
    numero: string;
    tipo: "atual" | "historico";
    origem: string;
    quantidade_usinas: number;
  }[];
};
type UnidadeDaUsina = {
  id: number;
  uc: string;
  uc_antiga?: string | null;
  nome: string;
  cliente_nome: string | null;
  usina_id: number | null;
  versao: number;
};

export default function Usinas() {
  const navegar = useNavigate();
  const { nivel } = usarAdministrador();
  const [novo, setNovo] = useState(false);
  const [configurando, setConfigurando] = useState<number | null>(null);
  const [localizando, setLocalizando] = useState<number | null>(null);
  const [vinculando, setVinculando] = useState<number | null>(null);
  const [cadastroNaUsina, setCadastroNaUsina] = useState<number | null>(null);
  const [importacaoAberta, setImportacaoAberta] = useState(false);
  const [tipoPlanilha, setTipoPlanilha] = useState<"vinculos" | "clientes">(
    "vinculos",
  );
  const cadastroRef = useRef<HTMLElement>(null);
  const importacaoRef = useRef<HTMLElement>(null);
  const [mensagem, setMensagem] = useState("");
  const [exportando, setExportando] = useState(false);
  const [erroExportacao, setErroExportacao] = useState("");
  const [ucEscolhida, setUcEscolhida] = useState("");
  const consulta = usarConsulta<Usina[]>("/api/admin/usinas");
  const unidades = usarConsulta<UnidadeDaUsina[]>(
    "/api/admin/faturamento/unidades",
  );
  const [busca, definirBusca] = useState("");
  const usinas = consulta.dados ?? [];
  const cadastrosSemUsinaReal = usinas.filter(
    (usina) => usina.nome.toLowerCase() === "ecosol",
  );
  const semUsina = (unidades.dados ?? []).filter(
    (unidade) => unidade.usina_id === null,
  );
  const unidadeEscolhida = semUsina.find(
    (unidade) => String(unidade.id) === ucEscolhida,
  );
  const usinaDoCadastro = usinas.find((usina) => usina.id === cadastroNaUsina);
  const filtradas = usinas.filter((usina) =>
    (usina.nome + usina.localizacao)
      .toLowerCase()
      .includes(busca.toLowerCase()),
  );
  useEffect(() => {
    if (cadastroNaUsina === null) return;
    cadastroRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
    cadastroRef.current?.focus({ preventScroll: true });
  }, [cadastroNaUsina]);
  useEffect(() => {
    if (!importacaoAberta) return;
    importacaoRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
    importacaoRef.current?.focus({ preventScroll: true });
  }, [importacaoAberta]);
  async function exportarPlanilha() {
    if (exportando) return;
    setExportando(true);
    setErroExportacao("");
    try {
      const resposta = await fetch("/api/admin/usinas/exportar", {
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
            ? "Seu acesso não permite exportar as usinas."
            : "Não foi possível gerar a planilha de usinas.",
        );
      const url = URL.createObjectURL(await resposta.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `usinas-ecosol-${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (falha) {
      setErroExportacao((falha as Error).message);
    } finally {
      setExportando(false);
    }
  }
  return (
    <>
      <CabecalhoDoModulo
        titulo="Usinas"
        descricao="Cadastre a fonte de energia e sua modalidade. Cada UC será vinculada à usina que a atende."
      />
      {erroExportacao && (
        <p className="admin-aviso erro" role="alert">
          {erroExportacao}
        </p>
      )}
      <div className="admin-resumos">
        <article>
          <span>Usinas cadastradas</span>
          <strong>{usinas.length - cadastrosSemUsinaReal.length}</strong>
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
        {cadastrosSemUsinaReal.map((cadastro) => (
          <p className="admin-aviso" key={cadastro.id}>
            “Ecosol” é um vínculo provisório, não uma usina: {cadastro.unidades}{" "}
            UC(s) aguardam identificação da usina real. Nenhuma transferência
            será feita automaticamente.
          </p>
        ))}
        {mensagem && (
          <p className="admin-aviso sucesso" role="status">
            {mensagem}
          </p>
        )}
        <div className="admin-barra">
          <h2>Suas usinas</h2>
          <input
            aria-label="Buscar usinas"
            placeholder="Buscar nome ou localização"
            value={busca}
            onChange={(evento) => definirBusca(evento.target.value)}
          />
          {nivel === 3 && (
            <div className="admin-barra-acoes" aria-label="Ações de usinas">
              <button
                className="admin-botao secundario"
                type="button"
                onClick={() => setImportacaoAberta((aberta) => !aberta)}
              >
                {importacaoAberta ? "Fechar análise" : "Receber planilha"}
              </button>
              <button
                className="admin-botao secundario"
                type="button"
                disabled={exportando}
                onClick={exportarPlanilha}
              >
                {exportando ? "Gerando planilha…" : "Exportar usinas"}
              </button>
              <button
                className="admin-botao"
                type="button"
                onClick={() => setNovo(!novo)}
              >
                {novo ? "Fechar cadastro" : "+ Cadastrar usina"}
              </button>
            </div>
          )}
        </div>
        {novo && (
          <FormularioAutomatico
            titulo="Cadastrar usina para alocação"
            endereco="/api/admin/faturamento/usinas"
            aoSalvar={consulta.atualizar}
          >
            <label>
              Nome da usina
              <input name="nome" required maxLength={120} />
            </label>
            <label>
              Localização
              <input name="localizacao" required maxLength={160} />
            </label>
            <label>
              Modalidade de geração
              <select name="modalidade" required defaultValue="">
                <option value="" disabled>
                  Selecione GDI ou GDII
                </option>
                <option value="GDI">GDI</option>
                <option value="GDII">GDII</option>
              </select>
            </label>
            <label>
              Competência inicial da modalidade
              <input name="inicio" type="month" required />
              <small>
                Informe o primeiro mês em que esta modalidade vale para a usina.
              </small>
            </label>
          </FormularioAutomatico>
        )}
        <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
        <EstadoDaConsulta {...unidades} repetir={unidades.atualizar} />
        {!consulta.carregando &&
          !consulta.erro &&
          (usinas.length === 0 ? (
            <ListaVazia texto="Cadastre as usinas para associar unidades e importar suas planilhas. Um administrador de nível 3 pode cadastrar." />
          ) : filtradas.length === 0 ? (
            <p>Nenhuma usina corresponde à busca.</p>
          ) : (
            <div className="admin-grade">
              {filtradas.map((usina) => (
                <article
                  className="admin-usina admin-usina-clicavel"
                  key={usina.id}
                  role="link"
                  tabIndex={0}
                  aria-label={`Abrir usina ${usina.nome}`}
                  onClick={(evento) => {
                    if (
                      (evento.target as HTMLElement).closest(
                        "button,a,input,select,textarea,form,details",
                      )
                    )
                      return;
                    navegar(`/admin/usinas/${usina.id}`);
                  }}
                  onKeyDown={(evento) => {
                    if (evento.target !== evento.currentTarget) return;
                    if (evento.key === "Enter" || evento.key === " ") {
                      evento.preventDefault();
                      navegar(`/admin/usinas/${usina.id}`);
                    }
                  }}
                >
                  <div className="admin-usina-topo">
                    <span className="admin-usina-icone" aria-hidden="true">
                      ☀
                    </span>
                    <span
                      className={`admin-usina-selo${usina.modalidade_atual ? "" : " pendente"}`}
                    >
                      {usina.modalidade_atual ?? "A definir"}
                    </span>
                  </div>
                  <h3>{usina.nome}</h3>
                  <p className="admin-usina-localizacao">
                    {usina.nome.toLowerCase() === "ecosol"
                      ? "Vínculos aguardando identificação"
                      : usina.localizacao === "A confirmar"
                        ? "Localização pendente"
                        : usina.localizacao}
                  </p>
                  <div className="admin-usina-indicadores">
                    <div>
                      <strong>{usina.unidades}</strong>
                      <small>UCs vinculadas</small>
                    </div>
                    <div>
                      <strong>
                        {usina.potencia_kw.toLocaleString("pt-BR")}
                      </strong>
                      <small>kW instalados</small>
                    </div>
                  </div>
                  <div className="admin-usina-referencia">
                    <small>Identificador de geração</small>
                    <strong>
                      {usina.identificadores_geracao?.find(
                        (item) => item.tipo === "atual",
                      )?.numero ??
                        usina.identificadores_geracao?.[0]?.numero ??
                        "Pendente"}
                    </strong>
                    {usina.identificadores_geracao?.some(
                      (item) => item.quantidade_usinas > 1,
                    ) && (
                      <small className="admin-usina-alerta">
                        Conferir vínculo
                      </small>
                    )}
                  </div>
                  <Link
                    className="admin-usina-abrir"
                    to={`/admin/usinas/${usina.id}`}
                  >
                    Ver usina e UCs <span aria-hidden="true">→</span>
                  </Link>
                  <details className="admin-usina-gestao">
                    <summary>Mais informações e gestão</summary>
                    <div className="admin-usina-modalidade">
                      <div className="admin-usina-gestao-meta">
                        <span>
                          <small>Modalidade</small>
                          {usina.modalidade_inicio
                            ? `Vigente desde ${usina.modalidade_inicio.slice(5)}/${usina.modalidade_inicio.slice(0, 4)}`
                            : usina.modalidades.length
                              ? `${usina.modalidades.at(-1)?.modalidade} a partir de ${usina.modalidades.at(-1)?.inicio.slice(5)}/${usina.modalidades.at(-1)?.inicio.slice(0, 4)}`
                              : "A definir"}
                        </span>
                        <span>
                          <small>Status</small>
                          {usina.status}
                        </span>
                      </div>
                      {usina.identificadores_geracao?.length ? (
                        <div className="admin-usina-identificadores">
                          <small>Identificadores da geração</small>
                          <div className="admin-usina-identificadores-lista">
                            {usina.identificadores_geracao.map((item) => (
                              <span key={item.numero}>
                                UC {item.numero} ·{" "}
                                {item.tipo === "atual" ? "atual" : "histórica"}
                                {item.quantidade_usinas > 1
                                  ? " · conferir vínculo"
                                  : ""}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {(unidades.dados ?? []).some(
                        (item) => item.usina_id === usina.id,
                      ) && (
                        <details className="admin-usina-subsecao">
                          <summary>Clientes e UCs desta usina</summary>
                          <ul>
                            {(unidades.dados ?? [])
                              .filter((item) => item.usina_id === usina.id)
                              .map((item) => (
                                <li key={item.id}>
                                  {item.cliente_nome ?? item.nome} · UC{" "}
                                  {item.uc}
                                  {item.uc_antiga
                                    ? ` (antiga ${item.uc_antiga})`
                                    : ""}
                                </li>
                              ))}
                          </ul>
                        </details>
                      )}
                      <Link className="admin-usina-link" to="/admin/clientes">
                        Ver cadastros de UCs <span aria-hidden="true">→</span>
                      </Link>
                      {usina.modalidades.length > 0 && (
                        <details className="admin-usina-subsecao">
                          <summary>Histórico de modalidades</summary>
                          <ul>
                            {usina.modalidades.map((item) => (
                              <li key={item.inicio}>
                                {item.modalidade} desde {item.inicio.slice(5)}/
                                {item.inicio.slice(0, 4)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {nivel >= 2 && usina.nome.toLowerCase() !== "ecosol" && (
                        <small className="admin-usina-acoes-titulo">
                          Ações da usina
                        </small>
                      )}
                      {nivel === 3 && usina.nome.toLowerCase() !== "ecosol" && (
                        <button
                          className="admin-botao secundario admin-usina-acao"
                          type="button"
                          onClick={() =>
                            setConfigurando(
                              configurando === usina.id ? null : usina.id,
                            )
                          }
                        >
                          {configurando === usina.id
                            ? "Fechar"
                            : usina.modalidade_atual
                              ? "Nova vigência"
                              : "Definir modalidade"}
                        </button>
                      )}
                      {nivel === 3 && usina.nome.toLowerCase() !== "ecosol" && (
                        <button
                          className="admin-botao secundario admin-usina-acao"
                          type="button"
                          onClick={() =>
                            setLocalizando(
                              localizando === usina.id ? null : usina.id,
                            )
                          }
                        >
                          {localizando === usina.id
                            ? "Fechar localização"
                            : "Corrigir localização"}
                        </button>
                      )}
                      {localizando === usina.id && (
                        <FormularioAutomatico
                          titulo="Localização da usina"
                          endereco={`/api/admin/faturamento/usinas/${usina.id}`}
                          metodo="PATCH"
                          aoSalvar={() => {
                            consulta.atualizar();
                            setLocalizando(null);
                          }}
                        >
                          <input
                            type="hidden"
                            name="versao"
                            value={usina.versao}
                          />
                          <label>
                            Localização confirmada
                            <input
                              name="localizacao"
                              required
                              maxLength={160}
                              defaultValue={
                                usina.localizacao === "A confirmar"
                                  ? ""
                                  : usina.localizacao
                              }
                            />
                          </label>
                        </FormularioAutomatico>
                      )}
                      {nivel >= 2 &&
                        usina.nome.toLowerCase() !== "ecosol" &&
                        usina.modalidades.length > 0 && (
                          <button
                            className="admin-botao secundario admin-usina-acao"
                            type="button"
                            onClick={() => {
                              setCadastroNaUsina(usina.id);
                              setMensagem("");
                            }}
                          >
                            Cadastrar cliente e UC
                          </button>
                        )}
                      {nivel >= 2 &&
                        usina.nome.toLowerCase() !== "ecosol" &&
                        usina.modalidades.length > 0 && (
                          <button
                            className="admin-botao secundario admin-usina-acao"
                            type="button"
                            disabled={!semUsina.length}
                            onClick={() => {
                              setVinculando(
                                vinculando === usina.id ? null : usina.id,
                              );
                              setUcEscolhida("");
                            }}
                          >
                            {vinculando === usina.id
                              ? "Fechar vínculo"
                              : "Vincular UC existente"}
                          </button>
                        )}
                      {vinculando === usina.id && (
                        <FormularioAutomatico
                          titulo="Vincular UC à usina"
                          endereco={`/api/admin/faturamento/usinas/${usina.id}/unidades`}
                          aoSalvar={() => {
                            consulta.atualizar();
                            unidades.atualizar();
                            setVinculando(null);
                            setUcEscolhida("");
                          }}
                        >
                          <label>
                            Cliente / UC sem usina
                            <select
                              name="unidade_id"
                              value={ucEscolhida}
                              onChange={(evento) =>
                                setUcEscolhida(evento.target.value)
                              }
                              required
                            >
                              <option value="">Selecione uma UC</option>
                              {semUsina.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.cliente_nome ?? item.nome} · UC{" "}
                                  {item.uc}
                                </option>
                              ))}
                            </select>
                          </label>
                          <input
                            type="hidden"
                            name="versao"
                            value={unidadeEscolhida?.versao ?? ""}
                          />
                          <small>
                            Confira a identidade e a UC antes de criar o
                            vínculo. Transferências entre usinas exigem um
                            processo separado.
                          </small>
                        </FormularioAutomatico>
                      )}
                      {configurando === usina.id && (
                        <FormularioAutomatico
                          titulo="Modalidade da usina"
                          endereco={`/api/admin/faturamento/usinas/${usina.id}/modalidades`}
                          aoSalvar={() => {
                            consulta.atualizar();
                            setConfigurando(null);
                          }}
                        >
                          <input
                            type="hidden"
                            name="versao"
                            value={usina.versao}
                          />
                          <label>
                            Modalidade
                            <select name="modalidade" required defaultValue="">
                              <option value="" disabled>
                                Selecione GDI ou GDII
                              </option>
                              <option value="GDI">GDI</option>
                              <option value="GDII">GDII</option>
                            </select>
                          </label>
                          <label>
                            Competência inicial
                            <input name="inicio" type="month" required />
                          </label>
                        </FormularioAutomatico>
                      )}
                    </div>
                  </details>
                </article>
              ))}
            </div>
          ))}
      </section>
      {usinaDoCadastro && (
        <section
          className="admin-cartao admin-usina-cadastro-destino"
          ref={cadastroRef}
          tabIndex={-1}
        >
          <div className="admin-barra">
            <h2>Novo cliente na usina {usinaDoCadastro.nome}</h2>
            <button
              className="admin-botao secundario"
              type="button"
              onClick={() => setCadastroNaUsina(null)}
            >
              Fechar cadastro
            </button>
          </div>
          <CadastroIntegradoCliente
            key={usinaDoCadastro.id}
            usinaInicialId={usinaDoCadastro.id}
            usinaNome={usinaDoCadastro.nome}
            aoSalvar={(texto) => {
              setMensagem(texto);
              setCadastroNaUsina(null);
              unidades.atualizar();
              consulta.atualizar();
            }}
          />
        </section>
      )}
      {importacaoAberta && nivel === 3 && (
        <section
          className="admin-usina-importacao-destino"
          ref={importacaoRef}
          tabIndex={-1}
          aria-label="Análise de planilhas"
        >
          <div
            className="admin-usina-importacao-tipos"
            role="group"
            aria-label="Tipo de planilha"
          >
            <button
              className={`admin-botao secundario${tipoPlanilha === "vinculos" ? " selecionado" : ""}`}
              type="button"
              aria-pressed={tipoPlanilha === "vinculos"}
              onClick={() => setTipoPlanilha("vinculos")}
            >
              UCs e usinas
            </button>
            <button
              className={`admin-botao secundario${tipoPlanilha === "clientes" ? " selecionado" : ""}`}
              type="button"
              aria-pressed={tipoPlanilha === "clientes"}
              onClick={() => setTipoPlanilha("clientes")}
            >
              Dados de clientes
            </button>
          </div>
          <p className="admin-usina-importacao-nota">
            Envie um arquivo .xlsx de até 5 MB. A análise e a prévia não alteram
            os cadastros; a gravação exige confirmação separada.
          </p>
          {tipoPlanilha === "vinculos" ? (
            <ImportacaoVinculosUsinas
              usinas={usinas.map(({ id, nome }) => ({ id, nome }))}
              aoImportar={() => {
                consulta.atualizar();
                unidades.atualizar();
              }}
            />
          ) : (
            <ImportacaoDadosClientes
              aoImportar={() => {
                consulta.atualizar();
                unidades.atualizar();
              }}
            />
          )}
        </section>
      )}
    </>
  );
}
