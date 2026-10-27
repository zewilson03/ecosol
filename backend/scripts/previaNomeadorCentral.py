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
import re
import shutil
import sqlite3
import sys
import stat
import sys
import tempfile
from functools import lru_cache
from pathlib import Path

import pandas as pd
import pdfplumber
from pypdf import PdfReader, PdfWriter

_FONTES_IDENTIFICACAO_CENTRAL = {}
_INDICE_LINHAS_PLANILHA = {}

# A ponte Node interpreta o JSON estruturado como UTF-8. Em consoles Windows
# configurados em cp1252, nomes de clientes acentuados corrompiam os caminhos
# temporários e faziam a camada de segurança rejeitar um PDF válido.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def argumentos():
    parser = argparse.ArgumentParser()
    parser.add_argument("--banco", required=True)
    parser.add_argument("--documento", type=int)
    parser.add_argument("--documentos")
    parser.add_argument("--motor")
    parser.add_argument("--atualizador", required=True)
    parser.add_argument("--planilha-venda")
    parser.add_argument("--pasta-vendas")
    # Fontes somente leitura do fluxo de identificação da Central. Elas não
    # substituem o cadastro do José: servem para recuperar, com as mesmas
    # regras da Central, a UC histórica e o contexto comercial da fatura.
    parser.add_argument("--planilha-carteira")
    parser.add_argument("--cache-medidores")
    parser.add_argument("--somente-localizar", action="store_true")
    parser.add_argument("--simular", action="store_true")
    parser.add_argument("--processar-isolado", action="store_true")
    parser.add_argument("--processar-documental-isolado", action="store_true")
    parser.add_argument("--diretorio-saida")
    parser.add_argument("--saida")
    parser.add_argument("--uc-antiga")
    parser.add_argument("--cliente")
    parser.add_argument("--usina")
    args = parser.parse_args()
    if not args.documento and not args.documentos:
        parser.error("informe --documento ou --documentos")
    if (args.somente_localizar or args.simular) and not args.pasta_vendas and not args.planilha_venda:
        parser.error("a localizacao exige --pasta-vendas ou --planilha-venda")
    if args.processar_isolado and not args.diretorio_saida:
        parser.error("processamento isolado exige --diretorio-saida")
    if args.processar_documental_isolado and (not args.diretorio_saida or not args.motor):
        parser.error("processamento documental isolado exige --diretorio-saida e --motor")
    if not args.somente_localizar and not args.simular and not args.processar_isolado and not args.processar_documental_isolado and not args.documento:
        parser.error("a geracao de previa exige um unico --documento")
    if not args.somente_localizar and not args.simular and not args.processar_isolado and not args.processar_documental_isolado:
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
                  AND d.classificacao IN ('triagem','fatura')
                  AND d.finalidade='cobranca' AND d.excluido_em IS NULL""",
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


def ler_contexto_gmail(caminho_banco: str, documento: int, uc_evidencia: str = "", uc_chave: str = "") -> dict:
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
                     ON u.uc=COALESCE(NULLIF(?,''),json_extract(d.dados,'$.uc'))
                     OR ltrim(u.uc,'0')=NULLIF(?, '')
                     OR u.id=(SELECT unidade_id FROM faturamento_unidades_aliases
                              WHERE uc=COALESCE(NULLIF(?,''),json_extract(d.dados,'$.uc'))
                                 OR ltrim(uc,'0')=NULLIF(?, ''))
                   LEFT JOIN customers c ON c.id=u.cliente_id
                   LEFT JOIN faturamento_clientes_operacionais o ON o.id=u.cliente_operacional_id
                   LEFT JOIN faturamento_clientes_provisorios p ON p.id=u.cliente_provisorio_id
                   LEFT JOIN usinas s ON s.id=u.usina_id
                  WHERE d.id=? AND d.classificacao IN ('triagem','fatura')
                    AND d.finalidade='cobranca' AND d.excluido_em IS NULL""",
            (uc_evidencia, uc_chave, uc_evidencia, uc_chave, documento),
        ).fetchall()
        if not registro:
            raise RuntimeError("documento_gmail_indisponivel")
        if len(registro) > 1:
            raise RuntimeError(f"vinculo_cadastral_ambiguo:{len(registro)}")
        registro = registro[0]
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


