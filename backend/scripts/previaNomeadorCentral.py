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
import stat
import sys
import tempfile
from functools import lru_cache
from pathlib import Path

import pdfplumber
from pypdf import PdfReader, PdfWriter


def argumentos():
    parser = argparse.ArgumentParser()
    parser.add_argument("--banco", required=True)
    parser.add_argument("--documento", type=int)
    parser.add_argument("--documentos")
    parser.add_argument("--motor")
    parser.add_argument("--atualizador", required=True)
    parser.add_argument("--planilha-venda")
    parser.add_argument("--pasta-vendas")
    parser.add_argument("--somente-localizar", action="store_true")
    parser.add_argument("--simular", action="store_true")
    parser.add_argument("--saida")
    parser.add_argument("--uc-antiga")
    parser.add_argument("--cliente")
    parser.add_argument("--usina")
    args = parser.parse_args()
    if not args.documento and not args.documentos:
        parser.error("informe --documento ou --documentos")
    if (args.somente_localizar or args.simular) and not args.pasta_vendas and not args.planilha_venda:
        parser.error("a localizacao exige --pasta-vendas ou --planilha-venda")
    if not args.somente_localizar and not args.simular and not args.documento:
        parser.error("a geracao de previa exige um unico --documento")
    if not args.somente_localizar and not args.simular:
        obrigatorios = ("motor", "saida", "uc_antiga", "cliente", "usina")
        faltantes = [nome for nome in obrigatorios if not getattr(args, nome)]
        if faltantes:
            parser.error("geracao de previa exige: " + ", ".join(f"--{nome.replace('_', '-')}" for nome in faltantes))
    return args


def carregar_modulo(nome: str, caminho: str):
    origem = Path(caminho).resolve()
    if str(origem.parent) not in sys.path:
        sys.path.insert(0, str(origem.parent))
    spec = importlib.util.spec_from_file_location(nome, origem)
    if not spec or not spec.loader:
        raise RuntimeError(f"modulo_central_indisponivel:{nome}")
    modulo = importlib.util.module_from_spec(spec)
    sys.modules[nome] = modulo
    spec.loader.exec_module(modulo)
    return modulo


def carregar_motor(caminho: str):
    modulo = carregar_modulo("nomeador_central", caminho)
    app = modulo.AppEcosol.__new__(modulo.AppEcosol)
    app.log = lambda _mensagem: None
    return app


