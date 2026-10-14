import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";

const argumentos = process.argv.slice(2);
const valorDe = (nome) => {
  const indice = argumentos.indexOf(nome);
  return indice < 0 ? null : argumentos[indice + 1];
};
const pdfInformado = valorDe("--pdf");
const bancoInformado = valorDe("--database");
const pythonInformado = valorDe("--python");
if (!pdfInformado || !bancoInformado || !pythonInformado)
  throw new Error(
    "Uso: node atualizarClientesRelatorioPdf.mjs --pdf ARQUIVO --database BANCO --python PYTHON [--simulate|--apply --expected-plan-hash HASH] [--report ARQUIVO]",
  );
const pdfArquivo = resolve(pdfInformado);
const bancoArquivo = resolve(bancoInformado);
const pythonArquivo = resolve(pythonInformado);
const relatorioArquivo = valorDe("--report")
  ? resolve(valorDe("--report"))
  : null;
const modo = argumentos.includes("--apply")
  ? "apply"
  : argumentos.includes("--simulate")
    ? "simulate"
    : "dry-run";
const hashEsperado = valorDe("--expected-plan-hash");
const extratorArquivo = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "extrairRelatorioClientesPdf.py",
);

const apenasDigitos = (valor) => String(valor ?? "").replace(/\D/g, "");
const normalizarUc = (valor) => apenasDigitos(valor).replace(/^0+(?=\d)/, "");
const chaveNome = (valor) =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const hashArquivo = (arquivo) =>
  createHash("sha256").update(readFileSync(arquivo)).digest("hex");
// Neste cruzamento documental, o CPF serve para identificar o cadastro.
// Por decisão operacional, validamos somente a presença dos 11 algarismos;
// o dígito verificador não bloqueia a absorção do dado informado na fonte.
const cpfValido = (valor) => /^\d{11}$/.test(apenasDigitos(valor));
const cnpjValido = (valor) => {
  const cnpj = apenasDigitos(valor);
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false;
  for (const [tamanho, pesos] of [
    [12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]],
    [13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]],
  ]) {
    const resto =
      [...cnpj.slice(0, tamanho)].reduce(
        (soma, digito, indice) => soma + Number(digito) * pesos[indice],
        0,
      ) % 11;
    if (Number(cnpj[tamanho]) !== (resto < 2 ? 0 : 11 - resto)) return false;
  }
  return true;
};
const emailValido = (valor) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(valor ?? ""));

