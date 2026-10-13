import type { Unidade, Contrato } from "./UnidadesDeCobranca";

export type Memoria = {
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
  competencia: string;
  vencimento_equatorial: string;
  vencimento_ecosol: string;
  fonte: { tipo: string; documento_id: number };
};
export type PreviaCalculo = { memoria: Memoria; hash: string; versao: number };
export type Documento = {
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
