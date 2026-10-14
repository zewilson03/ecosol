import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import ExcelJS from "exceljs";

const argumentos = process.argv.slice(2);
const valorDe = (nome) => {
  const indice = argumentos.indexOf(nome);
  return indice < 0 ? null : argumentos[indice + 1];
};
const diretorioInformado = valorDe("--directory");
const bancoInformado = valorDe("--database");
const diretorio = diretorioInformado ? resolve(diretorioInformado) : null;
const bancoArquivo = bancoInformado ? resolve(bancoInformado) : null;
const relatorioArquivo = valorDe("--report")
  ? resolve(valorDe("--report"))
  : null;
const modo = argumentos.includes("--apply")
  ? "apply"
  : argumentos.includes("--simulate")
    ? "simulate"
    : "dry-run";
const hashEsperado = valorDe("--expected-plan-hash");
if (!diretorio || !bancoArquivo)
  throw new Error(
    "Uso: node atualizarClientesCrm.mjs --directory PASTA --database BANCO [--dry-run|--simulate|--apply --expected-plan-hash HASH] [--report ARQUIVO]",
  );

const apenasDigitos = (valor) => String(valor ?? "").replace(/\D/g, "");
const normalizarUc = (valor) => apenasDigitos(valor).replace(/^0+(?=\d)/, "");
const chaveNome = (valor) =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const texto = (valor) =>
  String(valor ?? "")
    .trim()
    .replace(/\s+/g, " ");
const cpfValido = (valor) => {
  const cpf = apenasDigitos(valor);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++)
      soma += Number(cpf[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    if (Number(cpf[tamanho]) !== (resto === 10 ? 0 : resto)) return false;
  }
  return true;
};
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
const emailValido = (valor) => {
  const email = texto(valor).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
};
const telefoneValido = (valor) => {
  let telefone = apenasDigitos(valor);
  if (telefone.startsWith("55") && [12, 13].includes(telefone.length))
    telefone = telefone.slice(2);
  return [10, 11].includes(telefone.length) && !/^(\d)\1+$/.test(telefone)
    ? telefone
    : "";
};
const celula = (valor) => {
  if (valor && typeof valor === "object")
    return valor.text ?? valor.result ?? valor.hyperlink ?? "";
  return valor ?? "";
};
const hashArquivo = (arquivo) =>
  createHash("sha256").update(readFileSync(arquivo)).digest("hex");

async function carregarFontes() {
  const arquivos = readdirSync(diretorio)
    .filter((nome) => /\.xlsx$/i.test(nome))
    .map((nome) => join(diretorio, nome));
  const mapaArquivo = arquivos.find((arquivo) =>
    /ucs antigas e novas/i.test(basename(arquivo)),
  );
  const crmArquivo = arquivos.find((arquivo) =>
    /planilha crm/i.test(basename(arquivo)),
  );
  if (!mapaArquivo || !crmArquivo)
    throw new Error(
      "A pasta precisa conter a planilha CRM e a relação de UCs antigas/novas.",
    );

  const mapaLivro = new ExcelJS.Workbook();
  await mapaLivro.xlsx.readFile(mapaArquivo);
  const mapaAba = mapaLivro.worksheets[0];
  const mapas = new Map();
  const conflitosMapa = [];
  mapaAba.eachRow((linha, numero) => {
    if (numero < 3) return;
    const antiga = normalizarUc(celula(linha.getCell(1).value));
    const nova = normalizarUc(celula(linha.getCell(2).value));
    const nome = texto(celula(linha.getCell(3).value));
    if (!antiga || !nova) return;
    const anterior = mapas.get(antiga);
    if (anterior && anterior.nova !== nova)
      conflitosMapa.push({
        linha: numero,
        antiga,
        novas: [anterior.nova, nova],
      });
    else mapas.set(antiga, { nova, nome, linha: numero });
  });

  const crmLivro = new ExcelJS.Workbook();
  await crmLivro.xlsx.readFile(crmArquivo);
  const crmAba = crmLivro.getWorksheet("leads") ?? crmLivro.worksheets[0];
  const cabecalhos = new Map();
  crmAba.getRow(1).eachCell((celulaExcel, coluna) => {
    cabecalhos.set(chaveNome(celula(celulaExcel.value)), coluna);
  });
  const coluna = (nome) => {
    const encontrada = cabecalhos.get(chaveNome(nome));
    if (!encontrada) throw new Error(`Coluna ausente na CRM: ${nome}`);
    return encontrada;
  };
  const indices = {
    nome: coluna("Nome Cliente"),
    email: coluna("Email Cliente"),
    telefone: coluna("Telefone Cliente"),
    responsavel: coluna("Responsável Legal Conta"),
    documento: coluna("Documento"),
    tipo: coluna("Tipo de Pessoa (F = Física, J = Juridica"),
    uc: coluna("Unidade Consumidora"),
    status: coluna("Notas"),
  };
  const linhas = [];
  const statusIgnorados = {};
  crmAba.eachRow((linha, numero) => {
    if (numero === 1) return;
    const status = texto(
      celula(linha.getCell(indices.status).value),
    ).toUpperCase();
    if (status !== "ATIVO") {
      const chave = status || "VAZIO";
      statusIgnorados[chave] = (statusIgnorados[chave] ?? 0) + 1;
      return;
    }
    const ucOriginal = normalizarUc(celula(linha.getCell(indices.uc).value));
    if (!ucOriginal) return;
    const mapeamento = mapas.get(ucOriginal);
    const documento = apenasDigitos(
      celula(linha.getCell(indices.documento).value),
    );
    linhas.push({
      linha: numero,
      ucOriginal,
      ucFinal: mapeamento?.nova ?? ucOriginal,
      linhaMapa: mapeamento?.linha ?? null,
      nome: texto(celula(linha.getCell(indices.nome).value)),
      responsavel: texto(celula(linha.getCell(indices.responsavel).value)),
      documento,
      documentoTipo: cpfValido(documento)
        ? "CPF"
        : cnpjValido(documento)
          ? "CNPJ"
          : "INVALIDO",
      email: emailValido(celula(linha.getCell(indices.email).value)),
      telefone: telefoneValido(celula(linha.getCell(indices.telefone).value)),
    });
  });
  return {
    linhas,
    conflitosMapa,
    statusIgnorados,
    fontes: [mapaArquivo, crmArquivo].map((arquivo) => ({
      arquivo,
      sha256: hashArquivo(arquivo),
    })),
  };
}