function extrairPdf() {
  const execucao = spawnSync(pythonArquivo, [extratorArquivo, pdfArquivo], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (execucao.status !== 0)
    throw new Error(
      `Falha ao extrair o PDF: ${execucao.stderr || execucao.stdout}`,
    );
  const registros = JSON.parse(execucao.stdout);
  const principais = registros.filter(
    (item) => item.origem === "base_principal",
  ).length;
  const migracoes = registros.filter(
    (item) => item.origem === "migracao_uc",
  ).length;
  if (registros.length !== 194 || principais !== 174 || migracoes !== 20)
    throw new Error(
      `Extração incompleta: ${registros.length} registros (${principais} principais e ${migracoes} migrações).`,
    );
  return registros;
}

function planejar(banco, registros, pdfSha256) {
  const unidades = banco
    .prepare(
      "SELECT id,uc,uc_antiga,nome,documento,email,versao,cliente_id,cliente_provisorio_id,cliente_operacional_id,pendencia_cadastro FROM faturamento_unidades",
    )
    .all();
  const clientes = banco
    .prepare("SELECT id,name,cpf,email,phone,password_hash FROM customers")
    .all();
  const cpfsEquipe = new Set(
    banco
      .prepare("SELECT cpf FROM staff_users WHERE cpf IS NOT NULL")
      .all()
      .map((item) => item.cpf),
  );
  const clientesPorId = new Map(clientes.map((item) => [item.id, item]));
  const clientesPorCpf = new Map(clientes.map((item) => [item.cpf, item]));
  const clientesPorEmail = new Map();
  for (const cliente of clientes) {
    if (!cliente.email) continue;
    const chave = cliente.email.toLowerCase();
    const lista = clientesPorEmail.get(chave) ?? [];
    lista.push(cliente);
    clientesPorEmail.set(chave, lista);
  }
  const unidadesPorUc = new Map();
  const unidadesPorAntiga = new Map();
  const tabelaAliases = Boolean(
    banco
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='faturamento_unidades_aliases'",
      )
      .get(),
  );
  const aliases = tabelaAliases
    ? banco
        .prepare("SELECT unidade_id,uc FROM faturamento_unidades_aliases")
        .all()
    : [];
  const unidadesPorAlias = new Map();
  for (const unidade of unidades) {
    const uc = normalizarUc(unidade.uc);
    const antiga = normalizarUc(unidade.uc_antiga);
    if (uc) {
      const lista = unidadesPorUc.get(uc) ?? [];
      lista.push(unidade);
      unidadesPorUc.set(uc, lista);
    }
    if (antiga) {
      const lista = unidadesPorAntiga.get(antiga) ?? [];
      lista.push(unidade);
      unidadesPorAntiga.set(antiga, lista);
    }
  }
  for (const alias of aliases) {
    const unidade = unidades.find((item) => item.id === alias.unidade_id);
    if (!unidade) continue;
    const lista = unidadesPorAlias.get(normalizarUc(alias.uc)) ?? [];
    lista.push(unidade);
    unidadesPorAlias.set(normalizarUc(alias.uc), lista);
  }

  const unidadesDoIdentificador = (valor) => {
    const uc = normalizarUc(valor);
    return [
      ...(unidadesPorUc.get(uc) ?? []),
      ...(unidadesPorAntiga.get(uc) ?? []),
      ...(unidadesPorAlias.get(uc) ?? []),
    ];
  };

  const pendencias = [];
  const evidenciasPorUnidade = new Map();
  const novasUnidades = [];
  for (const registro of registros) {
    const candidatos = [
      ...unidadesDoIdentificador(registro.uc_final),
      ...unidadesDoIdentificador(registro.uc_original),
    ];
    const unicos = [
      ...new Map(candidatos.map((item) => [item.id, item])).values(),
    ];
    if (unicos.length !== 1) {
      if (!unicos.length && registro.origem === "migracao_uc") {
        novasUnidades.push({
          uc: normalizarUc(registro.uc_final),
          uc_antiga: normalizarUc(registro.uc_original),
          nome: registro.nome,
          pagina: registro.pagina,
          linha: registro.linha,
        });
        continue;
      }
      pendencias.push({
        tipo: unicos.length ? "uc_ambigua_no_sistema" : "uc_nao_encontrada",
        uc: registro.uc_final,
        pagina: registro.pagina,
        linha: registro.linha,
      });
      continue;
    }
    const unidade = unicos[0];
    const lista = evidenciasPorUnidade.get(unidade.id) ?? [];
    lista.push(registro);
    evidenciasPorUnidade.set(unidade.id, lista);
  }

  const aliasesAdicionar = [];
  for (const registro of registros.filter(
    (item) => item.origem === "migracao_uc",
  )) {
    const candidatos = [
      ...unidadesDoIdentificador(registro.uc_final),
      ...unidadesDoIdentificador(registro.uc_original),
    ];
    const unicos = [
      ...new Map(candidatos.map((item) => [item.id, item])).values(),
    ];
    if (unicos.length !== 1) continue;
    const unidade = unicos[0];
    const antiga = normalizarUc(registro.uc_original);
    if (
      antiga !== normalizarUc(unidade.uc) &&
      antiga !== normalizarUc(unidade.uc_antiga) &&
      !(unidadesPorAlias.get(antiga) ?? []).some(
        (item) => item.id === unidade.id,
      )
    )
      aliasesAdicionar.push({
        unidade_id: unidade.id,
        uc: antiga,
        pagina: registro.pagina,
        linha: registro.linha,
      });
  }

  const operacoesUnidades = [];
  const gruposCliente = new Map();
  for (const [unidadeId, evidencias] of evidenciasPorUnidade) {
    const unidade = unidades.find((item) => item.id === unidadeId);
    const nomes = new Map(
      evidencias
        .filter((item) => item.nome)
        .map((item) => [chaveNome(item.nome), item.nome]),
    );
    const emails = new Set(
      evidencias
        .filter((item) => item.emails.length === 1)
        .map((item) => item.emails[0])
        .filter(emailValido),
    );
    const documentosExtraidos = new Set(
      evidencias
        .filter((item) => item.documentos.length === 1)
        .map((item) => item.documentos[0]),
    );
    const documentos = new Set(
      [...documentosExtraidos].filter(
        (item) => cpfValido(item) || cnpjValido(item),
      ),
    );
    if (evidencias.some((item) => item.documentos.length > 1))
      pendencias.push({
        tipo: "documento_divergente_no_pdf",
        uc: unidade.uc,
        referencias: evidencias
          .filter((item) => item.documentos.length > 1)
          .map((item) => ({ pagina: item.pagina, linha: item.linha })),
      });
    if (!unidade.nome && nomes.size > 1)
      pendencias.push({ tipo: "nomes_divergentes", uc: unidade.uc });
    if (!unidade.email && emails.size > 1)
      pendencias.push({ tipo: "emails_divergentes", uc: unidade.uc });
    if (!unidade.documento && documentos.size > 1)
      pendencias.push({ tipo: "documentos_divergentes", uc: unidade.uc });
    if (
      !unidade.documento &&
      documentosExtraidos.size === 1 &&
      documentos.size === 0
    )
      pendencias.push({ tipo: "documento_invalido_no_pdf", uc: unidade.uc });

    const nome =
      unidade.nome || (nomes.size === 1 ? [...nomes.values()][0] : "");
    const email =
      unidade.email || (emails.size === 1 ? [...emails.values()][0] : "");
    const documentoDoPdf =
      documentos.size === 1 ? [...documentos.values()][0] : "";
    const documento = unidade.documento || documentoDoPdf;
    const documentoFoiPreenchido = Boolean(
      !unidade.documento && documentoDoPdf,
    );
    let clienteId = unidade.cliente_id;
    let criarCpf = null;
    let pendenciaCadastro = unidade.pendencia_cadastro;
    if (!clienteId && documentoDoPdf && cpfValido(documentoDoPdf)) {
      const existente = clientesPorCpf.get(documento);
      if (existente) {
        clienteId = existente.id;
        pendenciaCadastro = null;
      } else if (cpfsEquipe.has(documento)) {
        pendencias.push({ tipo: "cpf_cadastrado_na_equipe", uc: unidade.uc });
      } else if (!email) {
        pendenciaCadastro = "Contato ausente para cadastro definitivo";
        pendencias.push({ tipo: "cpf_sem_email_para_portal", uc: unidade.uc });
      } else if ((clientesPorEmail.get(email.toLowerCase()) ?? []).length) {
        pendencias.push({
          tipo: "email_pertence_a_outro_cliente",
          uc: unidade.uc,
        });
      } else {
        criarCpf = documento;
        pendenciaCadastro = null;
        const grupo = gruposCliente.get(documento) ?? {
          cpf: documento,
          nomes: new Map(),
          emails: new Set(),
          unidades: [],
        };
        grupo.nomes.set(chaveNome(nome), nome);
        grupo.emails.add(email);
        grupo.unidades.push(unidade.id);
        gruposCliente.set(documento, grupo);
      }
    } else if (
      !clienteId &&
      documentoFoiPreenchido &&
      cnpjValido(documentoDoPdf)
    ) {
      pendenciaCadastro = "CNPJ sem CPF do responsável para acesso ao portal";
    }
    operacoesUnidades.push({
      id: unidade.id,
      uc: unidade.uc,
      versao: unidade.versao,
      referencias: evidencias.map((item) => ({
        origem: item.origem,
        pagina: item.pagina,
        linha: item.linha,
      })),
      antes: {
        nome: unidade.nome,
        documento: unidade.documento,
        email: unidade.email,
        cliente_id: unidade.cliente_id,
        cliente_provisorio_id: unidade.cliente_provisorio_id,
        cliente_operacional_id: unidade.cliente_operacional_id,
        pendencia_cadastro: unidade.pendencia_cadastro,
      },
      depois: {
        nome,
        documento,
        email,
        cliente_id: clienteId,
        criarCpf,
        pendencia_cadastro: pendenciaCadastro,
      },
    });
  }

  const novosClientes = [];
  const cpfsBloqueados = new Set();
  for (const [cpf, grupo] of gruposCliente) {
    if (grupo.nomes.size !== 1 || grupo.emails.size !== 1) {
      cpfsBloqueados.add(cpf);
      pendencias.push({
        tipo: "dados_divergentes_para_novo_cliente",
        ucs: operacoesUnidades
          .filter((item) => item.depois.criarCpf === cpf)
          .map((item) => item.uc),
      });
      continue;
    }
    novosClientes.push({
      cpf,
      name: [...grupo.nomes.values()][0],
      email: [...grupo.emails][0],
      phone: "",
    });
  }

  const unidadesAlteradas = operacoesUnidades
    .filter((item) => !cpfsBloqueados.has(item.depois.criarCpf))
    .map((item) => {
      const antes = item.antes;
      const depois = item.depois;
      const limparAuxiliares = Boolean(depois.cliente_id || depois.criarCpf);
      const muda =
        antes.nome !== depois.nome ||
        antes.documento !== depois.documento ||
        antes.email !== depois.email ||
        antes.cliente_id !== depois.cliente_id ||
        antes.pendencia_cadastro !== depois.pendencia_cadastro ||
        (limparAuxiliares &&
          (antes.cliente_provisorio_id !== null ||
            antes.cliente_operacional_id !== null));
      return { ...item, limparAuxiliares, muda };
    })
    .filter((item) => item.muda);

  const plano = {
    fonte: { arquivo: basename(pdfArquivo), sha256: pdfSha256 },
    novosClientes,
    novasUnidades,
    aliasesAdicionar,
    unidadesAlteradas,
    pendencias,
  };
  return {
    plano,
    hashPlano: createHash("sha256").update(JSON.stringify(plano)).digest("hex"),
  };
}

