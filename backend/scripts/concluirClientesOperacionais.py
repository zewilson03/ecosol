"""Converte cadastros provisórios em registros operacionais de teste.

Não fabrica documentos ou e-mails. Requer a migração aditiva do servidor.
Sem --apply apenas apresenta a prévia; com --apply faz backup e transação.
"""

import argparse
import collections
import datetime as dt
import hashlib
import json
import sqlite3
from pathlib import Path

from atualizarClientesTransferidos import linhas_planilha
from concluirClientesConfirmados import planejar


MOTIVOS = {
    "uc_ausente_na_planilha": "UC não localizada na planilha de transferências",
    "documento_ausente_ou_invalido_na_fonte": "CPF/CNPJ não comprovado na linha mais recente",
    "titular_divergente_da_planilha": "Titular diverge da planilha",
    "titulares_conflitantes_para_documento": "Nomes conflitantes para o mesmo CPF/CNPJ",
    "fontes_conflitantes": "Linhas recentes conflitantes na planilha",
    "documento_divergente_do_cadastro": "Documento da planilha diverge do cadastro",
    "titular_divergente_para_mesmo_documento": "Titulares divergentes para o mesmo documento",
    "identidade_da_equipe": "Documento também consta na equipe",
    "cliente_portal_divergente": "Identidade diverge de cliente do portal",
    "vinculo_portal_ja_existente": "Vínculo com portal requer conferência",
}


def preparar(cnx, workbook):
    abas = linhas_planilha(workbook)
    prontos, pendencias = planejar(cnx, abas)
    if prontos:
        raise RuntimeError("Há UCs com identidade confirmada; conclua-as antes desta conversão")
    motivos = {}
    for chave, ucs in pendencias.items():
        if chave not in MOTIVOS:
            raise RuntimeError(f"Motivo inesperado: {chave}")
        for uc in ucs:
            if uc in motivos:
                raise RuntimeError(f"UC aparece em duas pendências: {uc}")
            motivos[uc] = MOTIVOS[chave]
    cnx.row_factory = sqlite3.Row
    unidades = cnx.execute(
        "SELECT u.id,u.uc,u.nome,u.versao,u.cliente_id,u.cliente_operacional_id,"
        "u.cliente_provisorio_id,p.nome AS nome_provisorio "
        "FROM faturamento_unidades u JOIN faturamento_clientes_provisorios p "
        "ON p.id=u.cliente_provisorio_id ORDER BY u.id"
    ).fetchall()
    if {u["uc"] for u in unidades} != set(motivos):
        raise RuntimeError("Pendências da planilha não correspondem às UCs provisórias")
    if any(u["cliente_id"] is not None or u["cliente_operacional_id"] is not None for u in unidades):
        raise RuntimeError("UC já tem outro vínculo de cliente")
    if cnx.execute(
        "SELECT 1 FROM faturamento_documentos d JOIN faturamento_unidades u "
        "ON u.id=d.unidade_id WHERE u.cliente_provisorio_id IS NOT NULL "
        "AND d.status IN ('Calculada','Aprovada — aguardando emissão') LIMIT 1"
    ).fetchone():
        raise RuntimeError("Há cobrança calculada ou aprovada para UC pendente")
    return unidades, motivos, pendencias


def aplicar(cnx, unidades, motivos, hash_fonte):
    cnx.execute("BEGIN IMMEDIATE")
    try:
        ids = {}
        for u in unidades:
            origem_id = u["cliente_provisorio_id"]
            if origem_id not in ids:
                referencia = f"TESTE-OP-{origem_id:06d}"
                existente = cnx.execute(
                    "SELECT id,nome,referencia_interna FROM faturamento_clientes_operacionais "
                    "WHERE origem_provisorio_id=?", (origem_id,)
                ).fetchone()
                if existente:
                    if existente["nome"] != u["nome_provisorio"] or existente["referencia_interna"] != referencia:
                        raise RuntimeError("Referência operacional existente diverge da origem")
                    ids[origem_id] = existente["id"]
                else:
                    ids[origem_id] = cnx.execute(
                        "INSERT INTO faturamento_clientes_operacionais"
                        "(referencia_interna,nome,origem_provisorio_id) VALUES(?,?,?)",
                        (referencia, u["nome_provisorio"], origem_id),
                    ).lastrowid
            resultado = cnx.execute(
                "UPDATE faturamento_unidades SET cliente_operacional_id=?,"
                "cliente_provisorio_id=NULL,pendencia_cadastro=?,versao=versao+1 "
                "WHERE id=? AND versao=? AND cliente_id IS NULL "
                "AND cliente_operacional_id IS NULL AND cliente_provisorio_id=?",
                (ids[origem_id], motivos[u["uc"]], u["id"], u["versao"], origem_id),
            )
            if resultado.rowcount != 1:
                raise RuntimeError("UC alterada durante a conversão; transação cancelada")
            cnx.execute(
                "INSERT INTO faturamento_historico(unidade_id,responsavel,acao,dados) "
                "VALUES(?,?,?,?)",
                (u["id"], "Conciliação cadastral de teste",
                 "Cadastro operacional criado sem documento inventado",
                 json.dumps({"origem_provisorio_id": origem_id,
                             "cliente_operacional_id": ids[origem_id],
                             "referencia_interna": f"TESTE-OP-{origem_id:06d}",
                             "motivo": motivos[u["uc"]],
                             "planilha_sha256": hash_fonte}, ensure_ascii=False)),
            )
        if cnx.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Banco inconsistente após a conversão")
        cnx.commit()
        return len(ids)
    except Exception:
        cnx.rollback()
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--workbook", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    hash_fonte = hashlib.sha256(args.workbook.read_bytes()).hexdigest()
    cnx = sqlite3.connect(args.database)
    cnx.execute("PRAGMA busy_timeout=5000")
    cnx.execute("PRAGMA foreign_keys=ON")
    colunas = {r[1] for r in cnx.execute("PRAGMA table_info(faturamento_unidades)")}
    if not {"cliente_operacional_id", "pendencia_cadastro"}.issubset(colunas):
        raise RuntimeError("Atualize o esquema pelo servidor antes da conversão")
    unidades, motivos, pendencias = preparar(cnx, args.workbook)
    if hashlib.sha256(args.workbook.read_bytes()).hexdigest() != hash_fonte:
        raise RuntimeError("Planilha alterada durante a leitura")
    resultado = {
        "unidades": len(unidades),
        "clientes_operacionais": len({u["cliente_provisorio_id"] for u in unidades}),
        "pendencias": {chave: len(ucs) for chave, ucs in pendencias.items()},
        "aplicado": False,
    }
    if args.apply and unidades:
        pasta = args.database.parent / "backups"
        pasta.mkdir(exist_ok=True)
        backup = pasta / f"ecosol-antes-clientes-operacionais-{dt.datetime.now().strftime('%Y%m%dT%H%M%S%f')}.db"
        with sqlite3.connect(backup) as copia:
            cnx.backup(copia)
        if hashlib.sha256(args.workbook.read_bytes()).hexdigest() != hash_fonte:
            raise RuntimeError("Planilha alterada antes da aplicação")
        resultado["clientes_operacionais"] = aplicar(cnx, unidades, motivos, hash_fonte)
        resultado["backup"] = str(backup)
        resultado["aplicado"] = True
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
    cnx.close()


if __name__ == "__main__":
    main()
