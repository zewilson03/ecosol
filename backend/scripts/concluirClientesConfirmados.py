"""Conclui vínculos cliente/UC confirmados na planilha de transferências.

Sem --apply apenas exibe a prévia. Não cria senhas nem envia e-mails.
"""

import argparse
import collections
import datetime as dt
import hashlib
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

from atualizarClientesTransferidos import digitos, linhas_planilha
from vincularClientesPorPlanilhasUsinas import nome_valido


def cpf_valido(cpf):
    if not re.fullmatch(r"\d{11}", cpf or "") or len(set(cpf)) == 1:
        return False
    for tamanho in (9, 10):
        verificador = sum(int(cpf[i]) * (tamanho + 1 - i) for i in range(tamanho)) * 10 % 11
        if (0 if verificador == 10 else verificador) != int(cpf[tamanho]):
            return False
    return True


def nome_comparavel(valor):
    nome = nome_valido(valor) or ""
    texto = unicodedata.normalize("NFKD", nome.casefold())
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", texto)


def cnpj_valido(cnpj):
    if not re.fullmatch(r"\d{14}", cnpj or "") or len(set(cnpj)) == 1:
        return False
    for tamanho, pesos in (
        (12, (5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2)),
        (13, (6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2)),
    ):
        resto = sum(int(cnpj[i]) * peso for i, peso in enumerate(pesos)) % 11
        if int(cnpj[tamanho]) != (0 if resto < 2 else 11 - resto):
            return False
    return True


PADRAO_DOCUMENTO = re.compile(
    r"(?<!\d)(?:\d{3}[. ]?\d{3}[. ]?\d{3}[-. ]?\d{2}|"
    r"\d{2}[. ]?\d{3}[. ]?\d{3}[/.-]?\d{4}[-. ]?\d{2})(?!\d)"
)


def documento_na_celula(valor):
    documentos = {digitos(trecho) for trecho in PADRAO_DOCUMENTO.findall(str(valor or ""))}
    validos = {d for d in documentos if cpf_valido(d) or cnpj_valido(d)}
    return next(iter(validos)) if len(validos) == 1 else None


def evidencia_recente(abas, uc):
    opcoes = [(item, indice, aba) for itens, indice, aba in (
        (abas[0].get(uc, []), 4, "TRANSFERIDAS - GO"),
        (abas[1].get(uc, []), 2, "MUDARAM DE USINA"),
    ) for item in itens]
    if not opcoes:
        return None, "uc_ausente_na_planilha"
    recente = max(item[0][0] for item in opcoes)
    atuais = [item for item in opcoes if item[0][0] == recente]
    documentos = {documento_na_celula(item[0][2][item[1]]) for item in atuais}
    nomes = {nome_comparavel(item[0][2][item[1]]) for item in atuais}
    if len(documentos) != 1 or len(nomes) != 1:
        return None, "fontes_conflitantes"
    linha, indice, aba = max(atuais, key=lambda item: item[0][1])
    documento = documento_na_celula(linha[2][indice])
    if not documento:
        return None, "documento_ausente_ou_invalido_na_fonte"
    return {"documento": documento, "nome": nome_comparavel(linha[2][indice]),
            "aba": aba, "linha": linha[1]}, None


def planejar(cnx, abas):
    cnx.row_factory = sqlite3.Row
    todas = cnx.execute(
        "SELECT u.*, p.nome AS nome_provisorio FROM faturamento_unidades u "
        "LEFT JOIN faturamento_clientes_provisorios p ON p.id=u.cliente_provisorio_id "
        "WHERE u.cliente_provisorio_id IS NOT NULL ORDER BY u.id"
    ).fetchall()
    clientes = {r["cpf"]: r for r in cnx.execute("SELECT * FROM customers")}
    cpfs_equipe = {r["cpf"] for r in cnx.execute("SELECT cpf FROM staff_users WHERE cpf IS NOT NULL")}
    grupos = collections.defaultdict(list)
    nomes_por_documento = collections.defaultdict(set)
    pendencias = collections.defaultdict(list)
    for u in todas:
        evidencia, erro = evidencia_recente(abas, digitos(u["uc"]))
        if erro:
            pendencias[erro].append(u["uc"])
            continue
        documento = evidencia["documento"]
        if u["documento"] and digitos(u["documento"]) != documento:
            pendencias["documento_divergente_do_cadastro"].append(u["uc"])
            continue
        nomes_por_documento[documento].add(nome_comparavel(u["nome"]))
        nomes_por_documento[documento].add(evidencia["nome"])
        if not evidencia["nome"] or evidencia["nome"] != nome_comparavel(u["nome"]):
            pendencias["titular_divergente_da_planilha"].append(u["uc"])
            continue
        grupos[documento].append((u, evidencia))
    prontos = []
    for documento, itens in grupos.items():
        unidades = [u for u, _ in itens]
        if len(nomes_por_documento[documento]) != 1 or not all(nomes_por_documento[documento]):
            pendencias["titulares_conflitantes_para_documento"].extend(u["uc"] for u in unidades)
            continue
        nomes = {nome_comparavel(u["nome"]) for u in unidades}
        nomes_provisorios = {nome_comparavel(u["nome_provisorio"]) for u in unidades}
        if not all(nomes) or len(nomes) != 1 or nomes != nomes_provisorios:
            pendencias["titular_divergente_para_mesmo_documento"].extend(u["uc"] for u in unidades)
            continue
        if documento in cpfs_equipe:
            pendencias["identidade_da_equipe"].extend(u["uc"] for u in unidades)
            continue
        existente = clientes.get(documento)
        if existente and nome_comparavel(existente["name"]) not in nomes:
            pendencias["cliente_portal_divergente"].extend(u["uc"] for u in unidades)
            continue
        if any(u["cliente_id"] is not None for u in unidades):
            pendencias["vinculo_portal_ja_existente"].extend(u["uc"] for u in unidades)
            continue
        prontos.append((documento, nome_valido(unidades[0]["nome"]), itens, existente))
    return prontos, pendencias