def identificar_pdf_gmail_pela_central(app, pdf_original: bytes) -> dict:
    """Delega à Central a UC e o mês presentes no PDF Gmail, sem gravá-lo."""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as rascunho:
        rascunho.write(pdf_original)
        caminho_rascunho = Path(rascunho.name)
    try:
        with pdfplumber.open(caminho_rascunho) as pdf:
            texto_bruto = "\n".join(pagina.extract_text() or "" for pagina in pdf.pages)
        return {
            "ucNova": app.limpar_numero(app.extrair_uc_nova(texto_bruto)),
            "medidor": app.limpar_numero(app.extrair_medidor(texto_bruto)),
            "mes": app.extrair_mes_vencimento(texto_bruto),
        }
    finally:
        caminho_rascunho.unlink(missing_ok=True)


def validar_uc_pdf_com_metadado(app, contexto: dict, uc_pdf: str):
    uc_metadado = app.limpar_numero(contexto["dados"].get("uc"))
    if uc_metadado and app.chave_uc(uc_metadado) != app.chave_uc(uc_pdf):
        raise RuntimeError("uc_pdf_diverge_do_metadado_gmail")


def carregar_fontes_de_identificacao_central(args, app):
    """Monta os índices com as funções de UC da Central, sem gravar fontes.

    ``processar_tudo()`` cria esses mesmos mapas antes de processar cada PDF.
    O adaptador precisa apenas da parte consultiva: lê a planilha oficial e o
    cache JSON já existente. Não chama ``carregar_ou_montar_cache_medidores``
    porque esse método pode consolidar ou reconstruir o cache da Central.
    """
    if not args.planilha_carteira or not args.cache_medidores:
        return None
    planilha = Path(args.planilha_carteira)
    cache = Path(args.cache_medidores)
    if not planilha.is_file() or not cache.is_file():
        return None
    chave_fontes = (str(planilha.resolve()), str(cache.resolve()))
    if chave_fontes in _FONTES_IDENTIFICACAO_CENTRAL:
        return _FONTES_IDENTIFICACAO_CENTRAL[chave_fontes]

    # A Central configurada usa SQLite. Seu leitor inicializa o esquema para
    # compatibilidade, então a chamada ocorre sobre uma cópia temporária local
    # do índice. Para o formato legado JSON, o leitor original já é só leitura.
    app.versao_cache_medidores = 1
    if cache.suffix.lower() in {".db", ".sqlite", ".sqlite3"}:
        pasta_temporaria = Path(__file__).resolve().parents[1] / "data"
        with tempfile.TemporaryDirectory(
            prefix="ecosol-indice-medidores-", dir=pasta_temporaria,
        ) as pasta:
            copia_cache = Path(pasta) / cache.name
            shutil.copy2(cache, copia_cache)
            indice_medidores = app._carregar_cache_medidores_sqlite(str(copia_cache))
    else:
        indice_medidores = app._carregar_cache_medidores_de_arquivo(str(cache))
    if not indice_medidores:
        return None

    xls = pd.ExcelFile(planilha)
    aba = "Consulta" if "Consulta" in xls.sheet_names else xls.sheet_names[0]
    df = pd.read_excel(planilha, sheet_name=aba, dtype=str)
    df.columns = df.columns.str.strip().str.upper()
    col_uc_antiga = next(
        (c for c in df.columns if c in [
            "UC ANTIGA", "UC", "NÂº UC", "NÂ° UC", "UNIDADE CONSUMIDORA", "NUMERO UC",
        ]),
        None,
    )
    col_uc_nova = next(
        (c for c in df.columns if c in [
            "UC NOVA", "NOVO NÂº DA UC", "NOVO NÂ° DA UC", "NOVA UC", "NOVO NUMERO UC",
        ]),
        None,
    )
    col_usina = next((c for c in df.columns if c in ["USINA", "PLANTA"]), None)
    col_cliente = next((c for c in df.columns if c == "CLIENTE"), None)
    if not col_cliente and len(df.columns) >= 3:
        col_cliente = df.columns[2]
    if not col_usina and len(df.columns) >= 4:
        col_usina = df.columns[3]
    if (not col_uc_antiga and not col_uc_nova) or not col_cliente:
        return None

    mapa_uc_antiga, mapa_uc_nova = {}, {}
    # Mesmo preenchimento de mapas e mesma resolução de duplicidade da
    # Central; o índice de transferidos está vazio na configuração oficial
    # atual, portanto não introduz uma fonte alternativa no José.
    for _, linha in df.iterrows():
        uc_antiga = app.limpar_numero(linha.get(col_uc_antiga, "")) if col_uc_antiga else ""
        uc_nova = app.limpar_numero(linha.get(col_uc_nova, "")) if col_uc_nova else ""
        cliente = str(linha.get(col_cliente, "CLIENTE")).strip()
        if not cliente:
            continue
        info = {
            "uc_antiga": uc_antiga,
            "uc_nova": uc_nova,
            "usina": str(linha.get(col_usina, "GERAL")).strip().upper() if col_usina else "GERAL",
            "cliente": cliente,
        }
        for chave in (uc_antiga, app.chave_uc(uc_antiga)):
            app.atualizar_mapa_uc(mapa_uc_antiga, chave, info, tipo_uc="uc_antiga")
        for chave in (uc_nova, app.chave_uc(uc_nova)):
            app.atualizar_mapa_uc(mapa_uc_nova, chave, info, tipo_uc="uc_nova")
    fontes = {
        "indiceMedidores": indice_medidores,
        "mapaUcAntiga": mapa_uc_antiga,
        "mapaUcNova": mapa_uc_nova,
    }
    _FONTES_IDENTIFICACAO_CENTRAL[chave_fontes] = fontes
    return fontes


