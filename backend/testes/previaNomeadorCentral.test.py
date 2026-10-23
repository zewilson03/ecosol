"""Regressão da competência de venda usada na prévia Gmail/Central."""

import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace


ADAPTADOR = Path(__file__).resolve().parents[1] / "scripts" / "previaNomeadorCentral.py"
ESPEC = importlib.util.spec_from_file_location("previa_nomeador_central", ADAPTADOR)
MODULO = importlib.util.module_from_spec(ESPEC)
assert ESPEC and ESPEC.loader
ESPEC.loader.exec_module(MODULO)


class AtualizadorCentralFalso:
    @staticmethod
    def month_code_from_sheet(nome):
        return {"nov": "NOV", "novembro": "NOV", "outubro": "OUT"}.get(
            str(nome).lower(), ""
        )

    @staticmethod
    def cell_to_decimal(valor):
        return str(valor)


class CompetenciaDaPreviaTest(unittest.TestCase):
    def test_mes_de_vencimento_da_central_prevalece_sobre_competencia_de_consumo(self):
        self.assertEqual(
            MODULO.codigo_competencia(
                {"competencia": "2026-10"}, AtualizadorCentralFalso(), "NOV"
            ),
            "NOV",
        )

    def test_competencia_de_consumo_permanece_fallback_para_localizacao_sem_pdf(self):
        self.assertEqual(
            MODULO.codigo_competencia(
                {"competencia": "2026-10"}, AtualizadorCentralFalso()
            ),
            "OUT",
        )

    def test_simulacao_rejeita_tarifa_padrao_quando_pdf_nao_a_informa(self):
        with self.assertRaisesRegex(RuntimeError, "dados_financeiros_pdf_incompletos"):
            MODULO.validar_dados_financeiros_da_fatura(
                SimpleNamespace(
                    energia_injetada=249,
                    tarifa_total_kwh=1.159099,
                    total_pagar=39.90,
                    observacao="tarifa_total_kwh_usou_padrao",
                )
            )

    def test_previa_consume_apenas_valor_resultante_da_simulacao_da_central(self):
        self.assertEqual(
            MODULO.valor_boleto_da_simulacao(
                {"situacao": "simulada", "valorBoleto": "262,13"},
                AtualizadorCentralFalso(),
            ),
            "262.13",
        )
        self.assertEqual(
            MODULO.valor_boleto_da_simulacao(
                {"situacao": "simulada", "valorBoleto": "7.559,70"},
                AtualizadorCentralFalso(),
            ),
            "7559.70",
        )

    def test_previa_e_bloqueada_quando_simulacao_exige_revisao(self):
        with self.assertRaisesRegex(RuntimeError, "previa_bloqueada_para_revisao"):
            MODULO.valor_boleto_da_simulacao(
                {"situacao": "revisar", "motivos": ["dados_planilha_divergentes"]},
                AtualizadorCentralFalso(),
            )

    def test_formula_sem_cache_e_tratada_como_entrada_nao_materializada(self):
        self.assertTrue(
            MODULO.entrada_financeira_nao_materializada("=1.146179+0.01292")
        )
        self.assertFalse(MODULO.entrada_financeira_nao_materializada(1.159099))


if __name__ == "__main__":
    unittest.main()
