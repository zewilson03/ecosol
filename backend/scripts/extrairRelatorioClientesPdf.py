import json
import logging
import re
import sys
from pathlib import Path

import pdfplumber

logging.getLogger("pdfminer").setLevel(logging.ERROR)


def texto_celula(palavras):
    linhas = {}
    for palavra in sorted(palavras, key=lambda item: (round(item["top"], 1), item["x0"])):
        chave = round(palavra["top"], 1)
        linhas.setdefault(chave, []).append(palavra["text"])
    return " ".join(" ".join(linha) for linha in linhas.values()).strip()


def extrair_linhas(pagina, limite_inferior, cortes, limite_superior=None):
    palavras = pagina.extract_words() or []
    candidatas = [
        palavra
        for palavra in palavras
        if 38 <= palavra["x0"] <= 52
        and palavra["text"].isdigit()
        and palavra["top"] >= limite_inferior
        and (limite_superior is None or palavra["top"] < limite_superior)
    ]
    resultados = []
    for indice, marcador in enumerate(candidatas):
        inicio = marcador["top"] - 0.5
        fim = (
            candidatas[indice + 1]["top"] - 0.5
            if indice + 1 < len(candidatas)
            else limite_superior or pagina.height - 35
        )
        palavras_linha = [
            palavra
            for palavra in palavras
            if inicio <= palavra["top"] < fim and palavra is not marcador
        ]
        celulas = []
        for coluna in range(len(cortes) + 1):
            minimo = cortes[coluna - 1] if coluna else 0
            maximo = cortes[coluna] if coluna < len(cortes) else pagina.width + 1
            celulas.append(
                texto_celula(
                    [
                        palavra
                        for palavra in palavras_linha
                        if minimo <= palavra["x0"] < maximo
                    ]
                )
            )
        resultados.append([marcador["text"], *celulas])
    return resultados


def apenas_digitos(valor):
    return re.sub(r"\D", "", valor or "")


def normalizar_uc(valor):
    uc = apenas_digitos(valor).lstrip("0")
    return uc or "0"


def emails_no_texto(valor):
    encontrados = re.findall(r"[^\s;]+@[^\s;]+\.[^\s;]+", valor or "")
    return list(dict.fromkeys(email.lower() for email in encontrados))


def documentos_no_texto(valor):
    valor = re.sub(r"\s+", "", valor or "")
    padrao = r"(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})"
    return list(dict.fromkeys(apenas_digitos(item) for item in re.findall(padrao, valor)))


def extrair(caminho):
    registros = []
    with pdfplumber.open(caminho) as documento:
        for numero_pagina in range(2, 11):
            pagina = documento.pages[numero_pagina - 1]
            limite_superior = None
            if numero_pagina == 10:
                palavras = pagina.extract_words() or []
                cabecalho_migracao = next(
                    (
                        palavra["top"]
                        for palavra in palavras
                        if palavra["text"] == "3."
                        and palavra["x0"] < 50
                    ),
                    pagina.height,
                )
                limite_superior = cabecalho_migracao
            for linha in extrair_linhas(
                pagina,
                limite_inferior=145 if numero_pagina == 2 else 45,
                cortes=[60, 195, 370, 480],
                limite_superior=limite_superior,
            ):
                numero, _, nome, email, documento_texto, uc = linha
                uc_normalizada = normalizar_uc(uc)
                if len(uc_normalizada) < 7:
                    continue
                registros.append(
                    {
                        "origem": "base_principal",
                        "pagina": numero_pagina,
                        "linha": int(numero),
                        "nome": nome,
                        "emails": emails_no_texto(email),
                        "documentos": documentos_no_texto(documento_texto),
                        "documento_texto": documento_texto,
                        "uc_original": uc_normalizada,
                        "uc_final": uc_normalizada,
                    }
                )

        for numero_pagina in (10, 11):
            pagina = documento.pages[numero_pagina - 1]
            palavras = pagina.extract_words() or []
            if numero_pagina == 10:
                inicio = next(
                    palavra["top"]
                    for palavra in palavras
                    if palavra["text"] == "#" and palavra["top"] > 180
                ) + 10
                fim = None
            else:
                inicio = 35
                fim = next(
                    palavra["top"]
                    for palavra in palavras
                    if palavra["text"] == "4." and palavra["x0"] < 50
                )
            for linha in extrair_linhas(
                pagina,
                limite_inferior=inicio,
                cortes=[60, 205, 290, 375, 455],
                limite_superior=fim,
            ):
                numero, _, nome, email, documento_texto, uc_antiga, uc_nova = linha
                nova = normalizar_uc(uc_nova)
                antiga = normalizar_uc(uc_antiga)
                if len(nova) < 7 or len(antiga) < 7:
                    continue
                registros.append(
                    {
                        "origem": "migracao_uc",
                        "pagina": numero_pagina,
                        "linha": int(numero),
                        "nome": nome,
                        "emails": emails_no_texto(email),
                        "documentos": documentos_no_texto(documento_texto),
                        "documento_texto": documento_texto,
                        "uc_original": antiga,
                        "uc_final": nova,
                    }
                )
    return registros


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Uso: extrairRelatorioClientesPdf.py ARQUIVO.pdf")
    arquivo = Path(sys.argv[1]).resolve()
    if not arquivo.is_file():
        raise SystemExit(f"PDF não encontrado: {arquivo}")
    registros_extraidos = extrair(arquivo)
    print(json.dumps(registros_extraidos, ensure_ascii=False))