def ler_pdf_do_gmail(caminho_banco: str, documento: int) -> tuple[bytes, str, dict]:
    caminho = Path(caminho_banco).resolve()
    conexao = sqlite3.connect(f"file:{caminho.as_posix()}?mode=ro", uri=True)
    try:
        conexao.execute("PRAGMA query_only=ON")
        registro = conexao.execute(
            """SELECT d.pdf,d.nome,d.dados
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
    try:
        dados = json.loads(registro[2] or "{}")
    except json.JSONDecodeError as erro:
        raise RuntimeError("dados_do_documento_invalidos") from erro
    return bytes(registro[0]), str(registro[1] or "fatura.pdf"), dados


def ler_contexto_gmail(caminho_banco: str, documento: int) -> dict:
    """Le somente o contexto cadastral que ja sustenta a triagem Gmail."""
    caminho = Path(caminho_banco).resolve()
    conexao = sqlite3.connect(f"file:{caminho.as_posix()}?mode=ro", uri=True)
    try:
        conexao.execute("PRAGMA query_only=ON")
        registro = conexao.execute(
            """SELECT d.id,d.nome,d.dados,u.id,u.uc,
                      COALESCE(c.name,o.nome,p.nome),s.nome
                   FROM faturamento_documentos d
                   LEFT JOIN faturamento_unidades u
                     ON u.uc=json_extract(d.dados,'$.uc')
                     OR u.id=(SELECT unidade_id FROM faturamento_unidades_aliases
                              WHERE uc=json_extract(d.dados,'$.uc'))
                   LEFT JOIN customers c ON c.id=u.cliente_id
                   LEFT JOIN faturamento_clientes_operacionais o ON o.id=u.cliente_operacional_id
                   LEFT JOIN faturamento_clientes_provisorios p ON p.id=u.cliente_provisorio_id
                   LEFT JOIN usinas s ON s.id=u.usina_id
                  WHERE d.id=? AND d.classificacao='triagem' AND d.excluido_em IS NULL""",
            (documento,),
        ).fetchone()
        if not registro:
            raise RuntimeError("documento_gmail_indisponivel")
        dados = json.loads(registro[2] or "{}")
        aliases = []
        if registro[3]:
            aliases = [
                linha[0] for linha in conexao.execute(
                    "SELECT uc FROM faturamento_unidades_aliases WHERE unidade_id=? ORDER BY uc",
                    (registro[3],),
                )
            ]
    finally:
        conexao.close()
    return {
        "documento": registro[0], "nome": registro[1], "dados": dados,
        "unidadeId": registro[3], "ucNova": registro[4], "cliente": registro[5],
        "usina": registro[6], "ucsAntigas": aliases,
    }


def codigo_competencia(dados: dict, atualizador, mes_faturamento: str = "") -> str:
    """Converte o mês usado pela Central na aba de venda de energia.

    Quando a prévia contém o PDF, ``mes_faturamento`` vem de
    ``AppEcosol.extrair_mes_vencimento``: é o mês do vencimento da cobrança,
    não a competência de consumo registrada no documento.
    """
    if mes_faturamento:
        codigo = atualizador.month_code_from_sheet(mes_faturamento)
        if codigo:
            return codigo
        raise RuntimeError("mes_de_vencimento_sem_codigo_central")
    competencia = str(dados.get("competencia") or "")
    partes = competencia.split("-")
    if len(partes) != 2 or not partes[1].isdigit() or not 1 <= int(partes[1]) <= 12:
        raise RuntimeError("competencia_do_documento_indisponivel")
    meses = (
        "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
        "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
    )
    codigo = atualizador.month_code_from_sheet(meses[int(partes[1]) - 1])
    if not codigo:
        raise RuntimeError("competencia_sem_codigo_central")
    return codigo


@lru_cache(maxsize=4)
def listar_planilhas_restritas(pasta_vendas: str):
    """Aplica os filtros originais da Central sem atravessar reparse-points."""
    pasta = Path(pasta_vendas).resolve()
    atributos = os.stat(pasta, follow_symlinks=False).st_file_attributes
    if atributos & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
        raise RuntimeError("pasta_de_vendas_e_reparse_point")
    bloqueados = ("PREENCHIDA", "BACKUP", "RELATORIO", "UC POR USINA")
    planilhas = []
    with os.scandir(pasta) as entradas:
        for entrada in entradas:
            atributos = entrada.stat(follow_symlinks=False).st_file_attributes
            if entrada.is_symlink() or atributos & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                continue
            if not entrada.is_file(follow_symlinks=False) or not entrada.name.lower().endswith(".xlsx"):
                continue
            nome = entrada.name.upper()
            if entrada.name.startswith("~$") or any(token in nome for token in bloqueados):
                continue
            planilhas.append(Path(entrada.path))
    return tuple(sorted(planilhas))


def candidatas_da_usina(args, atualizador, usina: str):
    if args.planilha_venda:
        planilha = Path(args.planilha_venda).resolve()
        if not planilha.is_file():
            raise RuntimeError("planilha_de_venda_indisponivel")
        return (planilha,)
    if not args.pasta_vendas:
        raise RuntimeError("pasta_de_vendas_indisponivel")
    usina_normalizada = atualizador.normalize_usina_name(usina)
    if not usina_normalizada:
        raise RuntimeError("usina_do_documento_indisponivel")
    return tuple(
        planilha for planilha in listar_planilhas_restritas(args.pasta_vendas)
        if usina_normalizada in atualizador.normalize_usina_name(planilha.stem)
    )


def localizar_linha_planilha(
    args, atualizador, dados: dict, uc_nova: str, ucs_antigas, usina: str,
    mes_faturamento: str = "",
):
    """Exige uma unica planilha, aba e linha antes de liberar o valor da Central."""
    candidatas = candidatas_da_usina(args, atualizador, usina)
    if not candidatas:
        raise RuntimeError("planilha_da_usina_nao_localizada")
    if len(candidatas) != 1:
        raise RuntimeError(f"planilha_da_usina_ambigua:{len(candidatas)}")

    planilha = candidatas[0]
    usina_normalizada = atualizador.normalize_usina_name(usina)

    competencia = codigo_competencia(dados, atualizador, mes_faturamento)
    # A busca aleatória por UC usada pela Central exige worksheet normal. Esta
    # integração não chama save: o arquivo compartilhado permanece só entrada.
    workbook = atualizador.load_workbook(planilha, read_only=False, data_only=False)
    try:
        aba = atualizador.select_latest_month_sheet(workbook, expected_month=competencia)
        worksheet = workbook[aba]
        primeira_linha = atualizador.find_target_table_start(worksheet)
        if primeira_linha is None:
            raise RuntimeError("tabela_de_venda_nao_localizada")
        classica = atualizador.is_classic_rateio_sheet(worksheet, primeira_linha)
        ucs_antigas_normalizadas = {atualizador.normalize_uc(uc) for uc in ucs_antigas}
        uc_atual = atualizador.normalize_uc(uc_nova)
        linhas = [
            linha for linha in range(primeira_linha, worksheet.max_row + 1)
            if atualizador.normalize_uc(worksheet.cell(linha, 3).value) in ucs_antigas_normalizadas
            and atualizador.normalize_uc(worksheet.cell(linha, 4).value) == uc_atual
            and atualizador.usinas_equivalentes(usina_normalizada, worksheet.cell(linha, 1).value)
        ]
        if len(linhas) != 1:
            raise RuntimeError(f"linha_da_uc_ambigua:{len(linhas)}")
        linha = linhas[0]
        return {
            "planilha": str(planilha), "aba": aba, "linha": linha,
            "classica": classica, "colunaBoleto": 17 if classica else 12,
            "ucAntigaPlanilha": atualizador.normalize_uc(worksheet.cell(linha, 3).value),
        }
    finally:
        workbook.close()


def localizar_valor_boleto(args, atualizador, dados: dict, uc_nova: str, mes_faturamento: str):
    localizacao = localizar_linha_planilha(
        args, atualizador, dados, uc_nova, (args.uc_antiga,), args.usina,
        mes_faturamento,
    )
    planilha = Path(localizacao["planilha"])
    aba = localizacao["aba"]
    linha = localizacao["linha"]
    classica = localizacao["classica"]
    coluna_boleto = localizacao["colunaBoleto"]
    workbook = atualizador.load_workbook(planilha, read_only=False, data_only=False)
    try:
        worksheet = workbook[aba]
        entradas = (5, 6, 7, 8) if not classica else (5, 6, 8, 9, 13, 15)
        if any(worksheet.cell(linha, coluna).value in (None, "") for coluna in entradas):
            raise RuntimeError("dados_financeiros_da_planilha_incompletos")
        boleto_calculado = atualizador.calculate_boleto(worksheet, linha, classica)
        referencia = f"{worksheet.cell(1, coluna_boleto).column_letter}{linha}"
    finally:
        workbook.close()

    # A celula de boleto e a fonte declarada da planilha. A rotina original
    # calcula a mesma linha; a comparacao usa a formatacao monetaria original
    # porque o cache do Excel pode manter residuo binario alem de seis casas.
    workbook_cache = atualizador.load_workbook(planilha, read_only=False, data_only=True)
    try:
        valor_celula = workbook_cache[aba].cell(linha, coluna_boleto).value
    finally:
        workbook_cache.close()
    boleto_celula = atualizador.cell_to_decimal(valor_celula)
    if valor_celula not in (None, "") and atualizador.decimal_to_br_text(boleto_celula, 2) != atualizador.decimal_to_br_text(boleto_calculado, 2):
        raise RuntimeError("valor_da_celula_diverge_do_calculo_original")
    return {
        "valor": boleto_calculado,
        "planilha": str(planilha),
        "aba": aba,
        "linha": linha,
        "celula": referencia,
        "valorCalculadoCentral": str(boleto_calculado),
        "valorCelula": str(boleto_celula) if valor_celula not in (None, "") else None,
    }


def preparar_fatura_temporaria_da_central(app, pdf_original: bytes, uc_antiga: str, cliente: str, usina: str):
    """Aplica apenas o carimbo-base em arquivo temporário para o extrator original.

    A Central extrai UC antiga/nova do carimbo. Este arquivo nunca é exposto,
    nem substitui o PDF Gmail; é descartado após a simulação.
    """
    origem = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    carimbada = None
    try:
        origem.write(pdf_original)
        origem.close()
        with pdfplumber.open(origem.name) as pdf:
            if not pdf.pages:
                raise RuntimeError("pdf_sem_paginas")
            primeira = pdf.pages[0]
            texto = primeira.extract_text() or ""
            palavras = primeira.extract_words(use_text_flow=True) or []
            caracteres = primeira.chars or []
            if len(caracteres) > 1400:
                caracteres = []
            objetos = {
                "rects": primeira.rects or [], "lines": primeira.lines or [],
                "curves": primeira.curves or [], "chars": caracteres,
            }
            if len(pdf.pages) > 1:
                texto += "\n" + "\n".join(pagina.extract_text() or "" for pagina in pdf.pages[1:])

        uc_nova = app.limpar_numero(app.extrair_uc_nova(texto))
        mes = app.extrair_mes_vencimento(texto)
        if not uc_nova or not mes:
            raise RuntimeError("campos_obrigatorios_nao_extraidos_pela_central")
        leitor = PdfReader(origem.name)
        escritor = PdfWriter()
        pagina = leitor.pages[0]
        carimbo = app.criar_pdf_carimbo(
            mes_ref=mes, usina=usina, cliente=cliente, uc_antiga=uc_antiga,
            uc_nova=uc_nova, largura_pagina=float(pagina.mediabox.width),
            altura_pagina=float(pagina.mediabox.height), palavras_pag0=palavras,
            objetos_pag0=objetos,
        )
        pagina.merge_page(carimbo.pages[0])
        escritor.add_page(pagina)
        carimbada = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        carimbada.close()
        with Path(carimbada.name).open("wb") as arquivo:
            escritor.write(arquivo)
        return Path(carimbada.name), {"ucNova": uc_nova, "mes": mes}
    finally:
        try:
            os.unlink(origem.name)
        except OSError:
            pass


def campos_financeiros_fixos(atualizador, worksheet, linha: int):
    return {
        "energia": atualizador.cell_to_decimal(worksheet.cell(linha, 5).value),
        "tarifa": atualizador.cell_to_decimal(worksheet.cell(linha, 6).value),
        "desconto": atualizador.cell_to_decimal(worksheet.cell(linha, 7).value),
        "equatorial": atualizador.cell_to_decimal(worksheet.cell(linha, 8).value),
        "juros": atualizador.cell_to_decimal(worksheet.cell(linha, 9).value),
        "multa": atualizador.cell_to_decimal(worksheet.cell(linha, 10).value),
        "gdii": atualizador.cell_to_decimal(worksheet.cell(linha, 11).value),
    }


def entrada_financeira_nao_materializada(valor):
    """Fórmula Excel sem cálculo em cache não é valor utilizável pela Central."""
    return valor in (None, "") or (isinstance(valor, str) and valor.startswith("="))


def texto_decimal(atualizador, valor, casas=6):
    return atualizador.decimal_to_br_text(atualizador.cell_to_decimal(valor), casas)


def validar_dados_financeiros_da_fatura(dados_fatura):
    obrigatorios = {
        "energia_injetada": dados_fatura.energia_injetada,
        "tarifa_total_kwh": dados_fatura.tarifa_total_kwh,
        "total_pagar": dados_fatura.total_pagar,
    }
    ausentes = [campo for campo, valor in obrigatorios.items() if valor is None]
    if "tarifa_total_kwh_usou_padrao" in str(dados_fatura.observacao or ""):
        ausentes.append("tarifa_total_kwh_extraida_do_pdf")
    if ausentes:
        raise RuntimeError("dados_financeiros_pdf_incompletos:" + ",".join(ausentes))


def simular_documento(args, app, atualizador, documento: int):
    """Calcula em memória com as rotinas da Central, sem salvar planilha/PDF."""
    temporaria = None
    workbook = None
    try:
        contexto = ler_contexto_gmail(args.banco, documento)
        if not contexto["unidadeId"] or not contexto["ucNova"] or not contexto["usina"]:
            raise RuntimeError("vinculo_cadastral_incompleto")
        if not contexto["ucsAntigas"]:
            raise RuntimeError("uc_antiga_nao_referenciada")
        pdf_original, _, _ = ler_pdf_do_gmail(args.banco, documento)

        # Primeiro se usa somente a UC extraída pelo nomeador original. A linha
        # é então localizada de forma única entre as UCs históricas cadastradas.
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as rascunho:
            rascunho.write(pdf_original)
            caminho_rascunho = Path(rascunho.name)
        try:
            with pdfplumber.open(caminho_rascunho) as pdf:
                texto_bruto = "\n".join(pagina.extract_text() or "" for pagina in pdf.pages)
            uc_pdf = app.limpar_numero(app.extrair_uc_nova(texto_bruto))
            mes = app.extrair_mes_vencimento(texto_bruto)
        finally:
            caminho_rascunho.unlink(missing_ok=True)
        if not uc_pdf or not mes:
            raise RuntimeError("campos_obrigatorios_nao_extraidos_pela_central")
        if uc_pdf != contexto["ucNova"]:
            raise RuntimeError("uc_pdf_diverge_do_vinculo_cadastral")

        localizacao = localizar_linha_planilha(
            args, atualizador, contexto["dados"], uc_pdf, contexto["ucsAntigas"],
            contexto["usina"], mes,
        )
        temporaria, metadados = preparar_fatura_temporaria_da_central(
            app, pdf_original, localizacao["ucAntigaPlanilha"], contexto["cliente"], contexto["usina"],
        )
        if metadados["ucNova"] != uc_pdf or metadados["mes"] != mes:
            raise RuntimeError("identificacao_temporaria_divergente")
        dados_fatura = atualizador.extract_invoice(temporaria, atualizador.DEFAULT_TARIFA_TOTAL_KWH)
        if dados_fatura is None:
            raise RuntimeError("fatura_nao_extraida_pelo_atualizador_central")
        validar_dados_financeiros_da_fatura(dados_fatura)

        # load_workbook apenas carrega o .xlsx compartilhado na memória. Não há
        # chamada a save, process_workbook ou qualquer escrita no diretório G:.
        workbook = atualizador.load_workbook(localizacao["planilha"], read_only=False, data_only=False)
        worksheet = workbook[localizacao["aba"]]
        linha = localizacao["linha"]
        classica = localizacao["classica"]
        desconto_antes = worksheet.cell(linha, 13 if classica else 7).value
        preenchida = not atualizador.row_is_unfilled(worksheet, linha, classic_rateio=classica)
        motivos = []
        if not classica:
            atuais = campos_financeiros_fixos(atualizador, worksheet, linha)
            esperados = {
                "energia": dados_fatura.energia_injetada,
                "tarifa": dados_fatura.tarifa_total_kwh,
                "equatorial": dados_fatura.total_pagar,
            }
            entradas_brutas = {
                "energia": worksheet.cell(linha, 5).value,
                "tarifa": worksheet.cell(linha, 6).value,
                "equatorial": worksheet.cell(linha, 8).value,
            }
            faltantes = [
                campo for campo, valor in entradas_brutas.items()
                if entrada_financeira_nao_materializada(valor)
            ]
            divergentes = [
                campo for campo, esperado in esperados.items()
                if campo not in faltantes and atuais[campo] != esperado
            ]
            if divergentes:
                motivos.append("dados_planilha_divergentes:" + ",".join(divergentes))
            elif faltantes:
                # A Central preenche E/F/H com fill_row. Na simulação isso
                # ocorre apenas em memória e somente quando os valores já
                # existentes coincidem com a fatura atual.
                atualizador.fill_row(worksheet, linha, dados_fatura, classic_rateio=classica)
        elif preenchida:
            motivos.append("linha_classica_preenchida_sem_substituicao")
        else:
            atualizador.fill_row(worksheet, linha, dados_fatura, classic_rateio=classica)

        desconto_depois = worksheet.cell(linha, 13 if classica else 7).value
        if desconto_depois != desconto_antes:
            raise RuntimeError("desconto_contratual_alterado_na_simulacao")
        calculado = atualizador.calculate_boleto(worksheet, linha, classic_rateio=classica)
        campos = campos_financeiros_fixos(atualizador, worksheet, linha) if not classica else {}
        return {
            "documento": documento,
            "situacao": "revisar" if motivos else "simulada",
            "motivos": motivos,
            "planilha": localizacao["planilha"], "aba": localizacao["aba"],
            "linha": linha, "ucAntiga": localizacao["ucAntigaPlanilha"], "ucNova": uc_pdf,
            "cliente": contexto["cliente"], "usina": contexto["usina"],
            "preenchidaNaPlanilha": preenchida,
            "dadosFatura": {
                "energia": texto_decimal(atualizador, dados_fatura.energia_injetada, 2),
                "tarifa": texto_decimal(atualizador, dados_fatura.tarifa_total_kwh, 6),
                "equatorial": texto_decimal(atualizador, dados_fatura.total_pagar, 2),
                "juros": texto_decimal(atualizador, dados_fatura.juros, 2),
                "multa": texto_decimal(atualizador, dados_fatura.multa, 2),
                "gdii": texto_decimal(atualizador, dados_fatura.desconto_gdii, 2),
            },
            "camposSimulados": {campo: texto_decimal(atualizador, valor, 6 if campo == "tarifa" else 2) for campo, valor in campos.items()},
            "descontoContratual": texto_decimal(atualizador, desconto_depois, 6),
            "formula": worksheet.cell(linha, 17 if classica else 12).value,
            "valorBoleto": texto_decimal(atualizador, calculado, 2),
        }
    finally:
        if workbook is not None:
            workbook.close()
        if temporaria is not None:
            temporaria.unlink(missing_ok=True)


def simular_documentos(args):
    app = carregar_motor(args.motor)
    atualizador = carregar_modulo("atualizador_central", args.atualizador)
    documentos = [int(valor) for valor in str(args.documentos or args.documento).split(",") if valor.strip()]
    resultados = []
    for documento in documentos:
        try:
            resultados.append(simular_documento(args, app, atualizador, documento))
        except Exception as erro:
            resultados.append({"documento": documento, "situacao": "revisar", "motivos": [str(erro)]})
    return {"resultados": resultados}


def valor_boleto_da_simulacao(simulacao, atualizador):
    """Retorna somente o valor já calculado pela Central para uma prévia local."""
    if simulacao.get("situacao") != "simulada":
        motivos = ",".join(simulacao.get("motivos") or [])
        raise RuntimeError("previa_bloqueada_para_revisao" + (":" + motivos if motivos else ""))
    valor = simulacao.get("valorBoleto")
    if valor in (None, ""):
        raise RuntimeError("valor_do_boleto_nao_calculado_pela_central")
    # valorBoleto é a apresentação pt-BR do Decimal já retornado por
    # calculate_boleto (por exemplo, "7.559,70"). cell_to_decimal da Central
    # recebe ponto como separador decimal; esta conversão só recompõe o mesmo
    # Decimal, sem arredondar ou recalcular a cobrança.
    valor_normalizado = str(valor).replace(".", "").replace(",", ".")
    return atualizador.cell_to_decimal(valor_normalizado)


def localizar_documentos(args):
    atualizador = carregar_modulo("atualizador_central", args.atualizador)
    documentos = [int(valor) for valor in str(args.documentos or args.documento).split(",") if valor.strip()]
    resultados = []
    for documento in documentos:
        try:
            contexto = ler_contexto_gmail(args.banco, documento)
            if not contexto["unidadeId"] or not contexto["ucNova"] or not contexto["usina"]:
                raise RuntimeError("vinculo_cadastral_incompleto")
            if not contexto["ucsAntigas"]:
                raise RuntimeError("uc_antiga_nao_referenciada")
            localizacao = localizar_linha_planilha(
                args, atualizador, contexto["dados"], contexto["ucNova"],
                contexto["ucsAntigas"], contexto["usina"],
            )
            resultados.append({
                "documento": documento, "situacao": "segura", "ucNova": contexto["ucNova"],
                "usina": contexto["usina"], **{chave: valor for chave, valor in localizacao.items() if chave != "classica"},
            })
        except Exception as erro:
            resultados.append({"documento": documento, "situacao": "revisar", "motivo": str(erro)})
    return {"resultados": resultados}


def gerar_previa(args):
    app = carregar_motor(args.motor)
    atualizador = carregar_modulo("atualizador_central", args.atualizador)
    pdf_original, nome_original, _dados = ler_pdf_do_gmail(args.banco, args.documento)
    temporario = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    previa_sem_valor = None
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
        previa_sem_valor = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        previa_sem_valor.close()
        with Path(previa_sem_valor.name).open("wb") as arquivo:
            escritor.write(arquivo)
        # A prévia usa o mesmo cálculo em memória que a revisão Gmail: dados
        # atuais do PDF, desconto contratual da planilha e calculate_boleto da
        # Central. Valores de PDFs já carimbados ou de cache Excel não são fonte.
        simulacao = simular_documento(args, app, atualizador, args.documento)
        valor_boleto = valor_boleto_da_simulacao(simulacao, atualizador)
        atualizador.stamp_boleto_pdf(
            Path(previa_sem_valor.name),
            destino,
            valor_boleto,
            boleto_base=valor_boleto,
        )
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
            "boleto": {
                "planilha": simulacao["planilha"],
                "aba": simulacao["aba"],
                "linha": simulacao["linha"],
                "valorCalculadoCentral": simulacao["valorBoleto"],
            },
        }
    finally:
        try:
            os.unlink(temporario.name)
        except OSError:
            pass
        if previa_sem_valor:
            try:
                os.unlink(previa_sem_valor.name)
            except OSError:
                pass


if __name__ == "__main__":
    try:
        argumentos_execucao = argumentos()
        if argumentos_execucao.somente_localizar:
            resultado = localizar_documentos(argumentos_execucao)
        elif argumentos_execucao.simular:
            resultado = simular_documentos(argumentos_execucao)
        else:
            resultado = gerar_previa(argumentos_execucao)
        print(json.dumps(resultado, ensure_ascii=False))
    except Exception as erro:
        print(json.dumps({"erro": str(erro)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
