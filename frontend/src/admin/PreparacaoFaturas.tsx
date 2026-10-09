import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { sugerirVencimentoEcosol } from "./vencimentoEcosol";
import { unidadeDaFatura } from "./vinculoAutomaticoFatura";
import {
  modalidadeDaUcNaCompetencia,
  pendenciasParaCalculo,
  situacaoParaEmissao,
} from "./prontidaoFatura";
import {
  consultarServidor,
  formatarDinheiro,
  usarConsulta,
} from "./comunicacaoComServidor";
import { EstadoDaConsulta } from "./ComponentesDoPainel";
import { usarAdministrador } from "./EstruturaAdministrativa";
import type { Unidade, Contrato } from "./UnidadesDeCobranca";

type Memoria = {
  regra: string;
  entradas: {
    injecao: string;
    unitario: string;
    bandeira: string;
    desconto: string;
    total_equatorial: string;
    ajuste_gdii: string;
    modalidade: string;
  };
  tarifa_completa: string;
  consumo_centavos: number;
  equatorial_centavos: number;
  ajuste_centavos: number;
  total_centavos: number;
  unidade: Unidade;
  contrato: Pick<Contrato, "modalidade" | "desconto" | "inicio"> & {
    origem?: string;
    desconto_inicio?: string;
  };
  vencimento_ecosol: string;
  fonte: { tipo: string; documento_id: number };
};
type PreviaCalculo = { memoria: Memoria; hash: string; versao: number };
type Documento = {
  id: number;
  nome: string;
  lote: string;
  status: string;
  versao: number;
  dados: Record<string, string>;
  extracao: {
    dados?: Record<string, string>;
    avisos: string[];
    evidencias: Record<string, string>;
    paginas?: number;
    qualidade?: {
      modo: string;
      campos_identificados: number;
      campos_esperados: number;
      percentual: number;
      pendencias: string[];
    };
  };
  memoria: Memoria | null;
  texto?: string;
  historico?: { acao: string; responsavel: string; criado_em: string }[];
};
type Recebimento = {
  id: number;
  nome: string;
  lote: string;
  origem: "legado" | "manual" | "gmail";
  resultado: "Recebida" | "Requer atenção" | "Erro" | "Duplicada";
  codigo: "ok" | "duplicada" | "ilegivel" | "invalida";
  motivo: string;
  documento_id: number | null;
  estado_documento: string | null;
  criado_em: string;
  dados: Record<string, string> | null;
  memoria: Memoria | null;
};
const base = "/api/admin/faturamento/documentos";
const aprovada = "Aprovada — aguardando emissão";
const normalizarBuscaCliente = (valor: string) =>
  valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
const secaoDaPendencia = (pendencia: string) => {
  if (/cliente|UC/.test(pendencia)) return "cadastro";
  if (/competência|energia injetada|total Equatorial/.test(pendencia))
    return "equatorial";
  if (/vencimento/.test(pendencia)) return "datas";
  return "ecosol";
};

function DemonstrativoCalculo({
  memoria,
  previa = false,
}: {
  memoria: Memoria;
  previa?: boolean;
}) {
  const entrada = memoria.entradas;
  const decimalBr = (valor: string) => valor.replace(".", ",");
  const semInjecao = memoria.regra === "ecosol-v1-sem-injecao";
  return (
    <div className="faturamento-demonstrativo">
      <h3>
        {previa
          ? "Prévia do cálculo — não salva"
          : "Demonstrativo interno — sem validade para pagamento"}
      </h3>
      {semInjecao && (
        <p>
          Sem injeção SCEE: não há cobrança de energia Ecosol, tarifa, desconto
          ou ajuste GDII. O total é somente o valor Equatorial.
        </p>
      )}
      <dl>
        <div>
          <dt>Energia injetada</dt>
          <dd>{decimalBr(entrada.injecao)} kWh</dd>
        </div>
        {!semInjecao && (
          <>
            <div>
              <dt>Unitário com tributos</dt>
              <dd>R$ {decimalBr(entrada.unitario)}/kWh</dd>
            </div>
            <div>
              <dt>+ Bandeira</dt>
              <dd>R$ {decimalBr(entrada.bandeira)}/kWh</dd>
            </div>
            <div>
              <dt>= Tarifa completa</dt>
              <dd>R$ {decimalBr(memoria.tarifa_completa)}/kWh</dd>
            </div>
            <div>
              <dt>Desconto da UC</dt>
              <dd>{decimalBr(entrada.desconto)}%</dd>
            </div>
          </>
        )}
        <div>
          <dt>{semInjecao ? "Energia Ecosol" : "Consumo com desconto"}</dt>
          <dd>{formatarDinheiro(memoria.consumo_centavos)}</dd>
        </div>
        <div>
          <dt>+ Total Equatorial</dt>
          <dd>{formatarDinheiro(memoria.equatorial_centavos)}</dd>
        </div>
        {!semInjecao && (
          <div>
            <dt>− Ajuste GDII</dt>
            <dd>{formatarDinheiro(memoria.ajuste_centavos)}</dd>
          </div>
        )}
        <div className="faturamento-total">
          <dt>Valor Ecosol</dt>
          <dd>{formatarDinheiro(memoria.total_centavos)}</dd>
        </div>
      </dl>
      <p>
        {entrada.modalidade} · Vencimento Ecosol:{" "}
        {memoria.vencimento_ecosol.split("-").reverse().join("/")} · Fonte da
        tarifa:{" "}
        {semInjecao ? "não aplicável" : `fatura #${memoria.fonte.documento_id}`}
      </p>
      <small>
        {semInjecao
          ? "Cálculo: 0 kWh injetado; total Ecosol igual ao total Equatorial, sem desconto ou ajuste."
          : "Cálculo: energia injetada × tarifa completa × (1 − desconto/100), arredondado a centavos; depois soma o total Equatorial e subtrai o ajuste GDII."}
      </small>
    </div>
  );
}

