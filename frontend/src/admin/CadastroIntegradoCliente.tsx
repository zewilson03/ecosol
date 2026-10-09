import { FormEvent, useEffect, useState } from "react";
import { Cliente, DadosDaEquipe } from "../dadosDaAplicacao";
import { consultarServidor, usarConsulta } from "./comunicacaoComServidor";
import { EstadoDaConsulta } from "./ComponentesDoPainel";
import { Unidade } from "./UnidadesDeCobranca";

const normalizarNome = (valor: string) =>
  valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
const normalizarUc = (valor: string) =>
  valor.replace(/\D/g, "").replace(/^0+(?=\d)/, "");

export default function CadastroIntegradoCliente({
  nomeInicial = "",
  clienteInicialId = null,
  ucInicial = "",
  usinaInicialId = null,
  usinaNome = "",
  aoSalvar,
}: {
  nomeInicial?: string;
  clienteInicialId?: number | null;
  ucInicial?: string;
  usinaInicialId?: number | null;
  usinaNome?: string;
  aoSalvar: (mensagem: string) => void;
}) {
  const clientes = usarConsulta<DadosDaEquipe>(
    "/api/equipe/dados?secao=clientes",
  );
  const unidades = usarConsulta<Unidade[]>("/api/admin/faturamento/unidades");
  const [nome, setNome] = useState(nomeInicial);
  const [clienteId, setClienteId] = useState<number | null>(clienteInicialId);
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [uc, setUc] = useState(ucInicial);
  const [unidadeNome, setUnidadeNome] = useState("");
  const [unidadeDocumento, setUnidadeDocumento] = useState("");
  const [unidadeEmail, setUnidadeEmail] = useState("");
  const [diaVencimento, setDiaVencimento] = useState("");
  const [desconto, setDesconto] = useState("");
  const [descontoInicio, setDescontoInicio] = useState("");
  const [confirmarVinculo, setConfirmarVinculo] = useState(false);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const selecionado = clientes.dados?.clientes.find(
    (item) => item.id === clienteId,
  );
  const unidadeExistente = unidades.dados?.find(
    (item) => item.uc === normalizarUc(uc),
  );
  const descontoFaltando =
    !!unidadeExistente && unidadeExistente.descontos.length === 0;
  const outroCliente =
    unidadeExistente?.cliente_id && unidadeExistente.cliente_id !== clienteId
      ? (unidadeExistente.cliente_nome ??
        `cliente #${unidadeExistente.cliente_id}`)
      : null;
  const outraUsina =
    usinaInicialId !== null &&
    unidadeExistente?.usina_id != null &&
    unidadeExistente.usina_id !== usinaInicialId;
  const precisaConfirmarUsina =
    usinaInicialId !== null &&
    !!unidadeExistente &&
    unidadeExistente.usina_id === null;
  const correspondencias = nome.trim()
    ? (clientes.dados?.clientes ?? [])
        .filter((item) =>
          normalizarNome(item.name).includes(normalizarNome(nome)),
        )
        .slice(0, 8)
    : [];
  useEffect(() => {
    if (!selecionado) return;
    setNome((atual) => atual || selecionado.name);
    setCpf((atual) => atual || selecionado.cpf);
    setEmail((atual) => atual || selecionado.email);
    setUnidadeNome((atual) => atual || selecionado.name);
    setUnidadeDocumento((atual) => atual || selecionado.cpf);
    setUnidadeEmail((atual) => atual || selecionado.email);
  }, [selecionado]);

  function escolherCliente(cliente: Cliente) {
    setClienteId(cliente.id);
    setNome(cliente.name);
    setCpf(cliente.cpf);
    setEmail(cliente.email);
    setUnidadeNome(cliente.name);
    setUnidadeDocumento(cliente.cpf);
    setUnidadeEmail(cliente.email);
    setConfirmarVinculo(false);
    setErro("");
  }

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!clientes.dados || !unidades.dados) {
      setErro("Aguarde o carregamento dos cadastros antes de salvar.");
      return;
    }
    if (outroCliente) {
      setErro(
        "Esta UC está vinculada a outro cliente. Confira o cadastro antes de prosseguir.",
      );
      return;
    }
    if (outraUsina) {
      setErro(
        "Esta UC já pertence a outra usina. Confira o vínculo existente.",
      );
      return;
    }
    setOcupado(true);
    setErro("");
    try {
      const resultado = await consultarServidor<{ estado: string }>(
        "/api/admin/faturamento/cadastro-integrado",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cliente_id: clienteId,
            nome,
            cpf: selecionado?.cpf ?? cpf,
            email,
            uc,
            ...(usinaInicialId !== null ? { usina_id: usinaInicialId } : {}),
            confirmar_vinculo: confirmarVinculo,
            ...(!unidadeExistente
              ? {
                  unidade_nome: unidadeNome,
                  unidade_documento: unidadeDocumento,
                  unidade_email: unidadeEmail,
                  dia_vencimento: diaVencimento,
                }
              : {}),
            ...(!unidadeExistente || descontoFaltando
              ? { desconto, desconto_inicio: descontoInicio }
              : {}),
          }),
        },
      );
      aoSalvar(
        resultado.estado === "ja_vinculada"
          ? "Cliente e UC já estavam vinculados; nenhum cadastro foi duplicado."
          : resultado.estado === "vinculada"
            ? "UC existente vinculada ao cliente. Confira a fatura novamente."
            : resultado.estado === "vinculada_usina"
              ? "UC existente vinculada à usina. Confira a fatura novamente."
              : resultado.estado === "desconto_iniciado"
                ? "Desconto inicial registrado para a UC existente. Confira a fatura novamente."
                : "Cliente e UC cadastrados no mesmo fluxo. Confira a fatura novamente.",
      );
    } catch (falha) {
      setErro((falha as Error).message);
      clientes.atualizar();
      unidades.atualizar();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="admin-formulario cadastro-integrado" onSubmit={salvar}>
      <h3>Cliente e UC no mesmo cadastro</h3>
      <p>
        Selecione um cliente encontrado pelo nome ou preencha um novo. O vínculo
        só é salvo após conferir a UC.
      </p>
      {usinaInicialId !== null && (
        <p className="admin-aviso cadastro-integrado-largura">
          Usina selecionada: <strong>{usinaNome}</strong>. A modalidade será
          definida pela competência da fatura.
        </p>
      )}
      <EstadoDaConsulta {...clientes} repetir={clientes.atualizar} />
      <EstadoDaConsulta {...unidades} repetir={unidades.atualizar} />
      {erro && (
        <p className="admin-aviso erro" role="alert">
          {erro}
        </p>
      )}
      <fieldset
        className="admin-campos"
        disabled={ocupado || !clientes.dados || !unidades.dados}
      >
        <label>
          Nome do cliente
          <input
            value={nome}
            maxLength={120}
            required
            onChange={(evento) => {
              setNome(evento.target.value);
              setClienteId(null);
              if (selecionado) {
                setCpf("");
                setEmail("");
                setUnidadeDocumento("");
                setUnidadeEmail("");
              }
              setUnidadeNome(evento.target.value);
              setConfirmarVinculo(false);
            }}
          />
        </label>
        {correspondencias.length > 0 && !selecionado && (
          <div
            className="admin-aviso cadastro-integrado-largura cadastro-integrado-sugestoes"
            role="group"
            aria-label="Clientes encontrados"
          >
            <strong>
              Cadastros encontrados — selecione para aproveitar os dados:
            </strong>
            {correspondencias.map((cliente) => (
              <button
                type="button"
                className="admin-botao secundario"
                key={cliente.id}
                onClick={() => escolherCliente(cliente)}
              >
                {cliente.name} · CPF final {cliente.cpf.slice(-4)}
              </button>
            ))}
          </div>
        )}
        {selecionado && (
          <p className="admin-aviso sucesso cadastro-integrado-largura">
            Cliente existente selecionado: {selecionado.name}. CPF e e-mail
            preenchidos pelo cadastro.
          </p>
        )}
        <label>
          CPF do cliente
          <input
            value={selecionado?.cpf ?? cpf}
            readOnly={!!selecionado}
            maxLength={14}
            required
            inputMode="numeric"
            onChange={(evento) => {
              setCpf(evento.target.value);
              if (!unidadeExistente) setUnidadeDocumento(evento.target.value);
            }}
          />
        </label>
        <label>
          E-mail do cliente
          <input
            type="email"
            value={selecionado?.email ?? email}
            readOnly={!!selecionado}
            maxLength={180}
            required
            onChange={(evento) => {
              setEmail(evento.target.value);
              if (!unidadeExistente) setUnidadeEmail(evento.target.value);
            }}
          />
        </label>
        <label>
          Número da UC
          <input
            value={uc}
            maxLength={30}
            required
            inputMode="numeric"
            onChange={(evento) => {
              setUc(evento.target.value);
              setConfirmarVinculo(false);
            }}
          />
        </label>
        {unidadeExistente ? (
          <div className="admin-aviso cadastro-integrado-largura">
            <strong>UC já cadastrada:</strong> {unidadeExistente.nome} · UC{" "}
            {unidadeExistente.uc}
            <br />
            CPF/CNPJ: {unidadeExistente.documento} · E-mail:{" "}
            {unidadeExistente.email}
            <br />
            Dia preferido: {unidadeExistente.dia_vencimento} · Descontos:{" "}
            {unidadeExistente.descontos
              .map((item) => `${item.desconto}% desde ${item.inicio}`)
              .join(", ") || "não informado"}
            <br />
            Usina: {unidadeExistente.usina_nome ?? "sem vínculo"}
          </div>
        ) : (
          <>
            <label>
              Nome / razão social na UC
              <input
                value={unidadeNome}
                maxLength={160}
                required
                onChange={(evento) => setUnidadeNome(evento.target.value)}
              />
            </label>
            <label>
              CPF/CNPJ da UC
              <input
                value={unidadeDocumento}
                maxLength={18}
                required
                onChange={(evento) => setUnidadeDocumento(evento.target.value)}
              />
            </label>
            <label>
              E-mail de cobrança
              <input
                type="email"
                value={unidadeEmail}
                maxLength={180}
                required
                onChange={(evento) => setUnidadeEmail(evento.target.value)}
              />
            </label>
            <label>
              Dia preferido do boleto
              <input
                type="number"
                min={1}
                max={31}
                value={diaVencimento}
                required
                onChange={(evento) => setDiaVencimento(evento.target.value)}
              />
            </label>
          </>
        )}
        {(!unidadeExistente || descontoFaltando) && (
          <>
            {descontoFaltando && (
              <p className="admin-aviso cadastro-integrado-largura">
                Esta UC ainda não tem desconto. Informe a taxa inicial e a
                competência aqui mesmo.
              </p>
            )}
            <label>
              Desconto inicial da UC (%)
              <input
                value={desconto}
                inputMode="decimal"
                required
                onChange={(evento) => setDesconto(evento.target.value)}
              />
            </label>
            <label>
              Desconto válido desde
              <input
                type="month"
                value={descontoInicio}
                required
                onChange={(evento) => setDescontoInicio(evento.target.value)}
              />
            </label>
          </>
        )}
      </fieldset>
      {outroCliente || outraUsina ? (
        <p className="admin-aviso erro" role="alert">
          {outraUsina
            ? "Esta UC já pertence a outra usina. Transferências exigem um fluxo histórico separado."
            : `Atenção: esta UC está vinculada a ${outroCliente}. Um cliente pode ter várias UCs, mas esta já pertence a outro cadastro.`}
        </p>
      ) : unidadeExistente &&
        clienteId !== null &&
        unidadeExistente.cliente_id === clienteId &&
        !precisaConfirmarUsina ? (
        <p className="admin-aviso sucesso">
          Esta UC já está vinculada ao cliente selecionado.
        </p>
      ) : unidadeExistente ? (
        <label className="admin-aviso cadastro-integrado-confirmacao">
          <input
            type="checkbox"
            checked={confirmarVinculo}
            onChange={(evento) => setConfirmarVinculo(evento.target.checked)}
          />
          Conferi os dados da UC existente e confirmo o vínculo com este cliente
          {precisaConfirmarUsina ? " e com a usina selecionada" : ""}.
        </label>
      ) : null}
      <button
        className="admin-botao"
        disabled={
          ocupado ||
          !clientes.dados ||
          !unidades.dados ||
          !!outroCliente ||
          !!outraUsina ||
          (!!unidadeExistente &&
            !(
              clienteId !== null &&
              unidadeExistente.cliente_id === clienteId &&
              !precisaConfirmarUsina
            ) &&
            !confirmarVinculo)
        }
      >
        {ocupado ? "Salvando…" : "Salvar cliente e UC"}
      </button>
    </form>
  );
}
