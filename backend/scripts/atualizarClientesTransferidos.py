"""Concilia, com prévia obrigatória, UCs existentes com as duas abas GO.

Executar com o Python que disponibiliza openpyxl. Sem --apply, nada é gravado.
"""

import argparse
import collections
import datetime as dt
import hashlib
import json
import re
import sqlite3
from pathlib import Path

import openpyxl


def digitos(valor):
    if isinstance(valor, float) and valor.is_integer():
        valor = int(valor)
    return re.sub(r"\D", "", str(valor or ""))


def cpf_valido(cpf):
    if len(cpf) != 11 or len(set(cpf)) == 1:
        return False
    for tamanho in (9, 10):
        verificador = sum(int(cpf[i]) * (tamanho + 1 - i) for i in range(tamanho)) * 10 % 11
        if (0 if verificador == 10 else verificador) != int(cpf[tamanho]):
            return False
    return True


def cpf_no_nome(nome):
    candidatos = {
        digitos(parte)
        for parte in re.findall(r"(?<!\d)(?:\d[. -]?){11}(?!\d)", str(nome or ""))
    }
    validos = [cpf for cpf in candidatos if cpf_valido(cpf)]
    return validos[0] if len(validos) == 1 else None


def email_valido(valor):
    email = str(valor or "").strip().lower()
    return email if re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) else None


def destino_id(nome):
    chave = re.sub(r"\s+", " ", str(nome or "").strip().upper())
    return {
        "ROYER": 9,
        "CONSORCIO RBR ENERGIA": 9,
        "SAN GERMAN": 6,
        "SOLARGREEN": 3,
        "SOLAR GREEN": 3,
        "2000 SOLAR": 4,
    }.get(chave)


def linhas_planilha(caminho):
    livro = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    saida = [collections.defaultdict(list), collections.defaultdict(list)]
    for aba, indice_uc, indice_data in ((0, 3, 8), (1, 1, 6)):
        for numero, linha in enumerate(livro.worksheets[aba].iter_rows(min_row=2, values_only=True), 2):
            uc = digitos(linha[indice_uc])
            if len(uc) < 11 or len(uc) > 13:
                continue
            data = linha[indice_data]
            if not isinstance(data, dt.datetime):
                continue
            saida[aba][uc].append((data, numero, linha))
    livro.close()
    return saida


def ultima(linhas):
    if not linhas:
        return None, False
    recente = max(item[0] for item in linhas)
    mesma_data = [item for item in linhas if item[0] == recente]
    indice_usina = 0 if len(mesma_data[0][2]) == 18 else 5
    conflito = len({str(item[2][indice_usina]).strip().upper() for item in mesma_data}) > 1
    return max(mesma_data, key=lambda item: item[1]), conflito