export default function PreparacaoFaturas() {
  const navegar = useNavigate();
  const consulta = usarConsulta<Documento[]>(base);
  const recebimentos = usarConsulta<Recebimento[]>(
    "/api/admin/faturamento/recebimentos",
  );
  const unidades = usarConsulta<Unidade[]>("/api/admin/faturamento/unidades");
  const clientesPortal = usarConsulta<{ id: number; name: string }[]>(
    "/api/admin/faturamento/clientes",
  );
  const { nivel } = usarAdministrador();
  const [exportacaoAberta, setExportacaoAberta] = useState(false);
  const [evidenciasAbertas, setEvidenciasAbertas] = useState(false);
  const usinas = usarConsulta<{ id: number; nome: string }[]>(
    exportacaoAberta ? "/api/admin/usinas" : null,
  );
  const [usinaExportacao, setUsinaExportacao] = useState("");
  const [selecionado, setSelecionado] = useState<Documento | null>(null);
  const [previa, setPrevia] = useState<PreviaCalculo | null>(null);
  const [dados, setDados] = useState<Record<string, string>>({});
  const [alterado, setAlterado] = useState(false);
  const [conferido, setConferido] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("");
  const [renomeando, setRenomeando] = useState<{
    documentoId: number;
    versao: number;
    nomeAnterior: string;
    origem: "lista" | "detalhe";
    recebimentoId?: number;
  } | null>(null);
  const [nomeEditado, setNomeEditado] = useState("");
  const [buscaCliente, setBuscaCliente] = useState("");
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false);
  const [sugestaoAtiva, setSugestaoAtiva] = useState(0);
  const cancelarRenomeacao = useRef(false);
  const salvandoRenomeacao = useRef(false);

  useEffect(() => {
    if (
      !selecionado ||
      (selecionado.memoria && !alterado) ||
      selecionado.status === aprovada ||
      alterado ||
      dados.unidade_id ||
      !unidades.dados
    )
      return;
    const encontrada = unidadeDaFatura(
      dados,
      selecionado.extracao.dados?.uc,
      selecionado.nome,
      unidades.dados,
    );
    if (!encontrada) return;
    setDados((anterior) => ({
      ...anterior,
      uc: encontrada.uc,
      unidade_id: String(encontrada.id),
      cliente_id: encontrada.cliente_id ? String(encontrada.cliente_id) : "",
      vencimento_ecosol:
        anterior.vencimento_ecosol ||
        (encontrada.dia_vencimento >= 1 && encontrada.dia_vencimento <= 31
          ? sugerirVencimentoEcosol(encontrada.dia_vencimento)
          : ""),
    }));
    setBuscaCliente(encontrada.cliente_nome ?? encontrada.nome);
    setAlterado(true);
    setConferido(false);
  }, [selecionado, unidades.dados, dados, alterado]);

  function mostrar(d: Documento) {
    if (selecionado?.id !== d.id) setEvidenciasAbertas(false);
    setSelecionado(d);
    setPrevia(null);
    setDados(d.dados);
    const unidadeSalva = unidades.dados?.find(
      (item) => item.id === Number(d.dados.unidade_id),
    );
    setBuscaCliente(
      unidadeSalva?.cliente_nome ?? d.memoria?.unidade.cliente_nome ?? "",
    );
    setSugestoesAbertas(false);
    setSugestaoAtiva(0);
    setAlterado(false);
    setConferido(false);
  }
  async function abrir(numero: number) {
    setOcupado(true);
    setErro("");
    setMensagem("");
    try {
      mostrar(await consultarServidor<Documento>(`${base}/${numero}`));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  function iniciarRenomeacao(
    d: Documento,
    origem: "lista" | "detalhe",
    recebimentoId?: number,
  ) {
    if (ocupado || renomeando || nivel < 2 || d.status === aprovada) return;
    cancelarRenomeacao.current = false;
    setRenomeando({
      documentoId: d.id,
      versao: d.versao,
      nomeAnterior: d.nome,
      origem,
      recebimentoId,
    });
    setNomeEditado(d.nome.replace(/\.pdf$/i, ""));
    setErro("");
    setMensagem("");
  }
  async function salvarNomeEditado() {
    if (cancelarRenomeacao.current || !renomeando || salvandoRenomeacao.current)
      return;
    const alvo = renomeando;
    const parteEditada = nomeEditado.trim();
    if (!parteEditada) {
      setErro("Informe um nome para o PDF.");
      return;
    }
    const novoNome = /\.pdf$/i.test(parteEditada)
      ? parteEditada
      : `${parteEditada}.pdf`;
    if (novoNome === alvo.nomeAnterior) {
      setRenomeando(null);
      return;
    }
    salvandoRenomeacao.current = true;
    setOcupado(true);
    setErro("");
    setMensagem("");
    try {
      const atualizado = await consultarServidor<Documento>(
        `${base}/${alvo.documentoId}/renomear`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versao: alvo.versao, nome: novoNome }),
        },
      );
      setSelecionado((atual) =>
        atual?.id === atualizado.id
          ? {
              ...atual,
              nome: atualizado.nome,
              versao: atualizado.versao,
              historico: atualizado.historico,
            }
          : atual,
      );
      if (selecionado?.id === atualizado.id) {
        setPrevia(null);
        setConferido(false);
      }
      setRenomeando(null);
      consulta.atualizar();
      recebimentos.atualizar();
      setMensagem(`Arquivo renomeado para ${atualizado.nome}.`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      salvandoRenomeacao.current = false;
      setOcupado(false);
    }
  }
  function editorNome() {
    return (
      <span className="faturamento-renomear">
        <input
          autoFocus
          aria-label="Novo nome do PDF"
          value={nomeEditado}
          maxLength={196}
          onChange={(e) => setNomeEditado(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => {
            if (cancelarRenomeacao.current) {
              cancelarRenomeacao.current = false;
              return;
            }
            void salvarNomeEditado();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelarRenomeacao.current = true;
              setRenomeando(null);
            }
          }}
        />
        <span>.pdf</span>
      </span>
    );
  }
  async function excluirSelecionado() {
    if (!selecionado || selecionado.status !== "Pendente de revisão") return;
    const confirmacao = window.prompt(
      `Excluir definitivamente ${selecionado.nome} do Ecosol? O PDF e os dados extraídos serão removidos, mas o e-mail e o anexo no Gmail não serão apagados. Digite EXCLUIR para confirmar:`,
    );
    if (confirmacao !== "EXCLUIR") return;
    setOcupado(true);
    setErro("");
    setMensagem("");
    try {
      await consultarServidor(`${base}/${selecionado.id}/excluir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versao: selecionado.versao,
          confirmacao,
        }),
      });
      setSelecionado(null);
      setEvidenciasAbertas(false);
      setPrevia(null);
      setMensagem(
        "PDF excluído do Ecosol. O e-mail no Gmail permanece intacto.",
      );
      consulta.atualizar();
      recebimentos.atualizar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  async function importar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOcupado(true);
    setErro("");
    setMensagem("");
    const form = e.currentTarget,
      campos = new FormData(form),
      arquivo = campos.get("pdf") as File;
    try {
      if (!arquivo?.size || arquivo.size > 10 * 1024 * 1024)
        throw new Error("Selecione um PDF com até 10 MB.");
      const params = new URLSearchParams({
        lote: String(campos.get("lote")).trim(),
        nome: arquivo.name,
      });
      const d = await consultarServidor<Documento>(`${base}?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: arquivo,
      });
      mostrar(d);
      consulta.atualizar();
      recebimentos.atualizar();
      setMensagem(
        "PDF importado. Confira os dados sugeridos antes de calcular.",
      );
      form.reset();
    } catch (e) {
      setErro((e as Error).message);
      recebimentos.atualizar();
    } finally {
      setOcupado(false);
    }
  }
  async function reanalisarPendentes() {
    if (alterado) {
      setErro(
        "Salve ou descarte as alterações desta fatura antes de reanalisar.",
      );
      return;
    }
    const pendentes =
      consulta.dados?.filter(
        (d) => d.status === "Pendente de revisão" && !d.memoria,
      ) ?? [];
    if (!pendentes.length) return;
    if (
      !window.confirm(
        `Reanalisar ${pendentes.length} PDF(s) pendente(s)? Campos vazios e tarifas unitárias extraídas incorretamente poderão ser corrigidos apenas nas faturas sem conferência manual anterior. Nenhum cálculo ou aprovação será feito.`,
      )
    )
      return;
    setOcupado(true);
    setErro("");
    setMensagem("");
    let atualizadas = 0;
    let preenchidas = 0;
    let corrigidas = 0;
    let preservadas = 0;
    const falhas: number[] = [];
    try {
      for (const [indice, d] of pendentes.entries()) {
        setMensagem(`Reanalisando ${indice + 1} de ${pendentes.length}...`);
        try {
          const resultado = await consultarServidor<{
            atualizado: boolean;
            preenchidos: string[];
            corrigidos: string[];
            dadosManuaisPreservados: boolean;
          }>(`${base}/${d.id}/reanalisar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ versao: d.versao }),
          });
          if (resultado.atualizado) atualizadas++;
          preenchidas += resultado.preenchidos.length;
          corrigidas += resultado.corrigidos.length;
          if (resultado.dadosManuaisPreservados) preservadas++;
        } catch {
          falhas.push(d.id);
        }
      }
      if (selecionado) {
        try {
          mostrar(
            await consultarServidor<Documento>(`${base}/${selecionado.id}`),
          );
        } catch {
          setSelecionado(null);
        }
      }
      consulta.atualizar();
      recebimentos.atualizar();
      setMensagem(
        `${atualizadas} fatura(s) atualizada(s), ${preenchidas} campo(s) vazio(s) preenchido(s), ${corrigidas} tarifa(s) extraída(s) corrigida(s). ${preservadas} com dados manuais preservados.`,
      );
      if (falhas.length)
        setErro(
          `${falhas.length} fatura(s) não foram reanalisadas (IDs ${falhas.join(", ")}). Atualize a fila e tente novamente.`,
        );
    } finally {
      setOcupado(false);
    }
  }
  async function acao(tipo: "salvar" | "calcular" | "aprovar") {
    if (!selecionado) return;
    if (
      tipo === "calcular" &&
      (!previa || previa.versao !== selecionado.versao)
    ) {
      setErro("Gere e confira a prévia antes de salvar e calcular.");
      return;
    }
    setOcupado(true);
    setErro("");
    setMensagem("");
    try {
      let d = selecionado;
      if (tipo === "salvar") {
        d = await consultarServidor<Documento>(`${base}/${d.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versao: d.versao, dados }),
        });
      } else {
        d = await consultarServidor<Documento>(`${base}/${d.id}/${tipo}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            versao: d.versao,
            conferido,
            ...(tipo === "calcular"
              ? { dados, previa_hash: previa?.hash }
              : {}),
          }),
        });
      }
      mostrar(d);
      setMensagem(
        tipo === "aprovar"
          ? "Aprovação interna registrada. A cobrança aguarda emissão futura."
          : tipo === "calcular"
            ? "Cálculo concluído. Confira o demonstrativo abaixo."
            : "Conferência salva.",
      );
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      consulta.atualizar();
      setOcupado(false);
    }
  }
  function mudar(chave: string, valor: string) {
    setDados((anterior) => ({ ...anterior, [chave]: valor }));
    setPrevia(null);
    setAlterado(true);
    setConferido(false);
  }
  function digitarCliente(valor: string) {
    setBuscaCliente(valor);
    setSugestoesAbertas(Boolean(valor.trim()));
    setSugestaoAtiva(0);
    setDados((anterior) => ({
      ...anterior,
      unidade_id: "",
      cliente_id: "",
      uc_divergente_confirmada: "",
    }));
    setPrevia(null);
    setAlterado(true);
    setConferido(false);
  }
  function escolherCliente(unidadeEscolhida: Unidade) {
    if (!unidadeEscolhida.cliente_id || !unidadeEscolhida.cliente_nome) return;
    const ucDoPdf = String(selecionado?.extracao.dados?.uc ?? "").replace(
      /\D/g,
      "",
    );
    if (
      ucDoPdf &&
      ucDoPdf !== unidadeEscolhida.uc &&
      !window.confirm(
        `A UC ${unidadeEscolhida.uc} do cliente escolhido difere da UC ${ucDoPdf} lida no PDF. Confirme no PDF antes de vincular esta fatura. Deseja continuar?`,
      )
    )
      return;
    setBuscaCliente(unidadeEscolhida.cliente_nome);
    setSugestoesAbertas(false);
    setDados((anterior) => ({
      ...anterior,
      unidade_id: String(unidadeEscolhida.id),
      cliente_id: String(unidadeEscolhida.cliente_id),
      uc: unidadeEscolhida.uc,
      uc_divergente_confirmada:
        ucDoPdf && ucDoPdf !== unidadeEscolhida.uc ? "sim" : "",
      vencimento_ecosol: sugerirVencimentoEcosol(
        unidadeEscolhida.dia_vencimento,
      ),
    }));
    setPrevia(null);
    setAlterado(true);
    setConferido(false);
  }
  function abrirCadastroComNome() {
    if (
      alterado &&
      !window.confirm(
        "Há alterações não salvas nesta fatura. Deseja ir ao cadastro mesmo assim?",
      )
    )
      return;
    navegar("/admin/clientes", {
      state: {
        nomeInicialCliente: buscaCliente.trim().slice(0, 120),
        ucInicial: dados.uc || selecionado?.extracao.dados?.uc || "",
      },
    });
  }
  function abrirVinculoCliente(clienteId: number) {
    if (
      alterado &&
      !window.confirm(
        "Há alterações não salvas nesta fatura. Deseja ir ao cadastro mesmo assim?",
      )
    )
      return;
    navegar("/admin/clientes", {
      state: {
        clienteParaVincular: clienteId,
        ucInicial: dados.uc || selecionado?.extracao.dados?.uc || "",
      },
    });
  }
  async function gerarPrevia() {
    if (!selecionado) return;
    setOcupado(true);
    setErro("");
    setMensagem("");
    setPrevia(null);
    try {
      const resultado = await consultarServidor<PreviaCalculo>(
        `${base}/${selecionado.id}/previa`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versao: selecionado.versao, dados }),
        },
      );
      setPrevia(resultado);
      setMensagem(
        "Prévia pronta. Confira os valores antes de salvar e calcular.",
      );
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  function campo(
    chave: string,
    rotulo: string,
    tipo = "text",
    placeholder = "",
  ) {
    return (
      <label>
        {rotulo}
        <input
          type={tipo}
          value={dados[chave] ?? ""}
          maxLength={80}
          placeholder={placeholder}
          inputMode={tipo === "text" ? "decimal" : undefined}
          onChange={(e) => mudar(chave, e.target.value)}
        />
      </label>
    );
  }
  const uc = (dados.uc ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const unidade =
    selecionado?.memoria && !alterado
      ? selecionado.memoria.unidade
      : unidades.dados?.find(
          (u) =>
            u.id === Number(dados.unidade_id) &&
            u.uc === uc &&
            (u.cliente_id === Number(dados.cliente_id) ||
              (u.cliente_provisorio_id != null && !dados.cliente_id)),
        );
  const modalidadeDaUsina = modalidadeDaUcNaCompetencia(
    unidade,
    dados.competencia ?? "",
  );
  useEffect(() => {
    if (
      !selecionado ||
      (selecionado.memoria && !alterado) ||
      selecionado.status === aprovada ||
      !modalidadeDaUsina ||
      dados.modalidade === modalidadeDaUsina.modalidade
    )
      return;
    setDados((anterior) => ({
      ...anterior,
      modalidade: modalidadeDaUsina.modalidade,
    }));
    setPrevia(null);
    setAlterado(true);
    setConferido(false);
  }, [selecionado, alterado, modalidadeDaUsina, dados.modalidade]);
  const termoCliente = normalizarBuscaCliente(buscaCliente);
  const sugestoesCliente = termoCliente
    ? (clientesPortal.dados ?? [])
        .filter((item) =>
          normalizarBuscaCliente(item.name).includes(termoCliente),
        )
        .sort((a, b) => {
          const prefixoA = normalizarBuscaCliente(a.name).startsWith(
            termoCliente,
          );
          const prefixoB = normalizarBuscaCliente(b.name).startsWith(
            termoCliente,
          );
          return (
            Number(prefixoB) - Number(prefixoA) ||
            a.name.localeCompare(b.name, "pt-BR")
          );
        })
        .slice(0, 8)
    : [];
  const modalidadeInformada = (
    selecionado?.memoria && !alterado
      ? selecionado.memoria.contrato.modalidade
      : unidade?.usina_id
        ? (modalidadeDaUsina?.modalidade ?? dados.modalidade ?? "")
        : (dados.modalidade ?? "")
  ).trim();
  const injecaoInformada = String(dados.injecao ?? "").trim();
  const semInjecao =
    injecaoInformada !== "" && Number(injecaoInformada.replace(",", ".")) === 0;
  const descontoVigente = unidade?.descontos
    ?.filter((d) => d.inicio <= (dados.competencia ?? ""))
    .sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
  const contrato =
    selecionado?.memoria && !alterado
      ? selecionado.memoria.contrato
      : modalidadeInformada
        ? semInjecao
          ? {
              modalidade: modalidadeInformada,
              desconto: "0",
              inicio: dados.competencia ?? "",
              origem: "sem_injecao_sem_desconto",
            }
          : descontoVigente
            ? {
                modalidade: modalidadeInformada,
                desconto: descontoVigente.desconto,
                inicio: dados.competencia ?? "",
                origem: "modalidade_na_fatura_desconto_na_uc",
                desconto_inicio: descontoVigente.inicio,
              }
            : null
        : null;
  const referencias =
    consulta.dados?.filter(
      (d) =>
        d.id !== selecionado?.id &&
        d.lote === selecionado?.lote &&
        d.status === aprovada &&
        d.memoria?.contrato.modalidade === "GDI",
    ) ?? [];
  const memoria = !alterado ? selecionado?.memoria : null;
  const bloqueado = ocupado || nivel < 2 || selecionado?.status === aprovada;
  const faltantes = selecionado
    ? pendenciasParaCalculo(
        selecionado,
        unidades.dados ?? [],
        consulta.dados ?? [],
        dados,
      )
    : [];
  const lista = (recebimentos.dados ?? []).filter(
    (r) =>
      (!filtro || r.resultado === filtro) &&
      `${r.nome} ${r.lote} ${r.dados?.uc ?? ""} ${r.motivo}`
        .toLowerCase()
        .includes(busca.toLowerCase()),
  );
  const documentosPorId = new Map(
    (consulta.dados ?? []).map((documento) => [documento.id, documento]),
  );
  const etapa =
    selecionado?.status === aprovada ? 4 : memoria ? 3 : selecionado ? 2 : 1;
  const totalRecebidas =
    recebimentos.dados?.filter((r) => r.resultado === "Recebida").length ?? 0;
  const totalAtencao =
    recebimentos.dados?.filter(
      (r) => r.resultado === "Requer atenção" || r.resultado === "Erro",
    ).length ?? 0;
  const totalDuplicadas =
    recebimentos.dados?.filter((r) => r.resultado === "Duplicada").length ?? 0;
  const totalAprovadas =
    consulta.dados?.filter((d) => d.status === aprovada).length ?? 0;
  const pendenciasLeitura =
    selecionado?.extracao.qualidade?.pendencias.filter(
      (pendencia) =>
        !semInjecao ||
        (pendencia !== "Preço unitário" && pendencia !== "Bandeira"),
    ) ?? [];
  const avisosAplicaveis =
    selecionado?.extracao.avisos.filter(
      (aviso) =>
        !semInjecao ||
        (!aviso.startsWith("Confira todos os campos com o PDF") &&
          !aviso.startsWith("Bandeira não identificada")),
    ) ?? [];

  return (
    <>
      <div className="faturamento-contexto" role="note">
        <span aria-hidden="true">☀</span>
        <div>
          <strong>Conferência interna</strong>
          <p>
            Revise o PDF, calcule e aprove o valor. A emissão pelo Sicoob ainda
            não acontece nesta tela.
          </p>
        </div>
      </div>
      <ol className="faturamento-etapas" aria-label="Etapas da preparação">
        {["Receber PDF", "Conferir dados", "Calcular", "Aprovar"].map(
          (nome, indice) => (
            <li
              className={
                indice + 1 < etapa
                  ? "concluida"
                  : indice + 1 === etapa
                    ? "atual"
                    : ""
              }
              key={nome}
            >
              <span>{indice + 1}</span>
              <strong>{nome}</strong>
            </li>
          ),
        )}
      </ol>
      <div className="faturamento-indicadores" aria-label="Resumo das faturas">
        <span>
          <strong>{recebimentos.dados?.length ?? 0}</strong> ocorrências
        </span>
        <span className="correto">
          <strong>{totalRecebidas}</strong> recebidas
        </span>
        <span className={totalAtencao ? "atencao" : ""}>
          <strong>{totalAtencao}</strong> com atenção
        </span>
        <span>
          <strong>{totalDuplicadas}</strong> duplicadas
        </span>
        <span className="solar">
          <strong>{totalAprovadas}</strong> aprovadas
        </span>
      </div>
      {nivel >= 2 && (
        <form className="faturamento-importacao" onSubmit={importar}>
          <div>
            <span className="faturamento-passo">1</span>
            <h2>Adicionar fatura</h2>
            <p>
              Informe o lote e selecione o PDF da Equatorial. O arquivo original
              fica preservado.
            </p>
          </div>
          <fieldset className="admin-campos" disabled={ocupado}>
            <label>
              Lote de processamento
              <input
                name="lote"
                placeholder="Ex.: Setembro 2026 — Goiás"
                maxLength={80}
                required
              />
            </label>
            <label className="faturamento-arquivo">
              <span>Arquivo PDF · até 10 MB</span>
              <input
                name="pdf"
                type="file"
                accept="application/pdf,.pdf"
                required
              />
            </label>
          </fieldset>
          <button className="admin-botao" disabled={ocupado}>
            {ocupado ? "Lendo PDF…" : "Adicionar à fila"}
          </button>
        </form>
      )}
      {nivel >= 3 && (
        <div className="admin-aviso">
          <button
            className="admin-botao secundario"
            type="button"
            disabled={
              ocupado ||
              !consulta.dados?.some(
                (d) => d.status === "Pendente de revisão" && !d.memoria,
              )
            }
            onClick={reanalisarPendentes}
          >
            Reanalisar faturas pendentes
          </button>
          <p>
            Refaz a leitura dos PDFs existentes. Preserva edições manuais e não
            calcula nem aprova cobranças.
          </p>
        </div>
      )}
      <EstadoDaConsulta {...consulta} repetir={consulta.atualizar} />
      <EstadoDaConsulta {...recebimentos} repetir={recebimentos.atualizar} />
      <EstadoDaConsulta {...unidades} repetir={unidades.atualizar} />
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
      <div className="faturamento-bancada">
        <aside className="faturamento-fila" aria-label="Fila de faturas">
          <header>
            <div>
              <span className="admin-sobretitulo">Fila de trabalho</span>
              <h2>Faturas recebidas</h2>
            </div>
            <strong>{lista.length}</strong>
          </header>
          <div className="faturamento-filtros">
            <input
              aria-label="Buscar fatura enviada"
              placeholder="Buscar por nome, lote ou UC"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <select
              aria-label="Filtrar resultado do envio"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            >
              <option value="">Todos os estados</option>
              <option value="Recebida">Faturas recebidas</option>
              <option value="Requer atenção">Requerem atenção</option>
              <option value="Erro">Com erro</option>
              <option value="Duplicada">Duplicadas</option>
            </select>
          </div>
          <div className="faturamento-lista" role="list">
            {lista.map((r) => {
              const documentoDaFila = r.documento_id
                ? documentosPorId.get(r.documento_id)
                : null;
              const situacao =
                r.resultado === "Recebida" &&
                documentoDaFila &&
                consulta.dados &&
                unidades.dados
                  ? situacaoParaEmissao(
                      documentoDaFila,
                      unidades.dados,
                      consulta.dados,
                    )
                  : null;
              const cor =
                situacao?.cor ??
                (r.resultado === "Erro"
                  ? "incompleta"
                  : r.resultado === "Duplicada"
                    ? "duplicada"
                    : r.resultado === "Requer atenção"
                      ? "atencao"
                      : "");
              return (
                <article
                  className={`faturamento-item ${cor} ${selecionado?.id === r.documento_id ? "selecionado" : ""}`}
                  key={r.id}
                  role="listitem"
                >
                  <span className="faturamento-estado-icone" aria-hidden="true">
                    {situacao?.cor === "incompleta"
                      ? "!"
                      : r.resultado === "Recebida"
                        ? "○"
                        : r.resultado === "Duplicada"
                          ? "↺"
                          : r.resultado === "Erro"
                            ? "!"
                            : "i"}
                  </span>
                  <div className="faturamento-item-arquivo">
                    {renomeando?.origem === "lista" &&
                    renomeando.recebimentoId === r.id ? (
                      editorNome()
                    ) : documentoDaFila &&
                      nivel >= 2 &&
                      documentoDaFila.status !== aprovada ? (
                      <button
                        type="button"
                        className="faturamento-nome-botao"
                        title="Clique para renomear"
                        aria-label={`Renomear ${r.nome}`}
                        disabled={ocupado}
                        onClick={() =>
                          iniciarRenomeacao(documentoDaFila, "lista", r.id)
                        }
                      >
                        {r.nome}
                      </button>
                    ) : (
                      <strong title={r.nome}>{r.nome}</strong>
                    )}
                    <span>
                      {r.lote} ·{" "}
                      {r.origem === "gmail"
                        ? "Gmail"
                        : r.origem === "manual"
                          ? "Envio manual"
                          : "Origem anterior"}
                    </span>
                  </div>
                  <span className={`faturamento-situacao ${cor}`}>
                    {situacao?.texto ??
                      (r.resultado === "Recebida"
                        ? "Verificando dados"
                        : r.resultado)}
                  </span>
                  <div className="faturamento-item-estado">
                    <span>
                      {situacao?.pendencias.length
                        ? `Falta: ${situacao.pendencias.join(", ")}.`
                        : situacao
                          ? situacao.texto === "Aguardando emissão"
                            ? "Aprovada internamente; boleto ainda não emitido."
                            : "Confira os dados antes de emitir o boleto."
                          : r.motivo}
                    </span>
                    <small>
                      UC {r.dados?.uc || "não identificada"} ·{" "}
                      {r.dados?.competencia || "competência pendente"}
                    </small>
                  </div>
                  {r.documento_id ? (
                    <button
                      type="button"
                      className="faturamento-abrir"
                      disabled={ocupado}
                      onClick={() => abrir(r.documento_id!)}
                      aria-label={`Revisar ${r.nome}`}
                    >
                      {selecionado?.id === r.documento_id
                        ? "Em revisão"
                        : r.codigo === "duplicada"
                          ? "Abrir original"
                          : "Revisar"}
                      <span aria-hidden="true">→</span>
                    </button>
                  ) : (
                    <span className="faturamento-sem-acao">
                      Envie outro PDF para continuar
                    </span>
                  )}
                </article>
              );
            })}
            {!lista.length && (
              <div className="faturamento-fila-vazia">
                <span aria-hidden="true">☀</span>
                <strong>Nenhuma fatura encontrada</strong>
                <p>Altere os filtros ou adicione um PDF acima.</p>
              </div>
            )}
          </div>
        </aside>
        <section className="faturamento-revisao" aria-live="polite">
          {!selecionado ? (
            <div className="faturamento-selecione">
              <span aria-hidden="true">↗</span>
              <h2>Selecione uma fatura</h2>
              <p>
                Escolha “Revisar” na fila. Os dados extraídos e o PDF ficarão
                reunidos aqui.
              </p>
            </div>
          ) : (
            <>
              <header className="faturamento-revisao-cabecalho">
                <div>
                  <span className="admin-sobretitulo">
                    Conferência #{selecionado.id}
                  </span>
                  <h2>
                    {renomeando?.origem === "detalhe" &&
                    renomeando.documentoId === selecionado.id ? (
                      editorNome()
                    ) : nivel >= 2 && selecionado.status !== aprovada ? (
                      <button
                        type="button"
                        className="faturamento-nome-botao"
                        title="Clique para renomear"
                        aria-label={`Renomear ${selecionado.nome}`}
                        disabled={ocupado}
                        onClick={() =>
                          iniciarRenomeacao(selecionado, "detalhe")
                        }
                      >
                        {selecionado.nome}
                      </button>
                    ) : (
                      selecionado.nome
                    )}
                  </h2>
                  <p>Lote: {selecionado.lote}</p>
                </div>
                <div className="faturamento-revisao-opcoes">
                  <span
                    className={`admin-status ${selecionado.status === aprovada || selecionado.status === "Calculada" || !faltantes.length ? "aguardando" : "incompleta"}`}
                  >
                    {selecionado.status === aprovada
                      ? "Aguardando emissão"
                      : selecionado.status === "Calculada"
                        ? "Aguardando aprovação"
                        : faltantes.length
                          ? "Dados pendentes"
                          : "Pronta para avaliação"}
                  </span>
                  <a
                    className="admin-botao secundario"
                    href={`${base}/${selecionado.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir PDF
                  </a>
                  {nivel >= 3 &&
                    selecionado.status === "Pendente de revisão" &&
                    !selecionado.memoria && (
                      <button
                        type="button"
                        className="admin-botao perigo"
                        disabled={ocupado}
                        onClick={excluirSelecionado}
                      >
                        Excluir PDF
                      </button>
                    )}
                  <button
                    className="faturamento-fechar"
                    disabled={ocupado}
                    onClick={() => {
                      setSelecionado(null);
                      setEvidenciasAbertas(false);
                    }}
                    aria-label="Fechar conferência"
                  >
                    ×
                  </button>
                </div>
              </header>
              <div
                className={`faturamento-resumo ${faltantes.length ? "pendente" : "pronto"}`}
                role="status"
              >
                <strong>
                  {selecionado.status === aprovada
                    ? "Aprovada para emissão futura"
                    : selecionado.status === "Calculada"
                      ? "Cálculo concluído; aguarda aprovação"
                      : faltantes.length
                        ? `${faltantes.length} ${faltantes.length === 1 ? "pendência" : "pendências"} para avançar`
                        : "Dados completos para avaliação"}
                </strong>
                {faltantes.length > 0 &&
                  selecionado.status !== aprovada &&
                  selecionado.status !== "Calculada" && (
                    <ul aria-label="Dados que faltam">
                      {faltantes.map((pendencia) => (
                        <li key={pendencia}>
                          <a
                            href={`#conferencia-${secaoDaPendencia(pendencia)}`}
                          >
                            {pendencia} <span aria-hidden="true">↗</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                {selecionado.status !== aprovada &&
                  selecionado.status !== "Calculada" &&
                  !faltantes.length && (
                    <span>Confira os campos com o PDF antes de calcular.</span>
                  )}
              </div>
              {(selecionado.extracao.qualidade ||
                pendenciasLeitura.length > 0 ||
                avisosAplicaveis.length > 0) && (
                <details className="faturamento-leitura-detalhes">
                  <summary>
                    Leitura do PDF
                    {selecionado.extracao.qualidade
                      ? ` · ${selecionado.extracao.qualidade.campos_identificados}/${selecionado.extracao.qualidade.campos_esperados} campos reconhecidos`
                      : ""}
                    {pendenciasLeitura.length || avisosAplicaveis.length
                      ? ` · ${pendenciasLeitura.length + avisosAplicaveis.length} observações`
                      : ""}
                  </summary>
                  {pendenciasLeitura.length > 0 && (
                    <p>Confira no PDF: {pendenciasLeitura.join(", ")}.</p>
                  )}
                  {avisosAplicaveis.map((aviso, i) => (
                    <p key={i}>{aviso}</p>
                  ))}
                </details>
              )}
              <div className="faturamento-conferencia">
                <section
                  id="conferencia-cadastro"
                  className="faturamento-grupo faturamento-grupo--cadastro"
                >
                  <div className="faturamento-grupo-titulo">
                    <span>01</span>
                    <div>
                      <small>Cadastro da UC</small>
                      <h3>Cliente e unidade consumidora</h3>
                      <p>Quem está vinculado a esta fatura.</p>
                    </div>
                  </div>
                  <fieldset
                    className="admin-campos faturamento-campos-unicos"
                    disabled={bloqueado}
                  >
                    <div
                      className={`faturamento-cliente-busca ${faltantes.includes("cliente e UC") || faltantes.includes("cadastro definitivo do cliente") ? "faturamento-campo-pendente" : ""}`}
                      onBlur={(e) => {
                        if (
                          !(e.relatedTarget instanceof Node) ||
                          !e.currentTarget.contains(e.relatedTarget)
                        )
                          setSugestoesAbertas(false);
                      }}
                    >
                      <label htmlFor="faturamento-cliente">
                        Cliente responsável pela fatura
                      </label>
                      <input
                        id="faturamento-cliente"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={sugestoesAbertas}
                        aria-controls="faturamento-sugestoes-clientes"
                        autoComplete="off"
                        placeholder="Digite o nome do cliente"
                        value={buscaCliente || unidade?.cliente_nome || ""}
                        maxLength={160}
                        onFocus={() =>
                          setSugestoesAbertas(Boolean(buscaCliente.trim()))
                        }
                        onChange={(e) => digitarCliente(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setSugestoesAbertas(false);
                          } else if (
                            e.key === "ArrowDown" ||
                            e.key === "ArrowUp"
                          ) {
                            e.preventDefault();
                            setSugestoesAbertas(true);
                            setSugestaoAtiva((atual) =>
                              sugestoesCliente.length
                                ? (atual +
                                    (e.key === "ArrowDown" ? 1 : -1) +
                                    sugestoesCliente.length) %
                                  sugestoesCliente.length
                                : 0,
                            );
                          } else if (e.key === "Enter" && sugestoesAbertas) {
                            e.preventDefault();
                            if (sugestoesCliente.length) {
                              const cliente =
                                sugestoesCliente[sugestaoAtiva] ??
                                sugestoesCliente[0];
                              const vinculadas = (unidades.dados ?? []).filter(
                                (item) => item.cliente_id === cliente.id,
                              );
                              const ucLida = (dados.uc ?? "")
                                .replace(/\D/g, "")
                                .replace(/^0+(?=\d)/, "");
                              const correspondente = vinculadas.find(
                                (item) => item.uc === ucLida,
                              );
                              if (correspondente)
                                escolherCliente(correspondente);
                              else if (vinculadas.length === 1 && !ucLida)
                                escolherCliente(vinculadas[0]);
                              else if (nivel >= 2)
                                abrirVinculoCliente(cliente.id);
                            } else if (
                              !clientesPortal.carregando &&
                              !clientesPortal.erro &&
                              nivel >= 2
                            )
                              abrirCadastroComNome();
                          }
                        }}
                      />
                      {sugestoesAbertas && termoCliente && (
                        <div
                          className="faturamento-cliente-sugestoes"
                          id="faturamento-sugestoes-clientes"
                          role="listbox"
                          aria-label="Clientes encontrados"
                        >
                          {sugestoesCliente.map((cliente, indice) => {
                            const vinculadas = (unidades.dados ?? []).filter(
                              (item) => item.cliente_id === cliente.id,
                            );
                            return (
                              <div
                                key={cliente.id}
                                className={
                                  indice === sugestaoAtiva ? "ativa" : ""
                                }
                              >
                                <strong>{cliente.name}</strong>
                                {vinculadas.map((item) => (
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={unidade?.id === item.id}
                                    key={item.id}
                                    onClick={() => escolherCliente(item)}
                                  >
                                    UC {item.uc} · dia preferido{" "}
                                    {item.dia_vencimento}
                                  </button>
                                ))}
                                {nivel >= 2 ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      abrirVinculoCliente(cliente.id)
                                    }
                                  >
                                    + Adicionar ou vincular outra UC
                                  </button>
                                ) : !vinculadas.length ? (
                                  <small>
                                    Solicite à equipe autorizada o vínculo de
                                    uma UC.
                                  </small>
                                ) : null}
                              </div>
                            );
                          })}
                          {!sugestoesCliente.length &&
                            !clientesPortal.carregando &&
                            !clientesPortal.erro &&
                            (nivel >= 2 ? (
                              <button
                                type="button"
                                onClick={abrirCadastroComNome}
                              >
                                + Cadastrar “{buscaCliente.trim()}”
                              </button>
                            ) : (
                              <p>Solicite o cadastro à equipe autorizada.</p>
                            ))}
                          {(clientesPortal.carregando ||
                            unidades.carregando) && <p>Buscando clientes…</p>}
                          {(clientesPortal.erro || unidades.erro) && (
                            <p>Não foi possível buscar clientes.</p>
                          )}
                        </div>
                      )}
                      <small>
                        UC no PDF:{" "}
                        {selecionado.extracao.dados?.uc || "não identificada"}
                        {unidade
                          ? ` · UC do cadastro: ${unidade.uc}`
                          : " · selecione o cliente e a UC"}
                      </small>
                      {unidade?.cliente_provisorio_id != null && (
                        <small className="faturamento-pendente-ajuda">
                          Cadastro provisório, sem acesso ao portal.{" "}
                          <Link to="/admin/clientes">
                            Completar cadastro do cliente
                          </Link>
                        </small>
                      )}
                    </div>
                  </fieldset>
                </section>
                <section
                  id="conferencia-equatorial"
                  className="faturamento-grupo faturamento-grupo--equatorial"
                >
                  <div className="faturamento-grupo-titulo">
                    <span>02</span>
                    <div>
                      <small>Leitura do PDF</small>
                      <h3>Energia e valor Equatorial</h3>
                      <p>Dados apresentados pela distribuidora.</p>
                    </div>
                  </div>
                  <fieldset className="admin-campos" disabled={bloqueado}>
                    {campo("competencia", "Mês de referência", "month")}
                    {campo(
                      "injecao",
                      "Energia injetada SCEE (kWh)",
                      "text",
                      "Ex.: 1660",
                    )}
                    {campo(
                      "total_equatorial",
                      "Total a pagar Equatorial (R$)",
                      "text",
                      "Ex.: 302,40",
                    )}
                  </fieldset>
                  {semInjecao && (
                    <p className="faturamento-nota-conferencia">
                      Injeção SCEE 0 kWh: confirme essa ausência e o total no
                      PDF. Tarifa e desconto não entram no cálculo.
                    </p>
                  )}
                </section>
                <section
                  id="conferencia-ecosol"
                  className="faturamento-grupo faturamento-grupo--ecosol"
                >
                  <div className="faturamento-grupo-titulo">
                    <span>03</span>
                    <div>
                      <small>Regra de cobrança</small>
                      <h3>Condições Ecosol</h3>
                      <p>Modalidade e tarifa usada no cálculo.</p>
                    </div>
                  </div>
                  <fieldset className="admin-campos" disabled={bloqueado}>
                    <label
                      className={
                        !modalidadeInformada ? "faturamento-campo-pendente" : ""
                      }
                    >
                      {unidade?.usina_id
                        ? "Modalidade da usina nesta competência"
                        : "Modalidade desta fatura (UC sem usina)"}
                      <select
                        value={modalidadeInformada}
                        aria-invalid={!modalidadeInformada}
                        disabled={Boolean(
                          unidade?.usina_id && modalidadeDaUsina,
                        )}
                        onChange={(e) => mudar("modalidade", e.target.value)}
                      >
                        <option value="">Selecione</option>
                        <option value="GDI">GDI</option>
                        <option value="GDII">GDII</option>
                      </select>
                      {unidade?.usina_id && (
                        <small>
                          {modalidadeDaUsina
                            ? `Definida pela usina desde ${modalidadeDaUsina.inicio}.`
                            : "Competência anterior à vigência da usina: informe a modalidade desta fatura manualmente."}
                        </small>
                      )}
                    </label>
                    {campo(
                      "ajuste_gdii",
                      semInjecao
                        ? "Ajuste GDII (deve ser 0 sem injeção)"
                        : "Ajuste GDII (R$; informe 0 para GDI)",
                      "text",
                      semInjecao ? "0" : "Ex.: 290,71",
                    )}
                    {!semInjecao && (
                      <label>
                        Origem da tarifa
                        <select
                          value={dados.origem_tarifa ?? "propria"}
                          onChange={(e) =>
                            mudar("origem_tarifa", e.target.value)
                          }
                        >
                          <option value="propria">
                            Componentes conferidos nesta fatura
                          </option>
                          <option value="referencia">
                            GDI aprovada do mesmo lote
                          </option>
                        </select>
                      </label>
                    )}
                    {!semInjecao &&
                      (dados.origem_tarifa === "referencia" ? (
                        <label>
                          Fatura GDI de referência
                          <select
                            value={dados.referencia_id ?? ""}
                            onChange={(e) =>
                              mudar("referencia_id", e.target.value)
                            }
                          >
                            <option value="">Selecione uma referência</option>
                            {referencias.map((r) => (
                              <option key={r.id} value={r.id}>
                                #{r.id} · UC {r.dados.uc} · R${" "}
                                {r.memoria?.tarifa_completa}/kWh
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <>
                          {campo("unitario", "Unitário com tributos (R$/kWh)")}
                          {campo(
                            "bandeira",
                            "Bandeira (R$/kWh; 0 se confirmada ausência)",
                          )}
                        </>
                      ))}
                  </fieldset>
                  {unidade && !semInjecao && contrato && (
                    <p className="faturamento-condicao-resumo">
                      Desconto da UC: <strong>{contrato.desconto}%</strong>
                      {contrato.desconto_inicio &&
                        ` · vigente desde ${contrato.desconto_inicio}`}
                    </p>
                  )}
                </section>
                <section
                  id="conferencia-datas"
                  className="faturamento-grupo faturamento-grupo--datas"
                >
                  <div className="faturamento-grupo-titulo">
                    <span>04</span>
                    <div>
                      <small>Calendário de pagamento</small>
                      <h3>Vencimentos</h3>
                      <p>Compare a data Equatorial e defina a data Ecosol.</p>
                    </div>
                  </div>
                  <fieldset className="admin-campos" disabled={bloqueado}>
                    {campo(
                      "vencimento_equatorial",
                      "Vencimento Equatorial",
                      "date",
                    )}
                    {campo(
                      "vencimento_ecosol",
                      "Vencimento Ecosol (opcional)",
                      "date",
                    )}
                  </fieldset>
                  {!dados.vencimento_ecosol && dados.vencimento_equatorial && (
                    <p className="faturamento-ajuda-vencimento">
                      Sem data Ecosol: será usado o vencimento Equatorial de{" "}
                      <strong>
                        {dados.vencimento_equatorial
                          .split("-")
                          .reverse()
                          .join("/")}
                      </strong>
                      .
                    </p>
                  )}
                </section>
                {selecionado.status !== aprovada && (
                  <section className="faturamento-grupo faturamento-grupo--resultado faturamento-previa">
                    <div className="faturamento-grupo-titulo">
                      <span>05</span>
                      <div>
                        <small>Resultado antes de salvar</small>
                        <h3>Prévia do cálculo</h3>
                        <p>
                          Veja a conta completa antes de salvar. Esta prévia não
                          altera a fatura nem cria cobrança.
                        </p>
                      </div>
                    </div>
                    {faltantes.length > 0 && (
                      <p className="faturamento-previa-pendencias">
                        Resolva as pendências indicadas no início da conferência
                        para gerar a prévia.
                      </p>
                    )}
                    <button
                      type="button"
                      className="admin-botao secundario"
                      disabled={ocupado || faltantes.length > 0}
                      onClick={gerarPrevia}
                    >
                      {ocupado ? "Calculando prévia…" : "Calcular prévia"}
                    </button>
                    {previa && (
                      <DemonstrativoCalculo memoria={previa.memoria} previa />
                    )}
                  </section>
                )}
                {!bloqueado && (
                  <section className="faturamento-confirmacao">
                    <div>
                      <span>06</span>
                      <div>
                        <strong>Confirmar dados</strong>
                        <p>
                          Marque após comparar todos os campos com o PDF
                          original.
                        </p>
                      </div>
                    </div>
                    <label className={conferido ? "marcada" : ""}>
                      <input
                        type="checkbox"
                        checked={conferido}
                        onChange={(e) => setConferido(e.target.checked)}
                      />
                      <span>
                        <strong>Conferi esta fatura</strong>
                        UC, consumo, tarifa, contrato e vencimentos estão
                        corretos.
                      </span>
                    </label>
                  </section>
                )}
                <div className="faturamento-acoes">
                  <small>
                    {alterado
                      ? "Existem alterações ainda não salvas."
                      : "Dados sincronizados."}
                  </small>
                  <div>
                    {nivel >= 2 && selecionado.status !== aprovada && (
                      <>
                        <button
                          type="button"
                          className="admin-botao secundario"
                          disabled={ocupado}
                          onClick={() => acao("salvar")}
                        >
                          Salvar conferência
                        </button>
                        <button
                          type="button"
                          className="admin-botao"
                          disabled={ocupado || !conferido || !previa}
                          onClick={() => acao("calcular")}
                        >
                          Salvar e calcular
                        </button>
                      </>
                    )}
                    {nivel >= 3 && selecionado.status === "Calculada" && (
                      <button
                        type="button"
                        className="admin-botao"
                        disabled={ocupado || alterado}
                        onClick={() => acao("aprovar")}
                      >
                        Aprovar para emissão futura
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {memoria && !previa && <DemonstrativoCalculo memoria={memoria} />}
              <details
                key={selecionado.id}
                className="admin-historico"
                onToggle={(evento) =>
                  setEvidenciasAbertas(evento.currentTarget.open)
                }
              >
                <summary>Evidências da extração</summary>
                {evidenciasAbertas && (
                  <div className="faturamento-pdf-painel">
                    <p>
                      Confira os dados informados diretamente no PDF original.
                    </p>
                    <iframe
                      className="faturamento-pdf-visualizador"
                      src={`${base}/${selecionado.id}/pdf`}
                      title={`Fatura ${selecionado.nome} em PDF`}
                    />
                    <a
                      href={`${base}/${selecionado.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir o PDF em outra aba
                    </a>
                  </div>
                )}
              </details>
              <details className="admin-historico">
                <summary>Histórico de conferência</summary>
                {selecionado.historico?.map((h, i) => (
                  <p key={i}>
                    {h.criado_em} · {h.responsavel} · {h.acao}
                  </p>
                ))}
              </details>
            </>
          )}
        </section>
      </div>
      <details
        className="faturamento-exportacao"
        onToggle={(evento) => setExportacaoAberta(evento.currentTarget.open)}
      >
        <summary>Exportar cálculos conferidos</summary>
        <div>
          <select
            aria-label="Usina da exportação"
            value={usinaExportacao}
            onChange={(e) => setUsinaExportacao(e.target.value)}
          >
            <option value="">Todas as usinas</option>
            {usinas.dados?.map((u) => (
              <option value={u.id} key={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
          <a
            className="admin-botao secundario"
            href={
              "/api/admin/faturamento/planilhas/calculos" +
              (usinaExportacao ? "?usina_id=" + usinaExportacao : "")
            }
          >
            Baixar novo arquivo Excel
          </a>
          <p>
            O arquivo exportado é novo. As planilhas originais não são
            alteradas.
          </p>
        </div>
      </details>
    </>
  );
}
