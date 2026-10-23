import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const pastaDoProjeto = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const executarArquivo = promisify(execFile);
const codigoFonteCentralPadrao =
  "C:\\Users\\User\\Desktop\\00 - Central de Faturas Ecosol\\_SUPORTE_ORGANIZACAO\\ARQUIVOS_RETIRADOS_DA_RAIZ_20260917\\CODIGO_FONTE_V146";
const planilhasAtualizadasPadrao =
  "G:\\.shortcut-targets-by-id\\1WBX1jPldTDgAie6u0FujV9L6xWIjRtdx\\01 - Usinas Goiás\\00 - Planilhas Atualizadas";

// Regra temporária e auditável de homologação. Ela não substitui o cadastro
// operacional de perfis: somente materializa os dois fluxos já homologados
// enquanto a configuração definitiva ainda não foi autorizada.
const modosTemporariosDeHomologacao = new Map([
  ["abadiania", "financeiro"],
  ["ecosol", "financeiro"],
  ["royer", "documental"],
]);

function chaveDaUsina(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function modoTemporarioDeHomologacaoCentral(usina) {
  return modosTemporariosDeHomologacao.get(chaveDaUsina(usina)) ?? null;
}

function ultimoJsonDaSaida(saida) {
  for (const linha of String(saida ?? "")
    .split(/\r?\n/)
    .reverse()) {
    if (!linha.trim()) continue;
    try {
      return JSON.parse(linha);
    } catch {
      // O motor Python pode emitir avisos antes do resultado estruturado.
    }
  }
  throw new Error("simulacao_central_sem_resultado");
}

function argumentosDaCentral() {
  const codigoFonte =
    process.env.ECOSOL_CENTRAL_CODIGO_FONTE ?? codigoFonteCentralPadrao;
  const planilhas =
    process.env.ECOSOL_PLANILHAS_ATUALIZADAS ?? planilhasAtualizadasPadrao;
  return {
    adaptador: join(
      pastaDoProjeto,
      "backend",
      "scripts",
      "previaNomeadorCentral.py",
    ),
    banco: join(pastaDoProjeto, "backend", "data", "ecosol.db"),
    motor: join(codigoFonte, "nomeador_engine.py"),
    atualizador: join(codigoFonte, "atualizador_engine.py"),
    planilhas,
  };
}

export async function executarSimulacaoCentral({ documentos }) {
  const central = argumentosDaCentral();
  const { stdout } = await executarArquivo(
    process.env.ECOSOL_PYTHON ?? "python",
    [
      central.adaptador,
      "--simular",
      "--banco",
      central.banco,
      "--documentos",
      documentos.join(","),
      "--motor",
      central.motor,
      "--atualizador",
      central.atualizador,
      "--pasta-vendas",
      central.planilhas,
    ],
    { windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
  );
  const resultado = ultimoJsonDaSaida(stdout);
  if (!Array.isArray(resultado?.resultados))
    throw new Error("simulacao_central_invalida");
  return resultado;
}

// Localização consultiva usada para decidir a modalidade antes do cálculo.
// O adaptador chama localizar_documentos() da Central e não executa fill_row()
// nem calculate_boleto().
export async function localizarDocumentosCentral({ documentos }) {
  const central = argumentosDaCentral();
  const grupos = [];
  for (let inicio = 0; inicio < documentos.length; inicio += 10)
    grupos.push(documentos.slice(inicio, inicio + 10));

  async function localizarGrupo(grupo) {
    try {
      const { stdout } = await executarArquivo(
        process.env.ECOSOL_PYTHON ?? "python",
        [
          central.adaptador,
          "--somente-localizar",
          "--banco",
          central.banco,
          "--documentos",
          grupo.join(","),
          "--atualizador",
          central.atualizador,
          "--pasta-vendas",
          central.planilhas,
        ],
        { windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
      );
      const resultado = ultimoJsonDaSaida(stdout);
      if (!Array.isArray(resultado?.resultados))
        throw new Error("resultado_invalido");
      return resultado.resultados;
    } catch (erro) {
      const codigo = erro?.killed ? "tempo_esgotado" : "execucao_indisponivel";
      return grupo.map((documento) => ({
        documento,
        situacao: "revisar",
        motivo: `localizacao_central_indisponivel:${codigo}`,
      }));
    }
  }

  // A Central abre as planilhas a cada chamada. Limitar a três processos evita
  // sobrecarga no compartilhamento e impede que um lote grande estoure o
  // timeout de uma única execução.
  const resultados = [];
  for (let inicio = 0; inicio < grupos.length; inicio += 3) {
    const grupoDeTrabalho = grupos.slice(inicio, inicio + 3);
    resultados.push(...(await Promise.all(grupoDeTrabalho.map(localizarGrupo))));
  }
  return { resultados: resultados.flat() };
}

export async function gerarPreviaCentralTemporaria({ documento, simulacao }) {
  const central = argumentosDaCentral();
  const pastaTemporaria = await mkdtemp(
    join(tmpdir(), "ecosol-previa-central-"),
  );
  const destino = join(pastaTemporaria, `documento-${documento}.pdf`);
  const limpar = () => rm(pastaTemporaria, { recursive: true, force: true });
  try {
    const { stdout } = await executarArquivo(
      process.env.ECOSOL_PYTHON ?? "python",
      [
        central.adaptador,
        "--banco",
        central.banco,
        "--documento",
        String(documento),
        "--motor",
        central.motor,
        "--atualizador",
        central.atualizador,
        "--pasta-vendas",
        central.planilhas,
        "--saida",
        destino,
        "--uc-antiga",
        simulacao.ucAntiga,
        "--cliente",
        simulacao.cliente,
        "--usina",
        simulacao.usina,
      ],
      { windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const resultado = ultimoJsonDaSaida(stdout);
    const arquivo = resolve(resultado?.saida ?? "");
    const nome = resultado?.nomeFinal;
    if (
      !resultado?.boleto?.valorCalculadoCentral ||
      resultado.boleto.valorCalculadoCentral !== simulacao.valorBoleto ||
      typeof nome !== "string" ||
      nome !== basename(arquivo) ||
      !arquivo.startsWith(resolve(pastaTemporaria) + "\\") ||
      !existsSync(arquivo)
    )
      throw new Error("previa_central_diverge_da_simulacao");
    return { arquivo, nome, limpar };
  } catch (erro) {
    await limpar();
    throw erro;
  }
}

export async function executarProcessamentoCentralHomologacao({
  processamentoId,
  documentos,
  modo = "financeiro",
}) {
  const central = argumentosDaCentral();
  const raiz = resolve(
    pastaDoProjeto,
    "backend",
    "data",
    "central-homologacao",
    processamentoId,
  );
  await mkdir(dirname(raiz), { recursive: true });
  const { stdout } = await executarArquivo(
    process.env.ECOSOL_PYTHON ?? "python",
    [
      central.adaptador,
      modo === "documental"
        ? "--processar-documental-isolado"
        : "--processar-isolado",
      "--banco",
      central.banco,
      "--documentos",
      documentos.join(","),
      "--motor",
      central.motor,
      "--atualizador",
      central.atualizador,
      "--pasta-vendas",
      central.planilhas,
      "--diretorio-saida",
      raiz,
    ],
    { windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const resultado = ultimoJsonDaSaida(stdout);
  if (!resultado || !["concluido", "revisar"].includes(resultado.situacao))
    throw new Error("processamento_central_invalido");
  const dentroDaHomologacao = (arquivo) =>
    typeof arquivo === "string" && resolve(arquivo).startsWith(raiz + "\\");
  const pdfsInvalidos =
    !Array.isArray(resultado.pdfs) ||
    resultado.pdfs.length !== documentos.length ||
    resultado.pdfs.some(
      (pdf) =>
        !dentroDaHomologacao(pdf.pdf_final) ||
        !dentroDaHomologacao(pdf.pdf_impressao) ||
        !existsSync(pdf.pdf_final) ||
        !existsSync(pdf.pdf_impressao),
    );
  if (
    resultado.situacao === "concluido" &&
    (pdfsInvalidos ||
      (modo === "financeiro" &&
        (!dentroDaHomologacao(resultado.planilhaPreenchida) ||
          !dentroDaHomologacao(resultado.log))))
  )
    throw new Error("artefatos_central_fora_da_homologacao");
  return resultado;
}
