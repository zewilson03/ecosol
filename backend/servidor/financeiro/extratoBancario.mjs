import { criarIntegracaoSicoob } from "../bancario/integracaoSicoob.mjs";
import { FalhaDeIntegracaoBancaria } from "../bancario/contrato.mjs";
import { mapearFalhaExtrato } from "../bancario/contaCorrenteSicoob.mjs";

let integracao = null;

function obterIntegracao() {
  if (!integracao) integracao = criarIntegracaoSicoob();
  return integracao;
}

function inteiroOpcional(valor) {
  if (valor == null || valor === "") return null;
  return Number(valor);
}

export async function consultarExtratoBancario(
  filtros,
  { carregarIntegracao = obterIntegracao } = {},
) {
  try {
    const sicoob = carregarIntegracao();
    if (!sicoob.contaCorrente)
      throw new FalhaDeIntegracaoBancaria(
        "SICOOB_CONTA_CORRENTE_NAO_CONFIGURADA",
        { permanente: true },
      );
    const diaInicial = inteiroOpcional(filtros?.dia_inicial);
    const diaFinal = inteiroOpcional(filtros?.dia_final);
    if ((diaInicial == null) !== (diaFinal == null))
      throw new FalhaDeIntegracaoBancaria(
        "SICOOB_EXTRATO_INTERVALO_INCOMPLETO",
        { permanente: true },
      );
    return await sicoob.contaCorrente.consultarExtrato({
      mes: Number(filtros?.mes),
      ano: Number(filtros?.ano),
      diaInicial,
      diaFinal,
      agruparCnab: String(filtros?.agrupar_cnab ?? "false") === "true",
    });
  } catch (erro) {
    if (erro?.codigo === "SICOOB_CONFIGURACAO_INVALIDA") throw erro;
    throw mapearFalhaExtrato(erro);
  }
}

export function limparCacheExtratoBancarioParaTestes() {
  if (process.env.NODE_ENV !== "test")
    throw new Error("O cache bancário só pode ser limpo em testes.");
  integracao = null;
}