def resolver_contexto_pelas_fontes_da_central(args, app, identificado_pdf: dict) -> dict | None:
    """Reproduz a cadeia consultiva da Central: medidor, UC antiga e UC nova.

    Não preenche o cadastro do José nem atualiza o cache quando encontra uma
    equivalência. Qualquer ambiguidade da planilha continua sendo bloqueio.
    """
    fontes = carregar_fontes_de_identificacao_central(args, app)
    if not fontes:
        return None
    # Impede o fallback original de iniciar uma indexação em background no
    # acervo da Central quando o cache não contém o medidor.
    app.pasta_faturas_antigas = ""
    registro, origem_uc_antiga = app.buscar_medidor_em_antigos(
        identificado_pdf.get("medidor", ""), fontes["indiceMedidores"],
    )
    uc_antiga = app.limpar_numero(registro.get("uc_antiga", "")) if registro else ""
    info = app.obter_info_por_uc(uc_antiga, fontes["mapaUcAntiga"]) if uc_antiga else None
    origem_info = "planilha_uc_antiga" if info else ""
    if not info:
        info = app.obter_info_por_uc(identificado_pdf.get("ucNova", ""), fontes["mapaUcNova"])
        origem_info = "planilha_uc_nova" if info else ""
    if not info or app.info_tem_conflito_uc(info):
        return None
    return {
        "unidadeId": None,
        "ucNova": app.limpar_numero(identificado_pdf.get("ucNova", "")),
        "ucsAntigas": [uc_antiga] if uc_antiga else [app.limpar_numero(info.get("uc_antiga", ""))],
        "cliente": info.get("cliente") or None,
        "usina": info.get("usina") or None,
        "origemIdentificacao": "central",
        "origemUcAntiga": origem_uc_antiga,
        "origemInfo": origem_info,
    }


def resolver_contexto_integrado(args, app, contexto: dict, identificado_pdf: dict) -> dict:
    """Prefere a fonte inequívoca da Central; mantém José como fallback.

    O nome e o carimbo do processamento original são montados a partir do
    cadastro ``uc por usina.xlsx``. Usar primeiro o cadastro resumido do José
    alterava abreviações de cliente/usina e produzia um nome diferente, embora
    a UC fosse a mesma. A fonte da Central só substitui quando a sua própria
    regra de unicidade a considerou segura.
    """
    central = resolver_contexto_pelas_fontes_da_central(args, app, identificado_pdf)
    if central and central["ucNova"] and central["cliente"] and central["usina"]:
        return {
            **contexto,
            **central,
            # O JSON do Gmail preserva a competência da captura; a Central fornece
            # a identidade, não substitui esse metadado.
            "dados": contexto["dados"],
        }
    if contexto["unidadeId"] and contexto["ucNova"] and contexto["cliente"] and contexto["usina"]:
        contexto["origemIdentificacao"] = "jose"
        return contexto
    return contexto


