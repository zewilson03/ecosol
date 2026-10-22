"""Prévia de um PDF Gmail usando, sem copiar, as funções do nomeador da Central.

Este adaptador não altera SQLite nem arquivos de entrada. A identidade comercial
precisa chegar previamente conferida pelo fluxo do José; o motor da Central
continua sendo a única implementação de extração, nomeação e carimbo.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

import pdfplumber
from pypdf import PdfReader, PdfWriter


def argumentos():
    parser = argparse.ArgumentParser()
    parser.add_argument("--banco", required=True)
    parser.add_argument("--documento", required=True, type=int)
    parser.add_argument("--motor", required=True)
    parser.add_argument("--saida", required=True)
    parser.add_argument("--uc-antiga", required=True)
    parser.add_argument("--cliente", required=True)
    parser.add_argument("--usina", required=True)
    return parser.parse_args()


def carregar_motor(caminho: str):
    spec = importlib.util.spec_from_file_location("nomeador_central", caminho)
    if not spec or not spec.loader:
        raise RuntimeError("motor_central_indisponivel")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    app = modulo.AppEcosol.__new__(modulo.AppEcosol)
    app.log = lambda _mensagem: None
    return app


def ler_pdf_do_gmail(caminho_banco: str, documento: int) -> tuple[bytes, str]:
    caminho = Path(caminho_banco).resolve()
    conexao = sqlite3.connect(f"file:{caminho.as_posix()}?mode=ro", uri=True)
    try:
        conexao.execute("PRAGMA query_only=ON")
        registro = conexao.execute(
            """SELECT d.pdf,d.nome
                 FROM faturamento_documentos d
                 JOIN gmail_anexos a ON a.documento_id=d.id
                WHERE d.id=? AND a.estado='capturado'
                  AND d.classificacao='triagem' AND d.excluido_em IS NULL""",
            (documento,),
        ).fetchone()
    finally:
        conexao.close()
    if not registro or not registro[0]:
        raise RuntimeError("documento_gmail_indisponivel")
    return bytes(registro[0]), str(registro[1] or "fatura.pdf")


def gerar_previa(args):
    app = carregar_motor(args.motor)
    pdf_original, nome_original = ler_pdf_do_gmail(args.banco, args.documento)
    temporario = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    try:
        temporario.write(pdf_original)
        temporario.close()
        with pdfplumber.open(temporario.name) as pdf:
            if not pdf.pages:
                raise RuntimeError("pdf_sem_paginas")
            primeira = pdf.pages[0]
            texto = primeira.extract_text() or ""
            palavras = primeira.extract_words(use_text_flow=True) or []
            caracteres = primeira.chars or []
            if len(caracteres) > 1400:
                caracteres = []
            objetos = {
                "rects": primeira.rects or [],
                "lines": primeira.lines or [],
                "curves": primeira.curves or [],
                "chars": caracteres,
            }
            if len(pdf.pages) > 1:
                texto += "\n" + "\n".join(
                    pagina.extract_text() or "" for pagina in pdf.pages[1:]
                )

        uc_nova = app.limpar_numero(app.extrair_uc_nova(texto))
        medidor = app.limpar_numero(app.extrair_medidor(texto))
        mes = app.extrair_mes_vencimento(texto)
        if not uc_nova or not mes:
            raise RuntimeError("campos_obrigatorios_nao_extraidos_pela_central")

        base = app.limpar_nome_arquivo(
            f"Fatura EQT - {mes} - {args.usina} - {args.cliente} - "
            f"{args.uc_antiga} - {uc_nova}"
        )
        destino = Path(args.saida).resolve()
        destino.parent.mkdir(parents=True, exist_ok=True)
        nome_final = app.criar_nome_saida_seguro(base, str(destino.parent))
        destino = destino.parent / nome_final

        leitor = PdfReader(temporario.name)
        escritor = PdfWriter()
        pagina = leitor.pages[0]
        carimbo = app.criar_pdf_carimbo(
            mes_ref=mes,
            usina=args.usina,
            cliente=args.cliente,
            uc_antiga=args.uc_antiga,
            uc_nova=uc_nova,
            largura_pagina=float(pagina.mediabox.width),
            altura_pagina=float(pagina.mediabox.height),
            palavras_pag0=palavras,
            objetos_pag0=objetos,
        )
        pagina.merge_page(carimbo.pages[0])
        escritor.add_page(pagina)
        with destino.open("wb") as arquivo:
            escritor.write(arquivo)
        return {
            "documento": args.documento,
            "nomeOriginal": nome_original,
            "nomeFinal": nome_final,
            "saida": str(destino),
            "ucAntiga": args.uc_antiga,
            "ucNova": uc_nova,
            "medidor": medidor or None,
            "mes": mes,
            "cliente": args.cliente,
            "usina": args.usina,
            "paginasOriginais": len(leitor.pages),
            "paginasPrevia": 1,
        }
    finally:
        try:
            os.unlink(temporario.name)
        except OSError:
            pass


if __name__ == "__main__":
    try:
        print(json.dumps(gerar_previa(argumentos()), ensure_ascii=False))
    except Exception as erro:
        print(json.dumps({"erro": str(erro)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
