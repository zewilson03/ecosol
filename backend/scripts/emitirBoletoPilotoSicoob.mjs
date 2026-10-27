import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

await import("../servidor/configuracao.mjs");
const { criarIntegracaoSicoob } =
  await import("../servidor/bancario/integracaoSicoob.mjs");
const { obterConfiguracaoSicoob } =
  await import("../servidor/bancario/configuracaoSicoob.mjs");
const { criarContratoCobrancaSicoob } =
  await import("../servidor/bancario/contratoCobrancaSicoob.mjs");
const {
  avaliarHistoricoPilotoSicoob,
  criarIdempotenciaLegadaPilotoSicoob,
  criarIdempotenciaPilotoSicoob,
} = await import("../servidor/bancario/idempotenciaPilotoSicoob.mjs");

const confirmacaoExigida = "EMITIR-UM-BOLETO-REAL";

function falhar(mensagem) {
  throw new Error(mensagem);
}

function cpfValido(valor) {
  const cpf = String(valor ?? "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (quantidade) => {
    let soma = 0;
    for (let indice = 0; indice < quantidade; indice += 1)
      soma += Number(cpf[indice]) * (quantidade + 1 - indice);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

function argumento(nome) {
  const prefixo = `--${nome}=`;
  return process.argv
    .find((item) => item.startsWith(prefixo))
    ?.slice(prefixo.length);
}

function gravarAtomico(caminho, valor) {
  mkdirSync(dirname(caminho), { recursive: true });
  const temporario = `${caminho}.${process.pid}.tmp`;
  writeFileSync(temporario, `${JSON.stringify(valor, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporario, caminho);
}

function variaveisDeProducao() {
  const variaveis = { ...process.env };
  if (
    variaveis.NODE_ENV !== "production" ||
    variaveis.SICOOB_AMBIENTE !== "producao" ||
    variaveis.SICOOB_PRODUCAO_HABILITADA !== "SIM"
  )
    falhar(
      "O piloto exige produção configurada e habilitada explicitamente; não há migração automática entre ambientes.",
    );
  return variaveis;
}

const entradaPath = resolve(
  argumento("entrada") || "backend/data/pilotos/pagador.json",
);
const entrada = JSON.parse(readFileSync(entradaPath, "utf8"));
if (!cpfValido(entrada?.cliente?.documento))
  falhar("O CPF do pagador não passou na validação dos dígitos verificadores.");
const variaveis = variaveisDeProducao();
const revisao = Number(argumento("revisao") ?? 2);
const configuracao = obterConfiguracaoSicoob({
  variaveis,
  exigirCompleta: true,
});
const idempotencia = criarIdempotenciaPilotoSicoob({
  entrada,
  configuracao,
  revisao,
});
const idempotenciaLegada = criarIdempotenciaLegadaPilotoSicoob(entrada);
const registroPath = resolve(`backend/data/pilotos/${idempotencia}.json`);
const registroLegadoPath = resolve(
  `backend/data/pilotos/${idempotenciaLegada}.json`,
);
const registroAtual = existsSync(registroPath)
  ? JSON.parse(readFileSync(registroPath, "utf8"))
  : null;
const registroLegado =
  idempotenciaLegada !== idempotencia && existsSync(registroLegadoPath)
    ? JSON.parse(readFileSync(registroLegadoPath, "utf8"))
    : null;
const historico = avaliarHistoricoPilotoSicoob({
  registroAtual,
  registroLegado,
});

if (!historico.permitida) {
  console.log(
    JSON.stringify({
      executada: false,
      motivo: historico.motivo,
      estado: historico.estado,
      codigo: historico.codigo,
    }),
  );
  process.exit(historico.estado === "registrada" ? 0 : 2);
}

const integracao = criarIntegracaoSicoob({ variaveis });
const snapshot = Object.freeze({
  versao: 1,
  tipo: "cobranca",
  origem: { tipo: "piloto_sicoob", referencia: idempotencia.slice(0, 16) },
  cliente: entrada.cliente,
  unidade: { uc: entrada.uc || "PILOTO-SICOOB" },
  cobranca: {
    valor_centavos: entrada.valor_centavos,
    moeda: "BRL",
    vencimento: entrada.vencimento,
  },
});

// A criação da requisição ocorre antes de qualquer efeito externo e valida o corpo completo.
const contrato = criarContratoCobrancaSicoob({
  convenio: configuracao.cobranca,
});
contrato.criarRequisicaoRegistro({ idempotencia, snapshot });

// A integração não expõe segredos nem a configuração completa. A validação final
// acontece no adaptador imediatamente antes do POST.
if (process.argv.includes("--validar")) {
  console.log(
    JSON.stringify({
      valida: true,
      ambiente: "producao",
      revisao,
      idempotencia: idempotencia.slice(0, 12),
      migra_rejeicao_legada: historico.migraRejeicaoLegada,
    }),
  );
  process.exit(0);
}

if (argumento("confirmar") !== confirmacaoExigida)
  falhar(`Confirmação ausente. Use --confirmar=${confirmacaoExigida}.`);

const travaPath = `${registroPath}.lock`;
try {
  writeFileSync(travaPath, `${process.pid}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
} catch (erro) {
  if (erro?.code === "EEXIST")
    falhar("Já existe outra execução ou uma trava pendente para este piloto.");
  throw erro;
}

gravarAtomico(registroPath, {
  versao: 2,
  identidade_versao: revisao,
  idempotencia,
  migrada_de_rejeicao: historico.migraRejeicaoLegada
    ? idempotenciaLegada
    : null,
  estado: "envio_iniciado",
  criado_em: new Date().toISOString(),
});

let registroAceito = null;
try {
  const resultado = await integracao.adaptador.registrarCobranca({
    idempotencia,
    snapshot,
    correlacao: randomUUID(),
    tentativa: 1,
  });
  const final = {
    versao: 2,
    identidade_versao: revisao,
    idempotencia,
    migrada_de_rejeicao: historico.migraRejeicaoLegada
      ? idempotenciaLegada
      : null,
    estado:
      resultado.categoria === "rejeitada"
        ? "rejeitada"
        : resultado.estado === "registrada"
          ? "registrada"
          : "resultado_desconhecido",
    codigo: resultado.codigo ?? null,
    provedor_id: resultado.provedor_id ?? null,
    criado_em: new Date().toISOString(),
  };
  if (resultado.artefatos?.pdf_base64) {
    const pdfPath = resolve(`backend/data/pilotos/${idempotencia}.pdf`);
    writeFileSync(
      pdfPath,
      Buffer.from(resultado.artefatos.pdf_base64, "base64"),
      { mode: 0o600 },
    );
    final.pdf = pdfPath;
  }
  final.linha_digitavel = resultado.artefatos?.linha_digitavel ?? null;
  final.codigo_barras = resultado.artefatos?.codigo_barras ?? null;
  // O aceite externo é persistido antes da consulta. Se a consulta falhar, o
  // boleto continua registrado e será reconciliado sem novo POST.
  gravarAtomico(registroPath, final);
  if (final.estado === "registrada") registroAceito = final;
  if (final.estado === "registrada" && final.provedor_id) {
    try {
      const consulta = await integracao.adaptador.consultarCobranca({
        idempotencia,
        provedor_id: final.provedor_id,
        correlacao: randomUUID(),
        tentativa: 1,
      });
      final.conciliacao = {
        estado: consulta.estado ?? null,
        codigo: consulta.codigo ?? null,
        consultada_em: new Date().toISOString(),
      };
    } catch (erroConsulta) {
      final.conciliacao = {
        estado: "pendente",
        codigo: erroConsulta?.codigo ?? "SICOOB_CONSULTA_FALHOU",
        consultada_em: new Date().toISOString(),
      };
    }
  }
  gravarAtomico(registroPath, final);
  console.log(
    JSON.stringify({
      executada: true,
      estado: final.estado,
      codigo: final.codigo,
      pdf: Boolean(final.pdf),
    }),
  );
} catch (erro) {
  if (!registroAceito)
    gravarAtomico(registroPath, {
      versao: 2,
      identidade_versao: revisao,
      idempotencia,
      migrada_de_rejeicao: historico.migraRejeicaoLegada
        ? idempotenciaLegada
        : null,
      estado: "resultado_desconhecido",
      codigo: erro?.codigo ?? "SICOOB_FALHA_NAO_CLASSIFICADA",
      criado_em: new Date().toISOString(),
    });
  console.log(
    JSON.stringify({
      executada: true,
      estado: registroAceito ? "registrada" : "resultado_desconhecido",
      codigo: erro?.codigo ?? "SICOOB_FALHA_NAO_CLASSIFICADA",
    }),
  );
  process.exitCode = 2;
} finally {
  try {
    unlinkSync(travaPath);
  } catch (erroTrava) {
    if (erroTrava?.code !== "ENOENT") throw erroTrava;
  }
}
