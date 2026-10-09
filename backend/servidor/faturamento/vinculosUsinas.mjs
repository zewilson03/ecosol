import { falhar, normalizarUc } from "./regras.mjs";

const APROVADA = "Aprovada — aguardando emissão";

export function modalidadeVigenteDaUsina(banco, usinaId, mes) {
  const usina = banco
    .prepare("SELECT nome FROM usinas WHERE id=?")
    .get(usinaId);
  if (!usina || chaveUsina(usina.nome) === "ecosol") return null;
  return banco
    .prepare(
      `SELECT modalidade,inicio FROM usinas_modalidades
       WHERE usina_id=? AND inicio<=? ORDER BY inicio DESC LIMIT 1`,
    )
    .get(usinaId, mes);
}

export function usinaDaUnidadeNaCompetencia(banco, unidadeId, mes) {
  const historico = banco
    .prepare(
      "SELECT usina_id FROM faturamento_vinculos_usina WHERE unidade_id=? AND inicio<=? ORDER BY inicio DESC LIMIT 1",
    )
    .get(unidadeId, mes);
  return (
    historico?.usina_id ??
    banco
      .prepare("SELECT usina_id FROM faturamento_unidades WHERE id=?")
      .get(unidadeId)?.usina_id ??
    null
  );
}

export function conferirVinculoComAprovadas(banco, unidadeId, usinaId) {
  const aprovadas = banco
    .prepare(
      "SELECT id,competencia,memoria FROM faturamento_documentos WHERE unidade_id=? AND status=?",
    )
    .all(unidadeId, APROVADA);
  for (const fatura of aprovadas) {
    const modalidade = modalidadeVigenteDaUsina(
      banco,
      usinaId,
      fatura.competencia,
    )?.modalidade;
    // Uma vigência nova não reclassifica faturas aprovadas anteriores a ela.
    if (!modalidade) continue;
    let anterior;
    try {
      anterior = JSON.parse(fatura.memoria ?? "{}").contrato?.modalidade;
    } catch {
      falhar(
        "A memória de uma fatura aprovada está inválida. Confira antes de vincular a UC.",
        409,
      );
    }
    if (modalidade !== anterior)
      falhar(
        "A usina escolhida não corresponde à modalidade de uma fatura aprovada desta UC.",
        409,
      );
  }
}