function garantirTabelaAliases(banco) {
  banco.exec(`
    CREATE TABLE IF NOT EXISTS faturamento_unidades_aliases (
      id INTEGER PRIMARY KEY,
      unidade_id INTEGER NOT NULL REFERENCES faturamento_unidades(id) ON DELETE CASCADE,
      uc TEXT NOT NULL UNIQUE CHECK(uc<>''),
      origem TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS faturamento_unidades_aliases_unidade
      ON faturamento_unidades_aliases(unidade_id);
  `);
}

function aplicarPlano(banco, plano) {
  garantirTabelaAliases(banco);
  for (const cliente of plano.novosClientes)
    banco
      .prepare(
        "INSERT INTO customers(name,cpf,email,phone,password_hash) VALUES(?,?,?,?,NULL)",
      )
      .run(cliente.name, cliente.cpf, cliente.email, cliente.phone);
  for (const unidade of plano.novasUnidades) {
    const conflito = banco
      .prepare(
        `SELECT u.id FROM faturamento_unidades u
         WHERE u.uc IN (?,?) OR u.uc_antiga IN (?,?)
         UNION ALL
         SELECT a.unidade_id FROM faturamento_unidades_aliases a
         WHERE a.uc IN (?,?) LIMIT 1`,
      )
      .get(
        unidade.uc,
        unidade.uc_antiga,
        unidade.uc,
        unidade.uc_antiga,
        unidade.uc,
        unidade.uc_antiga,
      );
    if (conflito)
      throw new Error(
        `A UC ${unidade.uc} ou seu identificador antigo foi cadastrado depois da prévia.`,
      );
    const chaveOrigem = `relatorio-pdf-uc:${unidade.uc}`;
    const provisorioId = Number(
      banco
        .prepare(
          "INSERT INTO faturamento_clientes_provisorios(nome,chave_origem,origem) VALUES(?,?,?)",
        )
        .run(unidade.nome, chaveOrigem, "Relação de clientes e UCs em PDF")
        .lastInsertRowid,
    );
    const unidadeId = Number(
      banco
        .prepare(
          `INSERT INTO faturamento_unidades
           (uc,uc_antiga,nome,documento,email,dia_vencimento,cliente_provisorio_id,pendencia_cadastro)
           VALUES(?,?,?,?,?,?,?,?)`,
        )
        .run(
          unidade.uc,
          unidade.uc_antiga,
          unidade.nome,
          "",
          "",
          0,
          provisorioId,
          "Completar documentação, contato e vínculos cadastrais",
        ).lastInsertRowid,
    );
    banco
      .prepare(
        "INSERT OR IGNORE INTO faturamento_unidades_aliases(unidade_id,uc,origem) VALUES(?,?,?)",
      )
      .run(unidadeId, unidade.uc_antiga, "Relação de migração de UC em PDF");
    banco
      .prepare(
        "INSERT INTO faturamento_historico(unidade_id,responsavel,acao,dados) VALUES(?,?,?,?)",
      )
      .run(
        unidadeId,
        "Cruzamento autorizado pelo usuário",
        "UC provisória criada por relação de migração",
        JSON.stringify({
          fonte_sha256: plano.fonte.sha256,
          pagina: unidade.pagina,
          linha: unidade.linha,
          uc_atual: unidade.uc,
          uc_antiga: unidade.uc_antiga,
        }),
      );
  }
  for (const alias of plano.aliasesAdicionar) {
    const atual = banco
      .prepare("SELECT id FROM faturamento_unidades WHERE uc=?")
      .get(alias.uc);
    const outroAlias = banco
      .prepare("SELECT unidade_id FROM faturamento_unidades_aliases WHERE uc=?")
      .get(alias.uc);
    if (atual || (outroAlias && outroAlias.unidade_id !== alias.unidade_id))
      throw new Error(`A UC histórica ${alias.uc} pertence a outro cadastro.`);
    if (!outroAlias)
      banco
        .prepare(
          "INSERT INTO faturamento_unidades_aliases(unidade_id,uc,origem) VALUES(?,?,?)",
        )
        .run(alias.unidade_id, alias.uc, "Relação de migração de UC em PDF");
  }
  for (const unidade of plano.unidadesAlteradas) {
    const clienteId = unidade.depois.criarCpf
      ? banco
          .prepare("SELECT id FROM customers WHERE cpf=?")
          .get(unidade.depois.criarCpf)?.id
      : unidade.depois.cliente_id;
    const resultado = banco
      .prepare(
        `UPDATE faturamento_unidades SET nome=?,documento=?,email=?,cliente_id=?,
         cliente_provisorio_id=CASE WHEN ? THEN NULL ELSE cliente_provisorio_id END,
         cliente_operacional_id=CASE WHEN ? THEN NULL ELSE cliente_operacional_id END,
         pendencia_cadastro=?,versao=versao+1 WHERE id=? AND versao=?`,
      )
      .run(
        unidade.depois.nome,
        unidade.depois.documento,
        unidade.depois.email,
        clienteId,
        Number(unidade.limparAuxiliares),
        Number(unidade.limparAuxiliares),
        unidade.depois.pendencia_cadastro,
        unidade.id,
        unidade.versao,
      );
    if (resultado.changes !== 1)
      throw new Error(`A UC ${unidade.uc} mudou durante a atualização.`);
    banco
      .prepare(
        "INSERT INTO faturamento_historico(unidade_id,responsavel,acao,dados) VALUES(?,?,?,?)",
      )
      .run(
        unidade.id,
        "Cruzamento autorizado pelo usuário",
        "Campos cadastrais completados pelo relatório PDF",
        JSON.stringify({
          fonte_sha256: plano.fonte.sha256,
          referencias: unidade.referencias,
          cliente_id: clienteId,
          campos_alterados: [
            "nome",
            "documento",
            "email",
            "cliente_id",
            "pendencia_cadastro",
          ].filter((campo) => unidade.antes[campo] !== unidade.depois[campo]),
          vinculo_cliente_criado: Boolean(unidade.depois.criarCpf),
        }),
      );
  }
}