function planejar(banco, fontes) {
  const unidades = banco
    .prepare(
      "SELECT id,uc,uc_antiga,nome,documento,email,dia_vencimento,versao,cliente_id,cliente_provisorio_id,cliente_operacional_id,pendencia_cadastro FROM faturamento_unidades",
    )
    .all();
  const clientes = banco
    .prepare(
      "SELECT id,name,cpf,email,phone,password_hash FROM customers ORDER BY id",
    )
    .all();
  const cpfsEquipe = new Set(
    banco
      .prepare("SELECT cpf FROM staff_users WHERE cpf IS NOT NULL")
      .all()
      .map((item) => item.cpf),
  );
  const unidadesPorUc = new Map();
  const unidadesPorAntiga = new Map();
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
  const clientesPorId = new Map(
    clientes.map((cliente) => [cliente.id, cliente]),
  );
  const clientesPorCpf = new Map(
    clientes.map((cliente) => [cliente.cpf, cliente]),
  );
  const clientesPorEmail = new Map();
  for (const cliente of clientes) {
    if (!cliente.email) continue;
    const lista = clientesPorEmail.get(cliente.email.toLowerCase()) ?? [];
    lista.push(cliente);
    clientesPorEmail.set(cliente.email.toLowerCase(), lista);
  }

  const pendencias = [];
  const evidenciasPorUnidade = new Map();
  const unidadesComEvidenciaConflitante = new Set();
  for (const linha of fontes.linhas) {
    const candidatos = [
      ...(unidadesPorUc.get(linha.ucFinal) ?? []),
      ...(unidadesPorAntiga.get(linha.ucOriginal) ?? []),
      ...(unidadesPorUc.get(linha.ucOriginal) ?? []),
    ];
    const unicos = [
      ...new Map(candidatos.map((item) => [item.id, item])).values(),
    ];
    if (unicos.length !== 1) {
      pendencias.push({
        tipo: unicos.length ? "uc_ambigua_no_sistema" : "uc_nao_encontrada",
        linha: linha.linha,
        uc: linha.ucFinal,
      });
      continue;
    }
    const unidade = unicos[0];
    if (unidadesComEvidenciaConflitante.has(unidade.id)) continue;
    const existente = evidenciasPorUnidade.get(unidade.id);
    if (
      existente &&
      (existente.documento !== linha.documento ||
        chaveNome(existente.nome) !== chaveNome(linha.nome))
    ) {
      evidenciasPorUnidade.delete(unidade.id);
      unidadesComEvidenciaConflitante.add(unidade.id);
      pendencias.push({
        tipo: "linhas_conflitantes_para_uc",
        linhas: [existente.linha, linha.linha],
        uc: unidade.uc,
      });
      continue;
    }
    evidenciasPorUnidade.set(unidade.id, { ...linha, unidade });
  }

  const grupos = new Map();
  const atualizacoesUnidades = [];
  for (const evidencia of evidenciasPorUnidade.values()) {
    const { unidade } = evidencia;
    let cliente = unidade.cliente_id
      ? clientesPorId.get(unidade.cliente_id)
      : null;
    let criarCpf = null;
    if (evidencia.documentoTipo === "CPF") {
      const peloCpf = clientesPorCpf.get(evidencia.documento);
      if (cliente && cliente.cpf !== evidencia.documento) {
        if (peloCpf && peloCpf.id !== cliente.id) {
          pendencias.push({
            tipo: "cpf_pertence_a_outro_cliente",
            linha: evidencia.linha,
            uc: unidade.uc,
            clienteAtualId: cliente.id,
            clienteDocumentoId: peloCpf.id,
          });
          continue;
        }
        if (cliente.password_hash) {
          pendencias.push({
            tipo: "cpf_divergente_em_conta_ativa",
            linha: evidencia.linha,
            uc: unidade.uc,
            clienteId: cliente.id,
          });
          continue;
        }
      } else if (!cliente) {
        cliente = peloCpf ?? null;
        if (!cliente) criarCpf = evidencia.documento;
      }
      if (cpfsEquipe.has(evidencia.documento)) {
        pendencias.push({
          tipo: "cpf_tambem_cadastrado_na_equipe",
          linha: evidencia.linha,
          uc: unidade.uc,
        });
        continue;
      }
    } else if (evidencia.documentoTipo === "INVALIDO") {
      pendencias.push({
        tipo: "documento_invalido_na_planilha",
        linha: evidencia.linha,
        uc: unidade.uc,
      });
    }

    if (!cliente && !criarCpf && evidencia.email) {
      const peloEmail = clientesPorEmail.get(evidencia.email) ?? [];
      if (peloEmail.length === 1 && evidencia.documentoTipo === "CPF")
        cliente = peloEmail[0];
    }
    if (!cliente && criarCpf && !evidencia.email && !evidencia.telefone) {
      pendencias.push({
        tipo: "sem_contato_para_novo_cliente",
        linha: evidencia.linha,
        uc: unidade.uc,
      });
      criarCpf = null;
    }
    if (!cliente && criarCpf && !evidencia.nome) {
      pendencias.push({
        tipo: "sem_nome_para_novo_cliente",
        linha: evidencia.linha,
        uc: unidade.uc,
      });
      criarCpf = null;
    }
    if (!cliente && evidencia.documentoTipo === "CNPJ")
      pendencias.push({
        tipo: "cnpj_sem_cpf_do_responsavel_para_portal",
        linha: evidencia.linha,
        uc: unidade.uc,
      });

    const chaveGrupo = cliente
      ? `id:${cliente.id}`
      : criarCpf
        ? `cpf:${criarCpf}`
        : null;
    if (chaveGrupo) {
      const grupo = grupos.get(chaveGrupo) ?? {
        cliente,
        criarCpf,
        evidencias: [],
      };
      grupo.evidencias.push(evidencia);
      grupos.set(chaveGrupo, grupo);
    }
    atualizacoesUnidades.push({
      unidade,
      evidencia,
      clienteId: cliente?.id ?? null,
      criarCpf,
    });
  }

  const atualizacoesClientes = [];
  const novosClientes = [];
  const gruposBloqueados = new Set();
  for (const [chave, grupo] of grupos) {
    const documentos = new Set(
      grupo.evidencias
        .filter((item) => item.documentoTipo !== "INVALIDO")
        .map((item) => item.documento),
    );
    const nomes = new Map(
      grupo.evidencias.map((item) => [chaveNome(item.nome), item.nome]),
    );
    const emails = new Set(
      grupo.evidencias.map((item) => item.email).filter(Boolean),
    );
    const telefones = new Set(
      grupo.evidencias.map((item) => item.telefone).filter(Boolean),
    );
    if (documentos.size > 1 || nomes.size > 1) {
      gruposBloqueados.add(chave);
      pendencias.push({
        tipo: "identidades_conflitantes_para_cliente",
        clienteId: grupo.cliente?.id ?? null,
        linhas: grupo.evidencias.map((item) => item.linha),
        ucs: grupo.evidencias.map((item) => item.unidade.uc),
      });
      continue;
    }
    const nome = [...nomes.values()][0];
    const email = emails.size === 1 ? [...emails][0] : "";
    const telefone = telefones.size === 1 ? [...telefones][0] : "";
    if (emails.size > 1)
      pendencias.push({
        tipo: "emails_divergentes_preservados",
        clienteId: grupo.cliente?.id ?? null,
        linhas: grupo.evidencias.map((item) => item.linha),
      });
    if (telefones.size > 1)
      pendencias.push({
        tipo: "telefones_divergentes_preservados",
        clienteId: grupo.cliente?.id ?? null,
        linhas: grupo.evidencias.map((item) => item.linha),
      });
    if (grupo.cliente) {
      let cpf = grupo.cliente.cpf;
      const documento = [...documentos][0] ?? "";
      if (
        documento &&
        cpfValido(documento) &&
        cpf !== documento &&
        !grupo.cliente.password_hash &&
        !clientesPorCpf.has(documento)
      )
        cpf = documento;
      const depois = {
        name: nome || grupo.cliente.name,
        cpf,
        email: email || grupo.cliente.email,
        phone: telefone || grupo.cliente.phone,
      };
      const antes = {
        name: grupo.cliente.name,
        cpf: grupo.cliente.cpf,
        email: grupo.cliente.email,
        phone: grupo.cliente.phone,
      };
      if (JSON.stringify(antes) !== JSON.stringify(depois))
        atualizacoesClientes.push({
          id: grupo.cliente.id,
          antes,
          depois,
          linhas: grupo.evidencias.map((item) => item.linha),
          unidades: grupo.evidencias.map((item) => item.unidade.id),
        });
    } else {
      novosClientes.push({
        cpf: grupo.criarCpf,
        name: nome,
        email,
        phone: telefone,
        linhas: grupo.evidencias.map((item) => item.linha),
        unidades: grupo.evidencias.map((item) => item.unidade.id),
      });
    }
  }

  const operacoesUnidades = atualizacoesUnidades
    .filter((item) => {
      const chave = item.clienteId
        ? `id:${item.clienteId}`
        : item.criarCpf
          ? `cpf:${item.criarCpf}`
          : null;
      return !chave || !gruposBloqueados.has(chave);
    })
    .map((item) => {
      const depois = {
        nome: item.evidencia.nome || item.unidade.nome,
        documento:
          item.evidencia.documentoTipo === "INVALIDO"
            ? item.unidade.documento
            : item.evidencia.documento,
        email: item.evidencia.email || item.unidade.email,
        cliente_id: item.clienteId,
        criarCpf: item.criarCpf,
        limparOperacional: Boolean(item.clienteId || item.criarCpf),
      };
      const antes = {
        nome: item.unidade.nome,
        documento: item.unidade.documento,
        email: item.unidade.email,
        cliente_id: item.unidade.cliente_id,
        cliente_provisorio_id: item.unidade.cliente_provisorio_id,
        cliente_operacional_id: item.unidade.cliente_operacional_id,
        pendencia_cadastro: item.unidade.pendencia_cadastro,
      };
      const muda =
        antes.nome !== depois.nome ||
        antes.documento !== depois.documento ||
        antes.email !== depois.email ||
        (depois.limparOperacional &&
          (antes.cliente_id !== depois.cliente_id ||
            antes.cliente_provisorio_id !== null ||
            antes.cliente_operacional_id !== null ||
            antes.pendencia_cadastro !== null));
      return {
        id: item.unidade.id,
        uc: item.unidade.uc,
        versao: item.unidade.versao,
        linha: item.evidencia.linha,
        linhaMapa: item.evidencia.linhaMapa,
        antes,
        depois,
        muda,
      };
    })
    .filter((item) => item.muda);

  const plano = {
    fontes: fontes.fontes.map((item) => ({
      arquivo: basename(item.arquivo),
      sha256: item.sha256,
    })),
    atualizacoesClientes,
    novosClientes,
    operacoesUnidades,
    pendencias: [
      ...fontes.conflitosMapa.map((item) => ({
        tipo: "conflito_no_mapa_de_ucs",
        ...item,
      })),
      ...pendencias,
    ],
    statusIgnorados: fontes.statusIgnorados,
  };
  const hashPlano = createHash("sha256")
    .update(JSON.stringify(plano))
    .digest("hex");
  return { plano, hashPlano };
}