def uc_antiga_para_documento(app, contexto: dict) -> str:
    """Preserva o fallback documental já visível na saída da Central.

    A ausência de uma UC histórica impede localizar uma linha financeira, mas
    não invalida uma fatura cuja UC atual, cliente e usina foram identificados
    de forma única. A Central nomeia esses casos como ``SEM_UC_ANTIGA``;
    reutilizamos o mesmo marcador somente no PDF documental.
    """
    for valor in contexto.get("ucsAntigas") or []:
        uc = app.limpar_numero(valor)
        if uc:
            return uc
    return "SEM_UC_ANTIGA"


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
    normalizar_compacto = lambda valor: re.sub(
        r"[^A-Z0-9]", "", atualizador.normalize_usina_name(valor)
    )
    usina_compacta = normalizar_compacto(usina)
    planilhas = listar_planilhas_restritas(args.pasta_vendas)
    por_nome = tuple(
        planilha for planilha in listar_planilhas_restritas(args.pasta_vendas)
        if (
            usina_normalizada in atualizador.normalize_usina_name(planilha.stem)
            or usina_compacta in normalizar_compacto(planilha.stem)
        )
    )
    # A Central original percorre as planilhas e associa pela UC; por isso
    # rótulos operacionais como ECOSOL não impedem encontrar uma UC que está
    # numa planilha Abadiânia ou São Francisco. O fallback é deliberadamente
    # global, mas a função chamadora exige uma única linha encontrada.
    return por_nome or planilhas