function criarResumo(resultado, aplicado, backupArquivo = null) {
  const pendenciasPorTipo = {};
  for (const item of resultado.plano.pendencias)
    pendenciasPorTipo[item.tipo] = (pendenciasPorTipo[item.tipo] ?? 0) + 1;
  const camposPreenchidos = {};
  for (const unidade of resultado.plano.unidadesAlteradas)
    for (const campo of ["nome", "documento", "email", "cliente_id"])
      if (unidade.antes[campo] !== unidade.depois[campo])
        camposPreenchidos[campo] = (camposPreenchidos[campo] ?? 0) + 1;
  const vinculosCliente = resultado.plano.unidadesAlteradas.filter(
    (unidade) =>
      !unidade.antes.cliente_id &&
      (unidade.depois.cliente_id || unidade.depois.criarCpf),
  ).length;
  return {
    modo,
    aplicado,
    hashPlano: resultado.hashPlano,
    backup: backupArquivo,
    fonte: resultado.plano.fonte,
    clientesCriados: resultado.plano.novosClientes.length,
    unidadesCriadas: resultado.plano.novasUnidades.length,
    identificadoresHistoricosAdicionados:
      resultado.plano.aliasesAdicionar.length +
      resultado.plano.novasUnidades.length,
    unidadesAtualizadas: resultado.plano.unidadesAlteradas.length,
    vinculosCliente,
    camposPreenchidos,
    alteracoes: resultado.plano.unidadesAlteradas.map((unidade) => ({
      uc: unidade.uc,
      campos: ["nome", "documento", "email", "cliente_id"].filter(
        (campo) => unidade.antes[campo] !== unidade.depois[campo],
      ),
      vinculoClienteCriado: Boolean(unidade.depois.criarCpf),
    })),
    pendenciasPorTipo,
    pendencias: resultado.plano.pendencias,
  };
}

