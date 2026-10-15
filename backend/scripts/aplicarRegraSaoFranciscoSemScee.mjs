import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { obterBanco } from "../servidor/bancoDeDados.mjs";
import { lerPdf } from "../servidor/faturamento/extracao.mjs";
import {
  preencherDadosPorGeradora,
  sincronizarVinculoDaGeradora,
} from "../servidor/faturamento/preenchimentoPorGeradora.mjs";

const confirmar = process.argv.includes("--confirmar");
const banco = obterBanco();
const documentos = banco
  .prepare(
    `SELECT id,nome,pdf,hash,dados,status,memoria,versao
     FROM faturamento_documentos
     WHERE classificacao='fatura' AND finalidade='cobranca'
       AND excluido_em IS NULL AND status='Pendente de revisão' AND memoria IS NULL
     ORDER BY id`,
  )
  .all();

const candidatos = [];
for (const documento of documentos) {
  if (createHash("sha256").update(documento.pdf).digest("hex") !== documento.hash)
    throw new Error(`Integridade inválida no PDF #${documento.id}.`);
  const extracao = await lerPdf(Buffer.from(documento.pdf));
  if (!extracao.sinalizadores?.mensagens_scee_vazias) continue;
  const anteriores = JSON.parse(documento.dados);
  const preenchimento = preencherDadosPorGeradora(banco, extracao, {
    ...extracao.dados,
    origem_tarifa: anteriores.origem_tarifa ?? "propria",
    ...anteriores,
  });
  if (
    preenchimento.identificacao.situacao !== "identificada" ||
    preenchimento.identificacao.origem !== "mensagens_scee_vazias"
  )
    throw new Error(
      `A regra São Francisco não encontrou uma usina única para #${documento.id}.`,
    );
  candidatos.push({ documento, extracao, preenchimento });
}

const resumo = {
  modo: confirmar ? "confirmado" : "previa",
  regra: "mensagens_scee_vazias → São Francisco, 0 kWh, sem desconto",
  examinadas: documentos.length,
  candidatas: candidatos.map(({ documento, preenchimento }) => ({
    id: documento.id,
    nome: documento.nome,
    uc: preenchimento.dados.uc ?? null,
    competencia: preenchimento.dados.competencia ?? null,
    total_equatorial: preenchimento.dados.total_equatorial ?? null,
    modalidade: preenchimento.dados.modalidade ?? null,
    injecao: preenchimento.dados.injecao ?? null,
    ajuste_gdii: preenchimento.dados.ajuste_gdii ?? null,
  })),
  atualizadas: 0,
  vinculos_atualizados: 0,
};

if (confirmar && candidatos.length) {
  const pasta = resolve("backend/data/backups");
  mkdirSync(pasta, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[-:.]/g, "");
  const arquivoBackup = resolve(
    pasta,
    `ecosol-antes-regra-sao-francisco-sem-scee-${carimbo}.db`,
  );
  if (existsSync(arquivoBackup)) throw new Error("O arquivo de backup já existe.");
  banco.prepare("VACUUM INTO ?").run(arquivoBackup);
  resumo.backup = arquivoBackup;

  banco.exec("BEGIN IMMEDIATE");
  try {
    const atualizar = banco.prepare(
      `UPDATE faturamento_documentos
       SET texto=?,extracao=?,dados=?,versao=versao+1,atualizado_em=CURRENT_TIMESTAMP
       WHERE id=? AND versao=? AND status='Pendente de revisão' AND memoria IS NULL`,
    );
    const auditar = banco.prepare(
      `INSERT INTO faturamento_historico
       (documento_id,unidade_id,responsavel,acao,dados) VALUES(?,?,?,?,?)`,
    );
    for (const { documento, extracao, preenchimento } of candidatos) {
      const gravacao = atualizar.run(
        extracao.texto,
        JSON.stringify(extracao),
        JSON.stringify(preenchimento.dados),
        documento.id,
        documento.versao,
      );
      if (gravacao.changes !== 1)
        throw new Error(`A fatura #${documento.id} mudou durante a atualização.`);
      const vinculo = sincronizarVinculoDaGeradora(banco, {
        ...preenchimento,
        competencia: preenchimento.dados.competencia,
      });
      auditar.run(
        documento.id,
        preenchimento.unidade?.id ?? null,
        "Regra operacional São Francisco",
        "Mensagens SCEE vazias: cobrança somente pelo total Equatorial",
        JSON.stringify({
          usina: preenchimento.identificacao.usina.nome,
          competencia: preenchimento.dados.competencia,
          injecao: "0",
          ajuste_gdii: "0",
          desconto_aplicavel: "0",
          vinculo,
        }),
      );
      resumo.atualizadas++;
      if (vinculo.alterado) resumo.vinculos_atualizados++;
    }
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

console.log(JSON.stringify(resumo, null, 2));