def localizar_linha_planilha(
    args, atualizador, dados: dict, uc_nova: str, ucs_antigas, usina: str,
    mes_faturamento: str = "",
):
    """Exige uma unica planilha, aba e linha antes de liberar o valor da Central."""
    candidatas = candidatas_da_usina(args, atualizador, usina)
    if not candidatas:
        raise RuntimeError("planilha_da_usina_nao_localizada")
    competencia = codigo_competencia(dados, atualizador, mes_faturamento)
    ucs_antigas_normalizadas = {
        atualizador.normalize_uc(uc) for uc in ucs_antigas
        if atualizador.normalize_uc(uc)
    }
    uc_atual = atualizador.normalize_uc(uc_nova)
    localizacoes = []
    for planilha in candidatas:
        # Para rótulos como ECOSOL a Central percorre toda a carteira. O
        # índice abaixo conserva exatamente as colunas C/D e a regra de
        # unicidade original, mas abre cada planilha uma única vez por
        # competência dentro da execução do lote.
        chave_indice = (str(planilha.resolve()).lower(), competencia)
        indice = _INDICE_LINHAS_PLANILHA.get(chave_indice)
        if indice is None:
            workbook = atualizador.load_workbook(planilha, read_only=False, data_only=False)
            try:
                try:
                    aba = atualizador.select_latest_month_sheet(workbook, expected_month=competencia)
                except ValueError as erro_aba:
                    if "aba mensal" in str(erro_aba).lower():
                        _INDICE_LINHAS_PLANILHA[chave_indice] = False
                        continue
                    raise
                worksheet = workbook[aba]
                primeira_linha = atualizador.find_target_table_start(worksheet)
                if primeira_linha is None:
                    _INDICE_LINHAS_PLANILHA[chave_indice] = False
                    continue
                por_antiga, por_nova = {}, {}
                for linha_atual in range(primeira_linha, worksheet.max_row + 1):
                    antiga = atualizador.normalize_uc(worksheet.cell(linha_atual, 3).value)
                    nova = atualizador.normalize_uc(worksheet.cell(linha_atual, 4).value)
                    if antiga:
                        por_antiga.setdefault(antiga, []).append(linha_atual)
                    if nova:
                        por_nova.setdefault(nova, []).append(linha_atual)
                indice = {
                    "aba": aba,
                    "classica": atualizador.is_classic_rateio_sheet(worksheet, primeira_linha),
                    "porAntiga": por_antiga,
                    "porNova": por_nova,
                }
                _INDICE_LINHAS_PLANILHA[chave_indice] = indice
            finally:
                workbook.close()
        if not indice:
            continue
        linhas_nova = indice["porNova"].get(uc_atual, []) if uc_atual else []
        linhas_antiga = {
            linha for uc in ucs_antigas_normalizadas
            for linha in indice["porAntiga"].get(uc, [])
        }
        tentativas = (
            sorted(set(linhas_nova).intersection(linhas_antiga)),
            linhas_nova,
            sorted(linhas_antiga),
        )
        linha = None
        for linhas in tentativas:
            if len(linhas) == 1:
                linha = linhas[0]
                break
            if len(linhas) > 1:
                raise RuntimeError(f"linha_da_uc_ambigua:{len(linhas)}")
        if linha is not None:
            uc_antiga_planilha = next(
                (uc for uc, linhas in indice["porAntiga"].items() if linha in linhas), ""
            )
            localizacoes.append({
                "planilha": str(planilha), "aba": indice["aba"], "linha": linha,
                "classica": indice["classica"],
                "colunaBoleto": 17 if indice["classica"] else 12,
                "ucAntigaPlanilha": uc_antiga_planilha,
            })
    if len(localizacoes) == 1:
        return localizacoes[0]
    if not localizacoes:
        raise RuntimeError("linha_da_uc_ambigua:0")
    raise RuntimeError(f"planilha_da_uc_ambigua:{len(localizacoes)}")


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
        pdf_original, _, _ = ler_pdf_do_gmail(args.banco, documento)
        identificado_pdf = identificar_pdf_gmail_pela_central(app, pdf_original)
        uc_pdf = identificado_pdf["ucNova"]
        mes = identificado_pdf["mes"]
        if not uc_pdf or not mes:
            raise RuntimeError("campos_obrigatorios_nao_extraidos_pela_central")
        contexto = ler_contexto_gmail(
            args.banco, documento, uc_pdf, app.chave_uc(uc_pdf),
        )
        validar_uc_pdf_com_metadado(app, contexto, uc_pdf)
        contexto = resolver_contexto_integrado(args, app, contexto, identificado_pdf)
        if not contexto["ucNova"] or not contexto["cliente"] or not contexto["usina"]:
            raise RuntimeError("vinculo_cadastral_incompleto")
        localizacao = localizar_linha_planilha(
            args, atualizador, contexto["dados"], uc_pdf, contexto["ucsAntigas"],
            contexto["usina"], mes,
        )
        # A Central aceita UCs que ainda não possuem número histórico na
        # planilha: o marcador é documental, não uma condição financeira. A
        # linha já foi confirmada de forma única pela UC atual acima.
        uc_antiga_documento = (
            localizacao["ucAntigaPlanilha"] or uc_antiga_para_documento(app, contexto)
        )
        temporaria, metadados = preparar_fatura_temporaria_da_central(
            app, pdf_original, uc_antiga_documento, contexto["cliente"], contexto["usina"],
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
            "linha": linha, "ucAntiga": uc_antiga_documento, "ucNova": uc_pdf,
            "mesFaturamento": mes,
            "celula": f"{'Q' if classica else 'L'}{linha}",
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
    app = carregar_motor(args.motor)
    atualizador = carregar_modulo("atualizador_central", args.atualizador)
    documentos = [int(valor) for valor in str(args.documentos or args.documento).split(",") if valor.strip()]
    resultados = []
    for documento in documentos:
        contexto = None
        uc_pdf = None
        try:
            pdf_original, _, _ = ler_pdf_do_gmail(args.banco, documento)
            identificado_pdf = identificar_pdf_gmail_pela_central(app, pdf_original)
            uc_pdf = identificado_pdf["ucNova"]
            if not uc_pdf:
                raise RuntimeError("campos_obrigatorios_nao_extraidos_pela_central")
            contexto = ler_contexto_gmail(
                args.banco, documento, uc_pdf, app.chave_uc(uc_pdf),
            )
            validar_uc_pdf_com_metadado(app, contexto, uc_pdf)
            contexto = resolver_contexto_integrado(args, app, contexto, identificado_pdf)
            if not contexto["ucNova"] or not contexto["cliente"] or not contexto["usina"]:
                raise RuntimeError("vinculo_cadastral_incompleto")
            base = {
                "documento": documento, "ucNova": contexto["ucNova"],
                "ucPdf": uc_pdf,
                "cliente": contexto["cliente"], "usina": contexto["usina"],
                "competencia": contexto["dados"].get("competencia") or None,
                "origemIdentificacao": contexto.get("origemIdentificacao"),
                "origemUcAntiga": contexto.get("origemUcAntiga"),
                "origemInfo": contexto.get("origemInfo"),
                "mesFaturamento": identificado_pdf.get("mes") or None,
            }
            try:
                localizacao = localizar_linha_planilha(
                    args, atualizador, contexto["dados"], contexto["ucNova"],
                    contexto["ucsAntigas"], contexto["usina"], identificado_pdf["mes"],
                )
            except Exception as erro_financeiro:
                # A Central ainda pode nomear, carimbar e preparar o PDF para
                # impressão quando não há planilha/linha financeira. O erro
                # fica explícito, mas não apaga a identificação documental.
                resultados.append({
                    **base,
                    "situacao": "identificada",
                    "motivoFinanceiro": str(erro_financeiro),
                })
                continue
            resultados.append({
                **base,
                "situacao": "segura",
                **{chave: valor for chave, valor in localizacao.items() if chave != "classica"},
            })
        except Exception as erro:
            resultado = {"documento": documento, "situacao": "revisar", "motivo": str(erro)}
            if contexto:
                resultado.update({
                    "ucNova": contexto["ucNova"], "ucPdf": uc_pdf,
                    "cliente": contexto["cliente"],
                    "usina": contexto["usina"],
                    "competencia": contexto["dados"].get("competencia") or None,
                    "origemIdentificacao": contexto.get("origemIdentificacao"),
                    "origemUcAntiga": contexto.get("origemUcAntiga"),
                    "origemInfo": contexto.get("origemInfo"),
                })
            elif uc_pdf:
                resultado.update({"ucNova": uc_pdf, "ucPdf": uc_pdf})
            resultados.append(resultado)
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


def processar_isolado(args):
    """Executa o atualizador original somente sobre cópias locais auditáveis.

    A fonte compartilhada de vendas é aberta para leitura pela simulação; a
    cópia é a única passada para process_workbook(), que é a rotina original
    com efeitos (xlsx preenchido, CSV e PDFs carimbados).
    """
    app = carregar_motor(args.motor)
    atualizador = carregar_modulo("atualizador_central", args.atualizador)
    documentos = [int(valor) for valor in str(args.documentos or args.documento).split(",") if valor.strip()]
    if not documentos:
        raise RuntimeError("nenhum_documento_para_processar")
    simulacoes = [simular_documento(args, app, atualizador, documento) for documento in documentos]
    revisar = [s for s in simulacoes if s.get("situacao") != "simulada"]
    if revisar:
        return {"situacao": "revisar", "resultados": simulacoes}
    planilhas = {s["planilha"] for s in simulacoes}
    meses = {s["mesFaturamento"] for s in simulacoes}
    usinas = {s["usina"] for s in simulacoes}
    if len(planilhas) != 1 or len(meses) != 1 or len(usinas) != 1:
        raise RuntimeError("lote_central_exige_mes_planilha_e_usina_unicos")
    documentos_por_uc = {}
    simulacoes_por_uc = {}
    for simulacao in simulacoes:
        uc_nova = simulacao["ucNova"]
        if uc_nova in documentos_por_uc:
            raise RuntimeError("uc_duplicada_no_lote_financeiro")
        documentos_por_uc[uc_nova] = simulacao["documento"]
        simulacoes_por_uc[uc_nova] = simulacao

    raiz = Path(args.diretorio_saida).resolve()
    if raiz.exists():
        raise RuntimeError("diretorio_de_homologacao_ja_existe")
    entrada = raiz / "entrada"
    artefatos = raiz / "artefatos"
    impressao = raiz / "impressao"
    carimbadas = raiz / "pdfs_carimbados"
    entrada.mkdir(parents=True)
    impressao.mkdir(parents=True)
    # ``process_workbook`` recebe este diretório como override e, no caminho
    # de saída longa da Central, pressupõe que ele já exista. Criá-lo na área
    # isolada evita a interrupção antes do carimbo sem tocar na fonte oficial.
    carimbadas.mkdir(parents=True)
    origem_planilha = Path(next(iter(planilhas)))
    copia_planilha = raiz / "planilha_entrada" / origem_planilha.name
    copia_planilha.parent.mkdir(parents=True)
    shutil.copy2(origem_planilha, copia_planilha)

    for simulacao in simulacoes:
        pdf, _, _ = ler_pdf_do_gmail(args.banco, simulacao["documento"])
        temporaria, identificacao = preparar_fatura_temporaria_da_central(
            app, pdf, simulacao["ucAntiga"], simulacao["cliente"], simulacao["usina"],
        )
        try:
            if identificacao["ucNova"] != simulacao["ucNova"] or identificacao["mes"] != simulacao["mesFaturamento"]:
                raise RuntimeError("identificacao_temporaria_divergente")
            # O conteúdo (inclusive o carimbo-base) é a fonte de identificação
            # da Central. O nome de entrada não é; mantê-lo curto evita que o
            # caminho intermediário ultrapasse 260 caracteres antes de a regra
            # original ``criar_nome_saida_seguro`` gerar o nome final.
            shutil.copy2(
                temporaria,
                entrada / f"Fatura EQT - {simulacao['mesFaturamento']} - DOC_{simulacao['documento']}.pdf",
            )
        finally:
            temporaria.unlink(missing_ok=True)

    logs = []
    resultado = atualizador.process_workbook(
        copia_planilha, entrada, atualizador.DEFAULT_TARIFA_TOTAL_KWH, logs.append,
        stamped_root_override=carimbadas,
        artifacts_dir=artefatos,
        updated_workbooks_dir=raiz / "planilha_preenchida",
        expected_usina=next(iter(usinas)), target_month=next(iter(meses)),
    )
    esperados = {s["ucNova"]: s["valorBoleto"] for s in simulacoes}
    divergentes = [
        item for item in resultado.traceability
        if item.get("uc_nova") not in esperados
        or item.get("valor_boleto") != esperados[item.get("uc_nova")]
    ]
    if resultado.pdfs_stamped != len(documentos) or divergentes:
        return {
            "situacao": "revisar", "documentos": documentos,
            "motivos": [
                *([f"processamento_incompleto:{resultado.pdfs_stamped}/{len(documentos)}"] if resultado.pdfs_stamped != len(documentos) else []),
                *(["valor_do_processamento_original_diverge_da_simulacao"] if divergentes else []),
            ],
            "valoresProcessamento": [
                {"ucNova": item.get("uc_nova"), "valor": item.get("valor_boleto")}
                for item in resultado.traceability
            ],
            "logsCentral": logs,
        }
    finais = []
    pasta_finais = raiz / "pdfs_finais"
    pasta_finais.mkdir(parents=True)
    for item in resultado.traceability:
        origem = Path(item["pdf_final"])
        documento = documentos_por_uc.get(item.get("uc_nova"))
        if documento is None:
            raise RuntimeError("rastreabilidade_financeira_sem_documento")
        simulacao = simulacoes_por_uc[item["uc_nova"]]
        base = app.limpar_nome_arquivo(
            f"Fatura EQT - {simulacao['mesFaturamento']} - {simulacao['usina']} - "
            f"{simulacao['cliente']} - {simulacao['ucAntiga']} - {simulacao['ucNova']}"
        )
        # A própria função da Central preserva UCs e aplica o mesmo hash quando
        # o nome excede o limite do caminho. O resultado de process_workbook é
        # somente a origem carimbada; a nomeação final ocorre aqui com a regra
        # original, sem reaproveitar o sufixo técnico temporário ``__DOC_*``.
        final = pasta_finais / app.criar_nome_saida_seguro(base, str(pasta_finais))
        shutil.copy2(origem, final)
        preparado = app.preparar_pdf_a4_para_impressao(str(final))
        try:
            destino_impressao = impressao / final.name
            shutil.copy2(preparado, destino_impressao)
        finally:
            Path(preparado).unlink(missing_ok=True)
        finais.append({
            **item, "documento": documento, "nomeFinal": final.name,
            "pdf_final": str(final), "pdf_impressao": str(destino_impressao),
        })
    return {
        "situacao": "concluido", "documentos": documentos,
        "planilhaFonte": str(origem_planilha), "planilhaPreenchida": str(resultado.output_path),
        "log": str(resultado.log_path), "pdfs": finais, "logsCentral": logs,
    }


def processar_documental_isolado(args):
    """Nomeia, carimba internamente e prepara A4 sem planilha nem boleto."""
    if args.documentos:
        documentos = [int(valor) for valor in args.documentos.split(",") if valor.strip()]
    else:
        documentos = [args.documento]
    raiz = Path(args.diretorio_saida).resolve()
    if raiz.exists():
        raise RuntimeError("diretorio_de_homologacao_ja_existe")
    app = carregar_motor(args.motor)
    finais = []
    pendencias = []
    for documento in documentos:
        try:
            pdf, nome_original, _ = ler_pdf_do_gmail(args.banco, documento)
            identificado_pdf = identificar_pdf_gmail_pela_central(app, pdf)
            uc_pdf = identificado_pdf["ucNova"]
            if not uc_pdf:
                raise RuntimeError("campos_obrigatorios_nao_extraidos_pela_central")
            contexto = ler_contexto_gmail(
                args.banco, documento, uc_pdf, app.chave_uc(uc_pdf),
            )
            validar_uc_pdf_com_metadado(app, contexto, uc_pdf)
            contexto = resolver_contexto_integrado(args, app, contexto, identificado_pdf)
            if not contexto["ucNova"] or not contexto["cliente"] or not contexto["usina"]:
                raise RuntimeError("vinculo_cadastral_incompleto")
            uc_antiga = uc_antiga_para_documento(app, contexto)
            temporaria, identificado = preparar_fatura_temporaria_da_central(
                app, pdf, uc_antiga, contexto["cliente"], contexto["usina"],
            )
            try:
                if identificado["ucNova"] != contexto["ucNova"]:
                    raise RuntimeError("uc_pdf_diverge_do_vinculo_cadastral")
                pasta_final = raiz / "pdfs_finais"
                pasta_impressao = raiz / "impressao"
                pasta_final.mkdir(parents=True, exist_ok=True)
                pasta_impressao.mkdir(parents=True, exist_ok=True)
                base = app.limpar_nome_arquivo(
                    f"Fatura EQT - {identificado['mes']} - {contexto['usina']} - {contexto['cliente']} - "
                    f"{uc_antiga} - {identificado['ucNova']}"
                )
                nome_final = app.criar_nome_saida_seguro(base, str(pasta_final))
                destino = pasta_final / nome_final
                shutil.copy2(temporaria, destino)
                preparado = app.preparar_pdf_a4_para_impressao(str(destino))
                try:
                    destino_impressao = pasta_impressao / nome_final
                    shutil.copy2(preparado, destino_impressao)
                finally:
                    Path(preparado).unlink(missing_ok=True)
                finais.append({
                    "documento": documento, "nomeOriginal": nome_original,
                    "nomeFinal": nome_final, "ucAntiga": uc_antiga,
                    "ucNova": identificado["ucNova"], "mesFaturamento": identificado["mes"],
                    "cliente": contexto["cliente"], "usina": contexto["usina"],
                    "pdf_final": str(destino), "pdf_impressao": str(destino_impressao),
                })
            finally:
                temporaria.unlink(missing_ok=True)
        except Exception as erro:
            # A homologação documental é independente por PDF: uma UC sem
            # evidência não impede que os demais arquivos do mesmo lote sejam
            # carimbados e preparados para impressão simulada.
            pendencias.append({"documento": documento, "motivo": str(erro)})
            continue
    return {
        "situacao": "concluido" if finais else "revisar",
        "modo": "documental", "documentos": documentos,
        "pdfs": finais, "pendencias": pendencias,
    }


if __name__ == "__main__":
    try:
        argumentos_execucao = argumentos()
        if argumentos_execucao.somente_localizar:
            resultado = localizar_documentos(argumentos_execucao)
        elif argumentos_execucao.simular:
            resultado = simular_documentos(argumentos_execucao)
        elif argumentos_execucao.processar_isolado:
            resultado = processar_isolado(argumentos_execucao)
        elif argumentos_execucao.processar_documental_isolado:
            resultado = processar_documental_isolado(argumentos_execucao)
        else:
            resultado = gerar_previa(argumentos_execucao)
        print(json.dumps(resultado, ensure_ascii=False))
    except Exception as erro:
        print(json.dumps({"erro": str(erro)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
