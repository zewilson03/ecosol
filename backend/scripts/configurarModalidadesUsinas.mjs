import { backup, DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { obterBanco } from "../servidor/bancoDeDados.mjs";
import {
  chaveUsina,
  modalidadeInicialDaUsina,
} from "../servidor/faturamento/vinculosUsinas.mjs";

const pastaBackend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pastaDados = resolve(
  process.env.ECOSOL_DATA_DIR || join(pastaBackend, "data"),
);
const arquivoBanco = join(pastaDados, "ecosol.db");
const pastaBackup = join(pastaDados, "backups");
mkdirSync(pastaBackup, { recursive: true });
const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
const arquivoBackup = join(pastaBackup, `ecosol-antes-usinas-${carimbo}.db`);

const origem = new DatabaseSync(arquivoBanco, { readOnly: true });
try {
  await backup(origem, arquivoBackup);
} finally {
  origem.close();
}

const banco = obterBanco();
const alvos = ["ecosol", "São Francisco", "Solar Green", "2000 Solar"];
const vigencia = "2026-10";
let inseridas = 0;
let vigencias = 0;
banco.exec("BEGIN IMMEDIATE");
try {
  for (const nome of alvos) {
    const correspondentes = banco
      .prepare("SELECT id,nome FROM usinas")
      .all()
      .filter((item) => chaveUsina(item.nome) === chaveUsina(nome));
    if (correspondentes.length > 1)
      throw new Error(`Há mais de uma usina com o nome equivalente a ${nome}.`);
    let usinaId = correspondentes[0]?.id;
    const criada = !usinaId;
    if (!usinaId) {
      usinaId = Number(
        banco
          .prepare("INSERT INTO usinas(nome,localizacao) VALUES(?,?)")
          .run(nome, "A confirmar").lastInsertRowid,
      );
      inseridas++;
    }
    const modalidade = modalidadeInicialDaUsina(nome);
    const existente = banco
      .prepare(
        "SELECT modalidade FROM usinas_modalidades WHERE usina_id=? AND inicio=?",
      )
      .get(usinaId, vigencia);
    if (existente && existente.modalidade !== modalidade)
      throw new Error(
        `A usina ${nome} já possui outra modalidade em ${vigencia}.`,
      );
    const aprovada = banco
      .prepare(
        `SELECT d.id FROM faturamento_documentos d
       JOIN faturamento_unidades u ON u.id=d.unidade_id
       WHERE u.usina_id=? AND d.status='Aprovada — aguardando emissão'
         AND d.competencia>=? AND COALESCE(json_extract(d.memoria,'$.contrato.modalidade'),'')<>?
       LIMIT 1`,
      )
      .get(usinaId, vigencia, modalidade);
    if (aprovada)
      throw new Error(
        `A modalidade de ${nome} conflita com uma fatura aprovada.`,
      );
    if (!existente) {
      banco
        .prepare(
          "INSERT INTO usinas_modalidades(usina_id,inicio,modalidade) VALUES(?,?,?)",
        )
        .run(usinaId, vigencia, modalidade);
      banco
        .prepare("UPDATE usinas SET versao=versao+1 WHERE id=?")
        .run(usinaId);
      vigencias++;
    }
    if (criada || !existente)
      banco
        .prepare(
          "INSERT INTO faturamento_historico(responsavel,acao,dados) VALUES(?,?,?)",
        )
        .run(
          "Configuração autorizada pelo usuário",
          "Classificação GDI/GDII da usina",
          JSON.stringify({
            usina_id: usinaId,
            nome,
            modalidade,
            inicio: vigencia,
          }),
        );
  }
  banco.exec("COMMIT");
  console.log(`Backup: ${arquivoBackup}`);
  console.log(
    `Usinas criadas: ${inseridas}; vigências adicionadas: ${vigencias}.`,
  );
} catch (erro) {
  banco.exec("ROLLBACK");
  console.error(
    `Nenhuma classificação foi gravada. Backup preservado: ${arquivoBackup}`,
  );
  throw erro;
} finally {
  banco.close();
}