export function chaveUsina(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const apelidosUsinas = new Map([
  ["clau", "claudio"],
  ["carlos", "carlosuniao"],
  ["bolt", "boltenergia"],
  ["jbc", "jbcarvalho"],
  ["pedroh", "pedrohenrique"],
  ["solar", "solargreen"],
  ["tgsilva", "tgsilvadanielle"],
  ["tgsilvadaniele", "tgsilvadanielle"],
]);

export function chaveCanonicaUsina(valor) {
  const chave = chaveUsina(valor);
  return apelidosUsinas.get(chave) ?? chave;
}

const gdii = new Set(["saofrancisco", "solargreen", "2000solar"]);
export function modalidadeInicialDaUsina(nome) {
  return gdii.has(chaveCanonicaUsina(nome)) ? "GDII" : "GDI";
}

function titulo(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function colunasDaAba(aba) {
  for (let i = 0; i < Math.min(30, aba.linhas.length); i++) {
    const cabecalho = aba.linhas[i].map((c) => titulo(c.valor));
    const nova = cabecalho.findIndex((v) => ["uc nova", "nova uc"].includes(v));
    const antiga = cabecalho.findIndex((v) =>
      ["uc antiga", "antiga uc"].includes(v),
    );
    const uc =
      nova >= 0
        ? nova
        : cabecalho.findIndex((v) =>
            [
              "uc",
              "unidade consumidora",
              "unidades c",
              "numero da uc",
            ].includes(v),
          );
    const usina = cabecalho.findIndex((v) =>
      ["usina", "nome da usina", "geradora"].includes(v),
    );
    const cliente = cabecalho.findIndex((v) =>
      ["cliente", "clientes", "nome", "nome do cliente"].includes(v),
    );
    if (uc >= 0) return { cabecalho: i + 1, uc, antiga, usina, cliente };
  }
  return null;
}

export function identificarAbasDeVinculos(abas, nomeArquivo = "") {
  return abas.map((aba) => {
    const colunas = colunasDaAba(aba);
    const nome = aba.nome;
    const nomeSemExtensao = nomeArquivo.replace(/(?:\.xlsx)+$/i, "").trim();
    const arquivoExplicito =
      /^\d+\s*-\s*Venda de Energia\s*-\s*Usina\s+(.+?)(?:\s+20\d{2})?(?:\.xlsx)+$/i.exec(
        nomeArquivo,
      )?.[1] ?? /^usina\s+(.+)$/i.exec(nomeSemExtensao)?.[1];
    const nomeGenerico = (valor) =>
      /^(consulta|dados|clientes?|ucs?|uc por usina|vinculos?|importacao|planilha\s*\d*|sheet\s*\d*)$/.test(
        titulo(valor),
      );
    const usinaPeloNome =
      arquivoExplicito?.trim() ||
      (!nomeGenerico(nome) ? nome.trim() : "") ||
      (!nomeGenerico(nomeSemExtensao) ? nomeSemExtensao : "");
    return {
      nome,
      cabecalho: colunas?.cabecalho ?? null,
      coluna_uc: colunas?.uc ?? null,
      coluna_uc_antiga: colunas?.antiga ?? null,
      coluna_usina: colunas?.usina ?? null,
      coluna_cliente: colunas?.cliente ?? null,
      usina_sugerida: colunas?.usina >= 0 ? null : usinaPeloNome,
      compativel: Boolean(colunas && (colunas.usina >= 0 || usinaPeloNome)),
    };
  });
}

export function extrairVinculosDaAba(abas, nomeAba, nomeArquivo = "") {
  const aba = abas.find((item) => item.nome === nomeAba);
  const identificada = identificarAbasDeVinculos(abas, nomeArquivo).find(
    (item) => item.nome === nomeAba,
  );
  if (!aba || !identificada?.compativel || identificada.coluna_uc === null)
    throw new Error(
      "Selecione uma aba com coluna de UC e identificação da usina.",
    );
  const linhas = [];
  const repetidas = new Map();
  const antigas = new Map();
  for (let i = identificada.cabecalho; i < aba.linhas.length; i++) {
    const linha = aba.linhas[i];
    const ucCelula = linha[identificada.coluna_uc];
    const usinaCelula =
      identificada.coluna_usina === null
        ? null
        : linha[identificada.coluna_usina];
    const clienteCelula =
      identificada.coluna_cliente === null
        ? null
        : linha[identificada.coluna_cliente];
    const antigaCelula =
      identificada.coluna_uc_antiga === null ||
      identificada.coluna_uc_antiga < 0
        ? null
        : linha[identificada.coluna_uc_antiga];
    if (!ucCelula?.valor?.trim() && !antigaCelula?.valor?.trim()) continue;
    const item = {
      linha: i + 1,
      uc: "",
      uc_antiga: "",
      usina: "",
      cliente: "",
      erro: "",
    };
    if (
      [ucCelula, antigaCelula, usinaCelula, clienteCelula].some(
        (c) => c && ["formula", "erro"].includes(c.tipo),
      )
    )
      item.erro =
        "Fórmula ou erro em UC, UC antiga, usina ou cliente. Envie valores conferidos.";
    if (!item.erro && !ucCelula?.valor?.trim())
      item.erro =
        "UC atual ausente; a UC antiga não será usada como atual automaticamente.";
    if (!item.erro) {
      try {
        item.uc = normalizarUc(ucCelula.valor);
      } catch {
        item.erro = "UC inválida.";
      }
    }
    if (
      antigaCelula?.valor?.trim() &&
      !["formula", "erro"].includes(antigaCelula.tipo)
    ) {
      try {
        item.uc_antiga = normalizarUc(antigaCelula.valor);
      } catch {
        if (!item.erro) item.erro = "UC antiga inválida.";
      }
    }
    item.usina = String(usinaCelula?.valor ?? identificada.usina_sugerida ?? "")
      .trim()
      .slice(0, 120);
    item.cliente = String(clienteCelula?.valor ?? "")
      .split(/\r?\n/, 1)[0]
      .trim()
      .slice(0, 120);
    if (!item.usina && !item.erro) item.erro = "Usina não informada.";
    if (item.uc) {
      const anterior = repetidas.get(item.uc);
      if (anterior && chaveUsina(anterior.usina) !== chaveUsina(item.usina)) {
        item.erro = `UC aparece em usinas diferentes (linhas ${anterior.linha} e ${item.linha}).`;
        anterior.erro = item.erro;
      } else if (anterior && !item.erro)
        item.erro = `UC repetida na linha ${anterior.linha}.`;
      else if (!anterior) repetidas.set(item.uc, item);
    }
    if (item.uc_antiga) {
      const anterior = antigas.get(item.uc_antiga);
      if (anterior && anterior.uc !== item.uc) {
        item.erro = `UC antiga aparece em residências diferentes (linhas ${anterior.linha} e ${item.linha}).`;
        anterior.erro = item.erro;
      } else if (!anterior) antigas.set(item.uc_antiga, item);
    }
    linhas.push(item);
  }
  for (const linha of linhas) {
    const atualDeOutra = repetidas.get(linha.uc_antiga);
    if (atualDeOutra && atualDeOutra.uc !== linha.uc) {
      const erro = `UC antiga da linha ${linha.linha} coincide com a UC atual da linha ${atualDeOutra.linha}. Confira a renumeração.`;
      linha.erro = erro;
      atualDeOutra.erro = erro;
    }
  }
  if (linhas.length > 2000) throw new Error("A aba excede 2.000 UCs.");
  return { aba: nomeAba, cabecalho: identificada.cabecalho, linhas };
}
