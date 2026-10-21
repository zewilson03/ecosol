"""Oráculo somente leitura: extrai funções puras via AST, sem importar a Central.

Entrada JSON stdin: fonte + casos. Saída: resultados e SHA256 da fonte utilizada.
Não instancia interface, openpyxl, banco, arquivos operacionais ou grava saídas.
"""
import ast
import hashlib
import json
import sys
from decimal import Decimal, InvalidOperation, getcontext, ROUND_HALF_EVEN
from collections import namedtuple
from pathlib import Path

entrada = json.load(sys.stdin)
conteudo = Path(entrada["fonte"]).read_bytes()
arvore = ast.parse(conteudo.decode("utf-8-sig"))
nomes = {"cell_to_decimal", "calculate_boleto", "decimal_to_br_text"}
funcoes = [n for n in arvore.body if isinstance(n, ast.FunctionDef) and n.name in nomes]
assert len(funcoes) == len(nomes)
# Execução isolada somente das três funções, com contexto Decimal explícito.
getcontext().prec = 28
getcontext().rounding = ROUND_HALF_EVEN
escopo = {"Decimal": Decimal, "InvalidOperation": InvalidOperation}
modulo = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)] + funcoes, type_ignores=[])
exec(compile(ast.fix_missing_locations(modulo), "<funcoes-central>", "exec"), escopo)
processamento = next(n for n in arvore.body if isinstance(n, ast.FunctionDef) and n.name == "process_workbook")
atribuicoes = [n for n in ast.walk(processamento) if isinstance(n, ast.Assign)
              and any(isinstance(t, ast.Name) and t.id in {"pix_adjustment", "boleto"} for t in n.targets)]
assert len(atribuicoes) == 2
trecho_pix = compile(ast.fix_missing_locations(ast.Module(body=atribuicoes, type_ignores=[])), "<pix-central>", "exec")
Adjustment = namedtuple("Adjustment", "row value")

class Celula:
    def __init__(self, valor):
        self.value = valor

class Planilha:
    def __init__(self, valores):
        self.valores = valores

    def cell(self, row, column):
        return Celula(self.valores.get(chr(64 + column)))

resultados = []
for caso in entrada["casos"]:
    if caso.get("celulas") is None:
        continue
    valor = escopo["calculate_boleto"](Planilha(caso["celulas"]), 1, caso["modelo"] == "classico")
    # Executa as atribuições PIX extraídas do fonte. Elegibilidade/ledger não são
    # simulados: os ajustes desta referência já são disponíveis e não consumidos.
    escopo.update(boleto_base=valor, adjustment_rows={Adjustment(i, Decimal(v)) for i, v in enumerate(caso.get("pix", []))})
    exec(trecho_pix, escopo)
    valor = escopo["boleto"]
    resultados.append({"id": caso["id"], "bruto": str(valor), "esperado": escopo["decimal_to_br_text"](valor, 2)})
print(json.dumps({"sha256": hashlib.sha256(conteudo).hexdigest(), "resultados": resultados}))