const pdfSha256 = hashArquivo(pdfArquivo);
const registros = extrairPdf();
if (hashArquivo(pdfArquivo) !== pdfSha256)
  throw new Error("O PDF mudou durante a extração.");
const leitura = new DatabaseSync(bancoArquivo, { readOnly: true });
let resultado;
try {
  resultado = planejar(leitura, registros, pdfSha256);
} finally {
  leitura.close();
}

let saida;
let pastaTemporaria = null;
if (modo === "dry-run") {
  saida = criarResumo(resultado, false);
} else {
  if (modo === "apply" && hashEsperado !== resultado.hashPlano)
    throw new Error(
      "A prévia não foi confirmada ou mudou. Use o hash retornado pelo dry-run.",
    );
  let alvo = bancoArquivo;
  let copia = null;
  if (modo === "simulate") {
    pastaTemporaria = mkdtempSync(join(tmpdir(), "ecosol-clientes-pdf-"));
    alvo = join(pastaTemporaria, "ecosol.db");
    const origem = new DatabaseSync(bancoArquivo, { readOnly: true });
    try {
      await backup(origem, alvo);
    } finally {
      origem.close();
    }
  } else {
    const pastaBackup = join(dirname(bancoArquivo), "backups");
    mkdirSync(pastaBackup, { recursive: true });
    copia = join(
      pastaBackup,
      `ecosol-antes-clientes-pdf-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
    );
    const origem = new DatabaseSync(bancoArquivo, { readOnly: true });
    try {
      await backup(origem, copia);
    } finally {
      origem.close();
    }
  }
  const banco = new DatabaseSync(alvo);
  banco.exec(
    "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE",
  );
  try {
    const atual = planejar(banco, registros, pdfSha256);
    if (atual.hashPlano !== resultado.hashPlano)
      throw new Error("O banco mudou depois da prévia. Operação cancelada.");
    aplicarPlano(banco, atual.plano);
    if (banco.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw new Error("A verificação de integridade do banco falhou.");
    if (banco.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("A verificação de chaves estrangeiras falhou.");
    banco.exec("COMMIT");
    saida = criarResumo(atual, true, copia);
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  } finally {
    banco.close();
  }
}

if (relatorioArquivo) {
  mkdirSync(dirname(relatorioArquivo), { recursive: true });
  writeFileSync(relatorioArquivo, JSON.stringify(saida, null, 2), "utf8");
}
console.log(JSON.stringify(saida, null, 2));
if (pastaTemporaria) rmSync(pastaTemporaria, { recursive: true, force: true });
