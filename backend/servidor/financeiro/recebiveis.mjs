const STATUS_PERMITIDOS = new Set([
  "a_receber",
  "vencido",
  "pago",
  "divergente",
]);

export class ErroDeFiltroDeRecebiveis extends Error {}

function filtroInvalido(mensagem) {
  throw new ErroDeFiltroDeRecebiveis(mensagem);
}

function dataValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const data = new Date(`${valor}T12:00:00Z`);
  return (
    Number.isFinite(data.getTime()) && data.toISOString().slice(0, 10) === valor
  );
}

export function validarFiltrosRecebiveis(consulta = {}) {
  const ucInformada = String(consulta.uc ?? "").trim();
  if (ucInformada && !/^[\d.\-/\s]{1,40}$/.test(ucInformada))
    filtroInvalido("Filtro de UC inválido.");
  const uc = ucInformada.replace(/\D/g, "").slice(0, 30);
  const status = String(consulta.status ?? "").trim();
  const inicio = String(consulta.inicio ?? "").trim();
  const fim = String(consulta.fim ?? "").trim();

  if (status && !STATUS_PERMITIDOS.has(status))
    filtroInvalido("Status financeiro inválido.");
  if (inicio && !dataValida(inicio)) filtroInvalido("Data inicial inválida.");
  if (fim && !dataValida(fim)) filtroInvalido("Data final inválida.");
  if (inicio && fim && inicio > fim)
    filtroInvalido("A data inicial não pode ser posterior à data final.");

  return { uc, status, inicio, fim };
}

export function classificarRecebivel(operacao, hoje) {
  if (operacao.estado === "liquidada") return "pago";
  if (operacao.estado !== "registrada") return "divergente";
  if (operacao.vencimento && operacao.vencimento < hoje) return "vencido";
  return "a_receber";
}

function lerIdentidade(snapshotTexto) {
  try {
    const snapshot = JSON.parse(snapshotTexto);
    return {
      cliente: String(snapshot?.cliente?.nome ?? "").trim() || "Não informado",
      uc: String(snapshot?.unidade?.uc ?? "").replace(/\D/g, ""),
      competencia: String(snapshot?.unidade?.competencia ?? "").trim(),
    };
  } catch {
    return { cliente: "Não informado", uc: "", competencia: "" };
  }
}

function hojeEmSaoPaulo() {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const parte = (tipo) => partes.find((item) => item.type === tipo)?.value;
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}

export function obterVisaoDeRecebiveis(
  banco,
  consulta = {},
  hoje = hojeEmSaoPaulo(),
) {
  const filtros = validarFiltrosRecebiveis(consulta);
  const linhas = banco
    .prepare(
      `SELECT o.id,o.origem_id,o.valor_centavos,o.vencimento,o.estado,
              o.provedor_id,o.snapshot,o.atualizado_em,
              COALESCE((
                SELECT SUM(e.total_centavos)
                FROM bancario_encargos_atraso e
                WHERE e.operacao_origem_id=o.id AND e.estado='aplicado'
              ),0) AS encargos_transferidos_centavos
       FROM bancario_operacoes o
       WHERE o.tipo='cobranca'
       ORDER BY o.vencimento DESC,o.atualizado_em DESC,o.id DESC`,
    )
    .all();

  const recebiveis = linhas
    .map((operacao) => {
      const identidade = lerIdentidade(operacao.snapshot);
      return {
        id: operacao.id,
        documento_id:
          /^\d+$/.test(String(operacao.origem_id)) &&
          Number.isSafeInteger(Number(operacao.origem_id))
            ? Number(operacao.origem_id)
            : null,
        cliente: identidade.cliente,
        uc: identidade.uc,
        competencia: identidade.competencia,
        valor_centavos: operacao.valor_centavos,
        encargos_transferidos_centavos: Number(
          operacao.encargos_transferidos_centavos ?? 0,
        ),
        vencimento: operacao.vencimento,
        status: classificarRecebivel(operacao, hoje),
        atualizado_em: operacao.atualizado_em,
      };
    })
    .filter(
      (item) =>
        (!filtros.uc || item.uc.includes(filtros.uc)) &&
        (!filtros.status || item.status === filtros.status) &&
        (!filtros.inicio || item.vencimento >= filtros.inicio) &&
        (!filtros.fim || item.vencimento <= filtros.fim),
    );

  const totais = Object.fromEntries(
    [...STATUS_PERMITIDOS].map((status) => [
      status,
      { quantidade: 0, valor_centavos: 0 },
    ]),
  );
  for (const recebivel of recebiveis) {
    totais[recebivel.status].quantidade += 1;
    totais[recebivel.status].valor_centavos += recebivel.valor_centavos;
    if (!Number.isSafeInteger(totais[recebivel.status].valor_centavos))
      throw new Error("O total financeiro excedeu o limite seguro de cálculo.");
  }

  return { filtros, hoje, totais, recebiveis };
}
