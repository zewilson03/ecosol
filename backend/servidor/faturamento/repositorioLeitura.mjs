import { chaveUsina } from "./vinculosUsinas.mjs";
import { normalizarIdentificadorGeracao } from "./identificadoresUsinas.mjs";

const colunasDocumento =
  "id, hash, nome, lote, extracao, dados, memoria, unidade_id, competencia, status, classificacao, finalidade, versao, criado_em, atualizado_em";

function agrupar(linhas, chave) {
  const grupos = new Map();
  for (const linha of linhas) {
    const valor = linha[chave];
    const itens = grupos.get(valor) ?? [];
    itens.push(linha);
    grupos.set(valor, itens);
  }
  return grupos;
}

/**
 * Leitura otimizada para a visão administrativa de UCs.
 *
 * O formato retornado é deliberadamente igual ao contrato HTTP legado. As
 * associações são carregadas em lote para que o custo permaneça constante em
 * quantidade de consultas, mesmo quando a carteira cresce.
 */
export function criarRepositorioLeituraFaturamento(banco) {
  function listarDocumentosResumo({ limite, cursor } = {}) {
    const paginada = Number.isSafeInteger(limite) && limite > 0;
    const limiteSeguro = paginada ? Math.min(limite, 200) : null;
    const cursorSeguro =
      Number.isSafeInteger(cursor) && cursor > 0
        ? cursor
        : Number.MAX_SAFE_INTEGER;
    const documentos = banco
      .prepare(
        `SELECT ${colunasDocumento}
         FROM faturamento_documentos
         WHERE classificacao='fatura' AND finalidade='cobranca'
           AND excluido_em IS NULL ${paginada ? "AND id<?" : ""}
         ORDER BY id DESC ${paginada ? "LIMIT ?" : ""}`,
      )
      .all(...(paginada ? [cursorSeguro, limiteSeguro + 1] : []));
    const possuiMais = paginada && documentos.length > limiteSeguro;
    const pagina = possuiMais ? documentos.slice(0, limiteSeguro) : documentos;
    const identificadores = agrupar(
      banco
        .prepare(
          `SELECT i.numero,s.id,s.nome
           FROM usinas_identificadores_geracao i
           JOIN usinas s ON s.id=i.usina_id
           ORDER BY i.numero,s.nome,s.id`,
        )
        .all(),
      "numero",
    );

    const enderecos = new Map(
      banco
        .prepare(
          "SELECT documento_id,situacao,unidade_id,cliente_id FROM faturamento_enderecos_faturas",
        )
        .all()
        .map(({ documento_id, ...vinculo }) => [documento_id, vinculo]),
    );

    const itens = pagina.map((documento) => {
      const dados = JSON.parse(documento.dados);
      const extracao = JSON.parse(documento.extracao);
      const numero = normalizarIdentificadorGeracao(
        dados.uc_geradora ?? extracao.dados?.uc_geradora,
      );
      const candidatas = numero
        ? (identificadores.get(numero) ?? []).map(({ id, nome }) => ({
            id,
            nome,
          }))
        : [];
      return {
        ...documento,
        dados,
        extracao,
        endereco_vinculo: enderecos.get(documento.id) ?? null,
        memoria: documento.memoria ? JSON.parse(documento.memoria) : null,
        usina_geradora: {
          numero: numero || null,
          situacao: !numero
            ? "ausente"
            : candidatas.length === 1
              ? "identificada"
              : candidatas.length > 1
                ? "ambigua"
                : "sem_correspondencia",
          usina: candidatas.length === 1 ? candidatas[0] : null,
          candidatas,
        },
      };
    });
    return {
      itens,
      proximoCursor: possuiMais ? itens.at(-1)?.id : null,
    };
  }

  function listarUnidadesDetalhadas() {
    const unidades = banco
      .prepare(
        "SELECT u.*, s.nome AS usina_nome, COALESCE(c.name,o.nome,p.nome) AS cliente_nome, o.referencia_interna AS cliente_referencia_interna, (SELECT json_object('inicio',sc.inicio,'destino_externo',sc.destino_externo) FROM faturamento_saidas_carteira sc WHERE sc.unidade_id=u.id ORDER BY sc.inicio DESC LIMIT 1) AS saida_carteira FROM faturamento_unidades u LEFT JOIN usinas s ON s.id=u.usina_id LEFT JOIN customers c ON c.id=u.cliente_id LEFT JOIN faturamento_clientes_operacionais o ON o.id=u.cliente_operacional_id LEFT JOIN faturamento_clientes_provisorios p ON p.id=u.cliente_provisorio_id ORDER BY u.nome, u.uc",
      )
      .all();

    if (!unidades.length) return [];

    const aliases = agrupar(
      banco
        .prepare(
          `SELECT a.unidade_id,a.uc
           FROM faturamento_unidades_aliases a
           JOIN faturamento_unidades u ON u.id=a.unidade_id
           ORDER BY a.unidade_id,a.id DESC`,
        )
        .all(),
      "unidade_id",
    );
    const vinculos = agrupar(
      banco
        .prepare(
          `SELECT v.unidade_id,v.inicio,v.usina_id,s.nome AS usina_nome
           FROM faturamento_vinculos_usina v
           JOIN faturamento_unidades u ON u.id=v.unidade_id
           JOIN usinas s ON s.id=v.usina_id
           ORDER BY v.unidade_id,v.inicio DESC`,
        )
        .all(),
      "unidade_id",
    );
    const descontos = agrupar(
      banco
        .prepare(
          `SELECT d.id,d.unidade_id,d.inicio,d.desconto
           FROM faturamento_descontos_uc d
           JOIN faturamento_unidades u ON u.id=d.unidade_id
           ORDER BY d.unidade_id,d.inicio DESC`,
        )
        .all(),
      "unidade_id",
    );
    const contratos = agrupar(
      banco
        .prepare(
          `SELECT c.*
           FROM faturamento_contratos c
           JOIN faturamento_unidades u ON u.id=c.unidade_id
           ORDER BY c.unidade_id,c.inicio DESC`,
        )
        .all(),
      "unidade_id",
    );
    const modalidades = agrupar(
      banco
        .prepare(
          `SELECT m.usina_id,m.inicio,m.modalidade
           FROM usinas_modalidades m
           JOIN usinas s ON s.id=m.usina_id
           ORDER BY m.usina_id,m.inicio DESC`,
        )
        .all(),
      "usina_id",
    );

    return unidades.map((unidade) => {
      const vinculosDaUnidade = [...(vinculos.get(unidade.id) ?? [])];
      if (!vinculosDaUnidade.length && unidade.usina_id !== null) {
        vinculosDaUnidade.push({
          unidade_id: unidade.id,
          inicio: "0000-01",
          usina_id: unidade.usina_id,
          usina_nome: unidade.usina_nome,
        });
      }

      return {
        ...unidade,
        saida_carteira: unidade.saida_carteira
          ? JSON.parse(unidade.saida_carteira)
          : null,
        ucs_antigas: (aliases.get(unidade.id) ?? []).map((item) => item.uc),
        vinculos_usina: vinculosDaUnidade.map((vinculo) => ({
          inicio: vinculo.inicio,
          usina_id: vinculo.usina_id,
          usina_nome: vinculo.usina_nome,
          modalidades:
            chaveUsina(vinculo.usina_nome) === "ecosol"
              ? []
              : (modalidades.get(vinculo.usina_id) ?? []).map(
                  ({ inicio, modalidade }) => ({ inicio, modalidade }),
                ),
        })),
        descontos: (descontos.get(unidade.id) ?? []).map(
          ({ id, inicio, desconto }) => ({ id, inicio, desconto }),
        ),
        contratos: contratos.get(unidade.id) ?? [],
        modalidades_usina:
          unidade.usina_id === null ||
          chaveUsina(unidade.usina_nome) === "ecosol"
            ? []
            : (modalidades.get(unidade.usina_id) ?? []).map(
                ({ inicio, modalidade }) => ({ inicio, modalidade }),
              ),
      };
    });
  }

  return { listarDocumentosResumo, listarUnidadesDetalhadas };
}
