import { randomUUID, createHash } from "node:crypto";
import { identificarUsinaPorGeracao } from "./identificadoresUsinas.mjs";
import {
  chaveCanonicaUsina,
  modalidadeVigenteDaUsina,
  saidaDaCarteiraNaCompetencia,
  usinaDaUnidadeNaCompetencia,
} from "./vinculosUsinas.mjs";

const ucCanonica = (valor) =>
  String(valor ?? "")
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "");

export function preencherDadosPorGeradora(banco, extracao, dados = {}) {
  let identificacao = identificarUsinaPorGeracao(
    banco,
    extracao?.dados?.uc_geradora,
  );
  // Regra operacional confirmada: PDF Equatorial sem conteúdo na área SCEE
  // pertence à São Francisco. É mantida separada da identificação por UC
  // geradora para deixar a origem rastreável e não inventar um identificador.
  if (
    identificacao.situacao === "ausente" &&
    extracao?.sinalizadores?.mensagens_scee_vazias
  ) {
    const candidatas = banco
      .prepare("SELECT id,nome FROM usinas ORDER BY id")
      .all()
      .filter((usina) => chaveCanonicaUsina(usina.nome) === "saofrancisco");
    identificacao = {
      numero: null,
      situacao:
        candidatas.length === 1
          ? "identificada"
          : candidatas.length > 1
            ? "ambigua"
            : "sem_correspondencia",
      usina: candidatas.length === 1 ? candidatas[0] : null,
      candidatas,
      origem: "mensagens_scee_vazias",
    };
  }
  const competencia = String(
    extracao?.dados?.competencia ?? dados.competencia ?? "",
  );
  const uc = ucCanonica(extracao?.dados?.uc ?? dados.uc);
  const unidade = uc
    ? banco
        .prepare(
          `SELECT * FROM faturamento_unidades
           WHERE uc=? OR id=(SELECT unidade_id FROM faturamento_unidades_aliases WHERE uc=?)`,
        )
        .get(uc, uc)
    : null;
  if (identificacao.situacao !== "identificada")
    return { dados: { ...dados }, identificacao, unidade, modalidade: null };
  const modalidade = competencia
    ? modalidadeVigenteDaUsina(banco, identificacao.usina.id, competencia)
    : null;
  const novos = {
    ...dados,
    ...(uc ? { uc } : {}),
    ...(competencia ? { competencia } : {}),
    ...(extracao?.dados?.injecao !== undefined
      ? { injecao: extracao.dados.injecao }
      : {}),
    ...(identificacao.origem === "mensagens_scee_vazias"
      ? { injecao: "0", ajuste_gdii: "0", desconto: "0" }
      : {}),
    ...(modalidade ? { modalidade: modalidade.modalidade } : {}),
    ...(modalidade?.modalidade === "GDI"
      ? { ajuste_gdii: "0" }
      : extracao?.dados?.ajuste_gdii !== undefined
        ? { ajuste_gdii: extracao.dados.ajuste_gdii }
        : {}),
    ...(unidade
      ? {
          unidade_id: unidade.id,
          ...(unidade.cliente_id ? { cliente_id: unidade.cliente_id } : {}),
        }
      : {}),
  };
  return { dados: novos, identificacao, unidade, modalidade };
}

export function sincronizarVinculoDaGeradora(
  banco,
  { unidade, identificacao, competencia },
) {
  if (
    !unidade ||
    identificacao?.situacao !== "identificada" ||
    !/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(competencia)
  )
    return { alterado: false, motivo: "dados_insuficientes" };
  const unidadeAtual = banco
    .prepare("SELECT * FROM faturamento_unidades WHERE id=?")
    .get(unidade.id);
  if (!unidadeAtual) return { alterado: false, motivo: "unidade_ausente" };
  if (saidaDaCarteiraNaCompetencia(banco, unidadeAtual.id, competencia))
    return { alterado: false, motivo: "fora_da_carteira" };
  const destinoId = identificacao.usina.id;
  const vigenteAntes = usinaDaUnidadeNaCompetencia(
    banco,
    unidadeAtual.id,
    competencia,
  );
  const existente = banco
    .prepare(
      "SELECT id,usina_id FROM faturamento_vinculos_usina WHERE unidade_id=? AND inicio=?",
    )
    .get(unidadeAtual.id, competencia);
  if (existente?.usina_id === destinoId && unidadeAtual.usina_id === destinoId)
    return { alterado: false, motivo: "ja_vinculada", usina_id: destinoId };

  const operacao = randomUUID();
  if (existente)
    banco
      .prepare(
        `UPDATE faturamento_vinculos_usina
         SET usina_id=?,origem_usina_id=?,transferencia_id=? WHERE id=?`,
      )
      .run(destinoId, existente.usina_id, operacao, existente.id);
  else
    banco
      .prepare(
        `INSERT INTO faturamento_vinculos_usina
         (unidade_id,inicio,usina_id,origem_usina_id,transferencia_id)
         VALUES(?,?,?,?,?)`,
      )
      .run(unidadeAtual.id, competencia, destinoId, vigenteAntes, operacao);

  const ultima = banco
    .prepare(
      "SELECT MAX(inicio) inicio FROM faturamento_vinculos_usina WHERE unidade_id=?",
    )
    .get(unidadeAtual.id)?.inicio;
  if (ultima === competencia && unidadeAtual.usina_id !== destinoId)
    banco
      .prepare(
        "UPDATE faturamento_unidades SET usina_id=?,versao=versao+1 WHERE id=?",
      )
      .run(destinoId, unidadeAtual.id);

  const resultado = {
    quantidade: 1,
    origem_usina_id: vigenteAntes,
    destino_usina_id: destinoId,
    competencias: [{ id: unidadeAtual.id, inicio: competencia }],
    origem: "UC geradora da fatura",
  };
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(resultado))
    .digest("hex");
  banco
    .prepare(
      `INSERT INTO faturamento_transferencias_usina(id,payload_hash,resultado)
       VALUES(?,?,?)`,
    )
    .run(operacao, payloadHash, JSON.stringify(resultado));
  return {
    alterado: true,
    operacao,
    origem_usina_id: vigenteAntes,
    usina_id: destinoId,
  };
}