def preparar(cnx, abas, mensais=None):
    unidades = {
        digitos(row["uc"]): row
        for row in cnx.execute("SELECT * FROM faturamento_unidades")
    }
    usinas = {row["id"]: row["nome"] for row in cnx.execute("SELECT id,nome FROM usinas")}
    for codigo, nome in ((9, "ROYER"), (6, "SAN GERMAN"), (3, "Solar Green"), (4, "2000 Solar")):
        if usinas.get(codigo) != nome:
            raise RuntimeError(f"Cadastro da usina {nome} mudou; revisar mapeamento antes de importar")
    historicos = {
        row["unidade_id"]: row
        for row in cnx.execute(
            "SELECT * FROM faturamento_vinculos_usina WHERE inicio='2026-10'"
        )
    }
    updates = []
    plant_updates = []
    pendencias = collections.defaultdict(list)
    for uc, unidade in unidades.items():
        primeira, conflito1 = ultima(abas[0].get(uc, []))
        segunda, conflito2 = ultima(abas[1].get(uc, []))
        if conflito1 or conflito2:
            pendencias["mesma_data_destinos_diferentes"].append(uc)
            continue
        if primeira:
            _, linha_numero, linha = primeira
            cpf = cpf_no_nome(linha[4])
            email = email_valido(linha[14])
            campos = {}
            fontes = {}
            if cpf and not unidade["documento"]:
                campos["documento"] = cpf
                fontes["documento"] = ["TRANSFERIDAS - GO", linha_numero]
            elif cpf and digitos(unidade["documento"]) != cpf:
                pendencias["cpf_divergente"].append(uc)
            if email and not unidade["email"]:
                campos["email"] = email
                fontes["email"] = ["TRANSFERIDAS - GO", linha_numero]
            elif email and unidade["email"] and unidade["email"].lower() != email:
                pendencias["email_divergente"].append(uc)
        else:
            campos = {}
            fontes = {}
        # A segunda aba pode conter um CPF mais novo para uma UC sem documento.
        if segunda and (not primeira or segunda[0] >= primeira[0]):
            cpf = cpf_no_nome(segunda[2][2])
            if cpf and not unidade["documento"]:
                campos["documento"] = cpf
                fontes["documento"] = ["MUDARAM DE USINA", segunda[1]]
        if campos:
            updates.append((unidade, campos, fontes))
        if not segunda:
            continue
        data, linha_numero, linha = segunda
        destino = destino_id(linha[5])
        if destino is None and str(linha[5] or "").strip().upper() == "ECOSOL" and mensais is not None:
            por_mes = mensais.get(uc.lstrip("0"), {})
            outubro = {item["usina"] for item in por_mes.get("2026-10", [])}
            if len(outubro) > 1:
                pendencias["outubro_com_mais_de_uma_usina"].append(uc)
                continue
            if outubro:
                nome = next(iter(outubro))
                destino = next((codigo for codigo, valor in usinas.items() if valor == nome), None)
                if destino is None:
                    pendencias["usina_de_outubro_nao_cadastrada"].append(uc)
                    continue
                if atual := unidade["usina_id"]:
                    if atual not in (1, destino):
                        pendencias["cadastro_diverge_da_planilha_de_outubro"].append(uc)
                        continue
                evidencia = "planilha mensal de outubro, posterior à transferência para ECOSOL"
            elif por_mes.get("2026-09"):
                pendencias["transferencia_e_setembro_sem_outubro"].append(uc)
                continue
            else:
                destino = 1
                evidencia = "destino provisório ECOSOL sem planilha mensal posterior"
            if destino == unidade["usina_id"]:
                continue
            aprovado = cnx.execute(
                "SELECT id FROM faturamento_documentos WHERE unidade_id=? "
                "AND competencia>='2026-10' AND status LIKE 'Aprovada%' LIMIT 1",
                (unidade["id"],),
            ).fetchone()
            if aprovado:
                pendencias["fatura_aprovada"].append(uc)
                continue
            plant_updates.append((unidade, destino, linha_numero, data, historicos.get(unidade["id"]), evidencia))
            continue
        if destino is None or destino not in usinas:
            pendencias["destino_sem_usina_ativa"].append(uc)
            continue
        atual = unidade["usina_id"]
        if atual == destino:
            continue
        # A planilha mensal de outubro prevalece sobre transferências antigas.
        # Quando o vínculo atual é indefinido, a transferência documentada o resolve.
        if data.strftime("%Y-%m") < "2026-10" and atual not in (None, 1):
            pendencias["transferencia_anterior_a_foto_de_outubro"].append(uc)
            continue
        if primeira and primeira[0] > data:
            pendencias["primeira_aba_mais_recente"].append(uc)
            continue
        aprovado = cnx.execute(
            "SELECT id FROM faturamento_documentos WHERE unidade_id=? "
            "AND competencia>='2026-10' AND status LIKE 'Aprovada%' LIMIT 1",
            (unidade["id"],),
        ).fetchone()
        if aprovado:
            pendencias["fatura_aprovada"].append(uc)
            continue
        plant_updates.append((unidade, destino, linha_numero, data, historicos.get(unidade["id"]), "destino confirmado na aba MUDARAM DE USINA"))
    return updates, plant_updates, pendencias