function aplicarPlano(banco, plano) {
  for (const cliente of plano.atualizacoesClientes) {
    const resultado = banco
      .prepare(
        "UPDATE customers SET name=?,cpf=?,email=?,phone=? WHERE id=? AND name=? AND cpf=? AND email=? AND phone=?",
      )
      .run(
        cliente.depois.name,
        cliente.depois.cpf,
        cliente.depois.email,
        cliente.depois.phone,
        cliente.id,
        cliente.antes.name,
        cliente.antes.cpf,
        cliente.antes.email,
        cliente.antes.phone,
      );
    if (resultado.changes !== 1)
      throw new Error(`Cliente ${cliente.id} mudou durante a atualização.`);
  }
  for (const cliente of plano.novosClientes)
    banco
      .prepare(
        "INSERT INTO customers(name,cpf,email,phone,password_hash) VALUES(?,?,?,?,NULL)",
      )
      .run(cliente.name, cliente.cpf, cliente.email, cliente.phone);

  const hashes = Object.fromEntries(
    plano.fontes.map((item) => [item.arquivo, item.sha256]),
  );
  for (const unidade of plano.operacoesUnidades) {
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
         pendencia_cadastro=CASE WHEN ? THEN NULL ELSE pendencia_cadastro END,
         versao=versao+1 WHERE id=? AND versao=?`,
      )
      .run(
        unidade.depois.nome,
        unidade.depois.documento,
        unidade.depois.email,
        clienteId,
        Number(unidade.depois.limparOperacional),
        Number(unidade.depois.limparOperacional),
        Number(unidade.depois.limparOperacional),
        unidade.id,
        unidade.versao,
      );
    if (resultado.changes !== 1)
      throw new Error(`UC ${unidade.uc} mudou durante a atualização.`);
    banco
      .prepare(
        "INSERT INTO faturamento_historico(unidade_id,responsavel,acao,dados) VALUES(?,?,?,?)",
      )
      .run(
        unidade.id,
        "Cruzamento autorizado pelo usuário",
        "Cadastro de cliente atualizado pela planilha CRM",
        JSON.stringify({
          fontes_sha256: hashes,
          linha_crm: unidade.linha,
          linha_mapa_uc: unidade.linhaMapa,
          cliente_id: clienteId,
          campos_alterados: Object.keys(unidade.depois).filter(
            (campo) =>
              !["criarCpf", "limparOperacional"].includes(campo) &&
              unidade.antes[campo] !== unidade.depois[campo],
          ),
        }),
      );
  }
}

function resumo(resultado, aplicado, backupArquivo = null) {
  const tipos = {};
  for (const item of resultado.plano.pendencias)
    tipos[item.tipo] = (tipos[item.tipo] ?? 0) + 1;
  return {
    modo,
    aplicado,
    hashPlano: resultado.hashPlano,
    backup: backupArquivo,
    fontes: resultado.plano.fontes,
    clientesAtualizados: resultado.plano.atualizacoesClientes.length,
    clientesCriados: resultado.plano.novosClientes.length,
    unidadesAtualizadas: resultado.plano.operacoesUnidades.length,
    pendenciasPorTipo: tipos,
    statusIgnorados: resultado.plano.statusIgnorados,
    pendencias: resultado.plano.pendencias,
  };
}

const fontes = await carregarFontes();
for (const fonte of fontes.fontes)
  if (hashArquivo(fonte.arquivo) !== fonte.sha256)
    throw new Error("Uma planilha mudou durante a leitura.");
const leitura = new DatabaseSync(bancoArquivo, { readOnly: true });
let resultado;
try {
  resultado = planejar(leitura, fontes);
} finally {
  leitura.close();
}

let saida;
let pastaTemporaria = null;
if (modo === "dry-run") {
  saida = resumo(resultado, false);
} else {
  if (modo === "apply" && hashEsperado !== resultado.hashPlano)
    throw new Error(
      "A prévia não foi confirmada ou mudou. Use o hash retornado pelo dry-run.",
    );
  let alvo = bancoArquivo;
  let copia = null;
  if (modo === "simulate") {
    pastaTemporaria = mkdtempSync(join(tmpdir(), "ecosol-clientes-crm-"));
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
      `ecosol-antes-clientes-crm-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
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
    const atual = planejar(banco, fontes);
    if (atual.hashPlano !== resultado.hashPlano)
      throw new Error("O banco mudou depois da prévia. Operação cancelada.");
    aplicarPlano(banco, atual.plano);
    const integridade = banco.prepare("PRAGMA integrity_check").get();
    if (integridade.integrity_check !== "ok")
      throw new Error("A verificação de integridade do banco falhou.");
    if (banco.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("A verificação de chaves estrangeiras falhou.");
    banco.exec("COMMIT");
    saida = resumo(atual, true, copia);
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
