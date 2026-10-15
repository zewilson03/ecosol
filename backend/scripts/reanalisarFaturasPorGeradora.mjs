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
    `SELECT id,nome,pdf,hash,texto,extracao,dados,status,memoria,versao
     FROM faturamento_documentos
     WHERE classificacao='fatura' AND excluido_em IS NULL ORDER BY id`,
  )
  .all();
const leituras = [];
for (const documento of documentos) {
  const hash = createHash("sha256").update(documento.pdf).digest("hex");
  if (hash !== documento.hash) {
    leituras.push({ documento, erro: "integridade" });
    continue;
  }
  try {
    const extracao = await lerPdf(Buffer.from(documento.pdf));
    const anteriores = JSON.parse(documento.dados);
    const base = {
      ...extracao.dados,
      origem_tarifa: anteriores.origem_tarifa ?? "propria",
      ...anteriores,
    };
    const preenchimento = preencherDadosPorGeradora(banco, extracao, base);
    leituras.push({ documento, extracao, preenchimento });
  } catch {
    leituras.push({ documento, erro: "leitura" });
  }
}

const resumo = {
  total: documentos.length,
  identificadas: 0,
  sem_correspondencia: 0,
  ambiguas: 0,
  sem_identificador: 0,
  protegidas: 0,
  atualizadas: 0,
  vinculos_atualizados: 0,
  atualizacoes_previstas: 0,
  vinculos_previstos: 0,
  falhas: [],
  pendencias: [],
};
for (const item of leituras) {
  if (item.erro) {
    resumo.falhas.push({ id: item.documento.id, nome: item.documento.nome, erro: item.erro });
    continue;
  }
  const situacao = item.preenchimento.identificacao.situacao;
  if (situacao === "identificada") resumo.identificadas++;
  else if (situacao === "sem_correspondencia") resumo.sem_correspondencia++;
  else if (situacao === "ambigua") resumo.ambiguas++;
  else resumo.sem_identificador++;
  if (situacao !== "identificada")
    resumo.pendencias.push({
      id: item.documento.id,
      nome: item.documento.nome,
      situacao,
      identificador: item.preenchimento.identificacao.numero,
    });
  if (item.documento.status !== "Pendente de revisão" || item.documento.memoria !== null)
    resumo.protegidas++;
  else {
    const mudariaDocumento =
      item.documento.texto !== item.extracao.texto ||
      item.documento.extracao !== JSON.stringify(item.extracao) ||
      item.documento.dados !== JSON.stringify(item.preenchimento.dados);
    if (mudariaDocumento) resumo.atualizacoes_previstas++;
    const unidade = item.preenchimento.unidade;
    const usina = item.preenchimento.identificacao.usina;
    const competencia = item.preenchimento.dados.competencia;
    if (unidade && usina && competencia) {
      const vigente = banco
        .prepare(
          `SELECT usina_id FROM faturamento_vinculos_usina
           WHERE unidade_id=? AND inicio<=? ORDER BY inicio DESC LIMIT 1`,
        )
        .get(unidade.id, competencia)?.usina_id ?? unidade.usina_id;
      if (vigente !== usina.id) resumo.vinculos_previstos++;
    }
  }
}

if (confirmar) {
  const pasta = resolve("backend/data/backups");
  mkdirSync(pasta, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[-:.]/g, "");
  const backup = resolve(pasta, `ecosol-antes-reanalise-geradoras-${carimbo}.db`);
  if (existsSync(backup)) throw new Error("O arquivo de backup já existe.");
  banco.prepare("VACUUM INTO ?").run(backup);
  resumo.backup = backup;
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
    for (const item of leituras) {
      if (
        item.erro ||
        item.documento.status !== "Pendente de revisão" ||
        item.documento.memoria !== null
      )
        continue;
      const { documento, extracao, preenchimento } = item;
      const vinculo = sincronizarVinculoDaGeradora(banco, {
        ...preenchimento,
        competencia: preenchimento.dados.competencia,
      });
      const alterado =
        documento.texto !== extracao.texto ||
        documento.extracao !== JSON.stringify(extracao) ||
        documento.dados !== JSON.stringify(preenchimento.dados);
      if (alterado) {
        const gravacao = atualizar.run(
          extracao.texto,
          JSON.stringify(extracao),
          JSON.stringify(preenchimento.dados),
          documento.id,
          documento.versao,
        );
        if (gravacao.changes !== 1)
          throw new Error(`A fatura #${documento.id} mudou durante a reanálise.`);
        resumo.atualizadas++;
      }
      if (vinculo.alterado) resumo.vinculos_atualizados++;
      if (alterado || vinculo.alterado)
        auditar.run(
          documento.id,
          preenchimento.unidade?.id ?? null,
          "Reanálise automática pela UC geradora",
          "Identificação de usina pela Geração Ciclo",
          JSON.stringify({
            identificador_geracao: preenchimento.identificacao.numero,
            situacao: preenchimento.identificacao.situacao,
            usina: preenchimento.identificacao.usina?.nome ?? null,
            competencia: preenchimento.dados.competencia ?? null,
            injecao: preenchimento.dados.injecao ?? null,
            modalidade: preenchimento.dados.modalidade ?? null,
            vinculo,
          }),
        );
    }
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

console.log(JSON.stringify({ modo: confirmar ? "confirmado" : "previa", ...resumo }, null, 2));