def aplicar(cnx, updates, plant_updates, hash_fonte):
    cnx.execute("BEGIN IMMEDIATE")
    try:
        for unidade, campos, fontes in updates:
            itens = list(campos)
            cnx.execute(
                "UPDATE faturamento_unidades SET "
                + ", ".join(f"{item}=?" for item in itens)
                + ", versao=versao+1 WHERE id=? AND versao=?",
                (*[campos[item] for item in itens], unidade["id"], unidade["versao"]),
            )
            if cnx.execute("SELECT changes()").fetchone()[0] != 1:
                raise RuntimeError("Cadastro alterado por outra operação; transação cancelada")
            cnx.execute(
                "INSERT INTO faturamento_historico "
                "(unidade_id,responsavel,acao,dados) VALUES (?,?,?,?)",
                (unidade["id"], "importação conferida", "Dados cadastrais completados da planilha", json.dumps({
                    "fonte_sha256": hash_fonte, "campos_e_origens": fontes,
                }, ensure_ascii=False)),
            )
        for unidade, destino, linha, data, historico, evidencia in plant_updates:
            versao_atual = unidade["versao"] + (1 if any(x[0]["id"] == unidade["id"] for x in updates) else 0)
            cnx.execute(
                "UPDATE faturamento_unidades SET usina_id=?, versao=versao+1 "
                "WHERE id=? AND versao=?",
                (destino, unidade["id"], versao_atual),
            )
            if cnx.execute("SELECT changes()").fetchone()[0] != 1:
                raise RuntimeError("Vínculo alterado por outra operação; transação cancelada")
            if historico:
                cnx.execute(
                    "UPDATE faturamento_vinculos_usina SET usina_id=?, origem_usina_id=?, "
                    "transferencia_id=? WHERE id=?",
                    (destino, unidade["usina_id"], f"planilha:{hash_fonte[:16]}:{linha}", historico["id"]),
                )
            else:
                cnx.execute(
                    "INSERT INTO faturamento_vinculos_usina "
                    "(unidade_id,inicio,usina_id,origem_usina_id,transferencia_id) "
                    "VALUES (?,'2026-10',?,?,?)",
                    (unidade["id"], destino, unidade["usina_id"], f"planilha:{hash_fonte[:16]}:{linha}"),
                )
            cnx.execute(
                "INSERT INTO faturamento_historico "
                "(unidade_id,responsavel,acao,dados) VALUES (?,?,?,?)",
                (unidade["id"], "importação conferida", "UC transferida conforme planilha", json.dumps({
                    "fonte_sha256": hash_fonte, "aba": "MUDARAM DE USINA", "linha": linha,
                    "data_troca": data.strftime("%Y-%m-%d"),
                    "vigencia": "2026-10", "usina_anterior_id": unidade["usina_id"],
                    "usina_nova_id": destino, "criterio": evidencia,
                }, ensure_ascii=False)),
            )
        if cnx.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Falha de integridade do banco")
        cnx.commit()
    except Exception:
        cnx.rollback()
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workbook", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--monthly-folder", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    hash_fonte = hashlib.sha256(args.workbook.read_bytes()).hexdigest()
    abas = linhas_planilha(args.workbook)
    cnx = sqlite3.connect(args.database)
    cnx.row_factory = sqlite3.Row
    mensais = None
    hashes_mensais = {}
    if args.monthly_folder:
        from reconciliarFaturasUsinas import fontes
        _, mensais, hashes_mensais = fontes(args.monthly_folder)
    updates, plant_updates, pendencias = preparar(cnx, abas, mensais)
    resumo = {
        "fonte_sha256": hash_fonte,
        "cadastros_completados": len(updates),
        "cpf_adicionados": sum("documento" in campos for _, campos, _ in updates),
        "emails_adicionados": sum("email" in campos for _, campos, _ in updates),
        "ucs_transferidas": len(plant_updates),
        "usinas_destino": dict(collections.Counter(destino for _, destino, _, _, _, _ in plant_updates)),
        "pendencias": {nome: {"quantidade": len(ucs), "ucs": sorted(ucs)} for nome, ucs in pendencias.items()},
    }
    if args.apply:
        if hashlib.sha256(args.workbook.read_bytes()).hexdigest() != hash_fonte:
            raise RuntimeError("Planilha mudou durante a leitura")
        for nome, hash_anterior in hashes_mensais.items():
            if hashlib.sha256((args.monthly_folder / nome).read_bytes()).hexdigest() != hash_anterior:
                raise RuntimeError(f"Planilha mensal mudou durante a leitura: {nome}")
        pasta = args.database.parent / "backups"
        pasta.mkdir(exist_ok=True)
        backup = pasta / f"ecosol-antes-clientes-transferidos-{dt.datetime.now().strftime('%Y%m%dT%H%M%S%f')}.db"
        with sqlite3.connect(backup) as copia:
            cnx.backup(copia)
        resumo["backup"] = str(backup)
        aplicar(cnx, updates, plant_updates, hash_fonte)
        resumo["aplicado"] = True
    else:
        resumo["aplicado"] = False
    print(json.dumps(resumo, ensure_ascii=False, indent=2))
    cnx.close()


if __name__ == "__main__":
    main()
