import { calcularCobranca } from "../../backend/servidor/faturamento/regras.mjs";

// Somente dados sintéticos; não lê o banco nem a configuração do Ecosol.
export function criarFixturesCalculos() {
  const unidade = {
    id: 1,
    uc: "12345678900",
    nome: "Cliente de teste GDI",
    cliente_nome: "Cliente de teste GDI",
    cliente_id: 10,
    cliente_provisorio_id: null,
    cliente_operacional_id: null,
    documento: "",
    email: "",
    dia_vencimento: 0,
    versao: 1,
    contratos: [],
    usina_id: 1,
    usina_nome: "Usina de teste GDI",
    descontos: [{ id: 1, inicio: "2026-09", desconto: "25" }],
    modalidades_usina: [{ inicio: "2026-09", modalidade: "GDI" }],
  };
  const gdii = {
    ...unidade,
    id: 2,
    uc: "23456789000",
    cliente_id: 20,
    nome: "Cliente de teste GDII",
    cliente_nome: "Cliente de teste GDII",
    usina_id: 2,
    usina_nome: "Usina de teste GDII",
    modalidades_usina: [{ inicio: "2026-09", modalidade: "GDII" }],
  };
  const operacional = {
    ...unidade,
    id: 3,
    uc: "34567890000",
    cliente_id: null,
    cliente_operacional_id: 30,
    nome: "Cliente com documentação pendente",
    cliente_nome: "Cliente com documentação pendente",
  };
  const unidades = [unidade, gdii, operacional];
  const dados = {
    uc: unidade.uc,
    competencia: "2026-10",
    injecao: "1660",
    unitario: "1.1",
    bandeira: "0.069969",
    total_equatorial: "302.40",
    ajuste_gdii: "",
    modalidade: "",
    vencimento_equatorial: "2026-10-20",
    vencimento_ecosol: "",
    origem_tarifa: "propria",
  };
  const documento = {
    id: 1,
    nome: "fatura-gdi-teste.pdf",
    lote: "lote-teste",
    status: "Pendente de revisão",
    versao: 1,
    dados,
    extracao: { dados: { ...dados }, avisos: [], evidencias: {} },
    memoria: null,
  };
  const documentoGdii = {
    ...documento,
    id: 2,
    nome: "fatura-gdii-teste.pdf",
    dados: { ...dados, uc: gdii.uc, ajuste_gdii: "290.71" },
    extracao: {
      dados: { ...dados, uc: gdii.uc, ajuste_gdii: "290.71" },
      avisos: [],
      evidencias: {},
    },
  };
  const semCadastro = {
    ...documento,
    id: 3,
    nome: "fatura-pendente-teste.pdf",
    dados: { ...dados, uc: operacional.uc },
    extracao: {
      dados: { ...dados, uc: operacional.uc },
      avisos: [],
      evidencias: {},
    },
  };
  function memoria(d, u) {
    const modalidade = u.modalidades_usina[0].modalidade;
    const desconto = u.descontos[0].desconto;
    return {
      ...calcularCobranca({ ...d.dados, modalidade, desconto }),
      unidade: structuredClone(u),
      contrato: { modalidade, desconto, inicio: d.dados.competencia },
      competencia: d.dados.competencia,
      vencimento_equatorial: d.dados.vencimento_equatorial,
      vencimento_ecosol: d.dados.vencimento_equatorial,
      fonte: { tipo: "propria", documento_id: d.id },
    };
  }
  const salva = {
    ...documento,
    id: 4,
    nome: "fatura-calculada-teste.pdf",
    status: "Calculada",
    memoria: memoria(documento, unidade),
  };
  const aprovada = {
    ...documentoGdii,
    id: 5,
    nome: "fatura-aprovada-teste.pdf",
    status: "Aprovada — aguardando emissão",
    memoria: memoria(documentoGdii, gdii),
  };
  salva.memoria.fonte.documento_id = salva.id;
  aprovada.memoria.fonte.documento_id = aprovada.id;
  return {
    unidades,
    documentos: [documento, documentoGdii, semCadastro, salva, aprovada],
  };
}