def aplicar(cnx, prontos, hash_fonte):
    cnx.execute("BEGIN IMMEDIATE")
    try:
        for documento, nome, itens, existente in prontos:
            cliente_id = existente["id"] if existente else cnx.execute(
                "INSERT INTO customers(name,cpf,email,password_hash) VALUES (?,?,?,NULL)",
                (nome, documento, ""),
            ).lastrowid
            for u, evidencia in itens:
                atualizacao = cnx.execute(
                    "UPDATE faturamento_unidades SET documento=?,cliente_id=?,cliente_provisorio_id=NULL,versao=versao+1 "
                    "WHERE id=? AND versao=? AND cliente_id IS NULL AND cliente_provisorio_id=?",
                    (documento, cliente_id, u["id"], u["versao"], u["cliente_provisorio_id"]),
                )
                if atualizacao.rowcount != 1:
                    raise RuntimeError("UC mudou durante a conclusão cadastral; tudo foi cancelado")
                cnx.execute(
                    "INSERT INTO faturamento_historico(unidade_id,responsavel,acao,dados) VALUES (?,?,?,?)",
                    (
                        u["id"], "conciliação cadastral",
                        "Cadastro financeiro vinculado a cliente inativo do portal",
                        json.dumps({"cliente_id": cliente_id, "origem": "documento e titular confirmados; acesso não ativado",
                                    "planilha_sha256": hash_fonte, "aba": evidencia["aba"], "linha": evidencia["linha"]}, ensure_ascii=False),
                    ),
                )
        if cnx.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Banco inconsistente após a conclusão cadastral")
        cnx.commit()
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
    abas = linhas_planilha(args.workbook)
    if hashlib.sha256(args.workbook.read_bytes()).hexdigest() != hash_fonte:
        raise RuntimeError("Planilha alterada durante a leitura; operação cancelada")
    cnx = sqlite3.connect(args.database)
    prontos, pendencias = planejar(cnx, abas)
    resultado = {
        "clientes_prontos": len(prontos),
        "clientes_novos": sum(existente is None for *_, existente in prontos),
        "ucs_prontas": sum(len(itens) for _, _, itens, _ in prontos),
        "por_tipo": {tipo: sum(len(itens) for documento, _, itens, _ in prontos if len(documento) == tamanho)
                     for tipo, tamanho in (("cpf", 11), ("cnpj", 14))},
        "pendencias": {nome: {"quantidade": len(ucs), "ucs": sorted(ucs)} for nome, ucs in pendencias.items()},
        "aplicado": False,
    }
    if args.apply:
        pasta = args.database.parent / "backups"
        pasta.mkdir(exist_ok=True)
        backup = pasta / f"ecosol-antes-concluir-clientes-{dt.datetime.now().strftime('%Y%m%dT%H%M%S%f')}.db"
        with sqlite3.connect(backup) as copia:
            cnx.backup(copia)
        if hashlib.sha256(args.workbook.read_bytes()).hexdigest() != hash_fonte:
            raise RuntimeError("Planilha alterada antes da aplicação; operação cancelada")
        aplicar(cnx, prontos, hash_fonte)
        resultado["backup"] = str(backup)
        resultado["aplicado"] = True
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
    cnx.close()


if __name__ == "__main__":
    main()
