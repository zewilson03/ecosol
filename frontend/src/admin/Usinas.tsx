import { useState } from "react";
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
  const [mensagem, setMensagem] = useState("");
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
  return (
    <>
      <CabecalhoDoModulo
        titulo="Usinas"
        descricao="Cadastre a fonte de energia e sua modalidade. Cada UC será vinculada à usina que a atende."
      >
        {nivel === 3 && (
          <button className="admin-botao" onClick={() => setNovo(!novo)}>
            {novo ? "Fechar cadastro" : "+ Cadastrar usina"}
          </button>
        )}
      </CabecalhoDoModulo>
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
        </div>
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
                  <span>☀</span>
                  <h3>{usina.nome}</h3>
                  {usina.nome.toLowerCase() === "ecosol" && (
                    <p className="admin-aviso">Vínculo de usina pendente</p>
                  )}
                  <p>{usina.localizacao}</p>
                  <strong>{usina.potencia_kw} kW</strong>
                  <small>{usina.status}</small>
                  <Link to={`/admin/usinas/${usina.id}`}>
                    Abrir usina e avaliar UCs
                  </Link>
                  <div className="admin-usina-modalidade">
                    <strong>
                      {usina.modalidade_atual ??
                        (usina.modalidades.length
                          ? "Modalidade programada"
                          : "Modalidade pendente")}
                    </strong>
                    <small>
                      {usina.modalidade_inicio
                        ? `Desde ${usina.modalidade_inicio.slice(5)}/${usina.modalidade_inicio.slice(0, 4)}`
                        : usina.modalidades.length
                          ? `${usina.modalidades.at(-1)?.modalidade} a partir de ${usina.modalidades.at(-1)?.inicio.slice(5)}/${usina.modalidades.at(-1)?.inicio.slice(0, 4)}. Ainda não vigente.`
                          : "Defina GDI ou GDII antes de usar a usina no faturamento."}
                    </small>
                    <small>{usina.unidades} UC(s) vinculada(s)</small>
                    {(unidades.dados ?? []).some(
                      (item) => item.usina_id === usina.id,
                    ) && (
                      <details>
                        <summary>Clientes e UCs desta usina</summary>
                        <ul>
                          {(unidades.dados ?? [])
                            .filter((item) => item.usina_id === usina.id)
                            .map((item) => (
                              <li key={item.id}>
                                {item.cliente_nome ?? item.nome} · UC {item.uc}
                                {item.uc_antiga
                                  ? ` (antiga ${item.uc_antiga})`
                                  : ""}
                              </li>
                            ))}
                        </ul>
                      </details>
                    )}
                    <Link to="/admin/clientes">Ver cadastros de UCs</Link>
                    {usina.modalidades.length > 0 && (
                      <details>
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
                    {nivel === 3 && usina.nome.toLowerCase() !== "ecosol" && (
                      <button
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
                                {item.cliente_nome ?? item.nome} · UC {item.uc}
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
                          Confira a identidade e a UC antes de criar o vínculo.
                          Transferências entre usinas exigem um processo
                          separado.
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
                </article>
              ))}
            </div>
          ))}
      </section>
      {usinaDoCadastro && (
        <section className="admin-cartao">
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
      {nivel === 3 && (
        <ImportacaoVinculosUsinas
          usinas={usinas.map(({ id, nome }) => ({ id, nome }))}
          aoImportar={() => {
            consulta.atualizar();
            unidades.atualizar();
          }}
        />
      )}
    </>
  );
}
