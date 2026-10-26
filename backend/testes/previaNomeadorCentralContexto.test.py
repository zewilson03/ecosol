import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


ADAPTADOR = Path(__file__).parents[1] / "scripts" / "previaNomeadorCentral.py"
SPEC = importlib.util.spec_from_file_location("previa_nomeador_central", ADAPTADOR)
MODULO = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULO)


class ContextoDaCentralTest(unittest.TestCase):
    def criar_banco(self, unidades):
        arquivo = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        arquivo.close()
        caminho = Path(arquivo.name)
        banco = sqlite3.connect(caminho)
        banco.executescript(
            """
            CREATE TABLE faturamento_documentos (
              id INTEGER PRIMARY KEY,nome TEXT,dados TEXT,classificacao TEXT,
              finalidade TEXT,excluido_em TEXT
            );
            CREATE TABLE faturamento_unidades (
              id INTEGER PRIMARY KEY,uc TEXT,cliente_id INTEGER,
              cliente_operacional_id INTEGER,cliente_provisorio_id INTEGER,usina_id INTEGER
            );
            CREATE TABLE faturamento_unidades_aliases (unidade_id INTEGER,uc TEXT);
            CREATE TABLE customers (id INTEGER PRIMARY KEY,name TEXT);
            CREATE TABLE faturamento_clientes_operacionais (id INTEGER PRIMARY KEY,nome TEXT);
            CREATE TABLE faturamento_clientes_provisorios (id INTEGER PRIMARY KEY,nome TEXT);
            CREATE TABLE usinas (id INTEGER PRIMARY KEY,nome TEXT);
            INSERT INTO faturamento_clientes_operacionais VALUES (1,'Cliente de teste');
            INSERT INTO usinas VALUES (1,'ROYER');
            """
        )
        banco.execute(
            "INSERT INTO faturamento_documentos VALUES (1,'fatura.pdf',?,'triagem','cobranca',NULL)",
            (json.dumps({"uc": "55341301212"}),),
        )
        for identificador, uc in unidades:
            banco.execute(
                "INSERT INTO faturamento_unidades VALUES (?,?,NULL,1,NULL,1)",
                (identificador, uc),
            )
        banco.commit()
        banco.close()
        return caminho

    def test_usa_chave_da_central_sem_perder_evidencia_com_zeros(self):
        caminho = self.criar_banco([(1, "55341301212")])
        try:
            contexto = MODULO.ler_contexto_gmail(
                str(caminho), 1, "000055341301212", "55341301212",
            )
            self.assertEqual(contexto["ucNova"], "55341301212")
            self.assertEqual(contexto["cliente"], "Cliente de teste")
            self.assertEqual(contexto["usina"], "ROYER")
        finally:
            caminho.unlink(missing_ok=True)

    def test_bloqueia_equivalencia_ambigua(self):
        caminho = self.criar_banco([(1, "55341301212"), (2, "000055341301212")])
        try:
            with self.assertRaisesRegex(RuntimeError, "vinculo_cadastral_ambiguo:2"):
                MODULO.ler_contexto_gmail(
                    str(caminho), 1, "000055341301212", "55341301212",
                )
        finally:
            caminho.unlink(missing_ok=True)

    def test_recupera_uc_historica_pelo_cache_e_mapa_originais_da_central(self):
        class MotorDaCentral:
            def limpar_numero(self, valor):
                return "".join(caractere for caractere in str(valor or "") if caractere.isdigit())

            def chave_uc(self, valor):
                return self.limpar_numero(valor).lstrip("0")

            def buscar_medidor_em_antigos(self, medidor, indice):
                return indice.get(medidor), "cache"

            def obter_info_por_uc(self, uc, mapa):
                return mapa.get(self.limpar_numero(uc)) or mapa.get(self.chave_uc(uc))

            def info_tem_conflito_uc(self, info):
                return bool(info and info.get("__conflito_uc_duplicada"))

        fontes = {
            "indiceMedidores": {"135878918": {"uc_antiga": "10016889892"}},
            "mapaUcAntiga": {
                "10016889892": {
                    "uc_antiga": "10016889892", "uc_nova": "",
                    "cliente": "Cliente Central", "usina": "NEOVOLTS",
                },
            },
            "mapaUcNova": {},
        }
        original = MODULO.carregar_fontes_de_identificacao_central
        MODULO.carregar_fontes_de_identificacao_central = lambda _args, _app: fontes
        try:
            contexto = MODULO.resolver_contexto_pelas_fontes_da_central(
                SimpleNamespace(), MotorDaCentral(),
                {"ucNova": "315903301205", "medidor": "135878918"},
            )
        finally:
            MODULO.carregar_fontes_de_identificacao_central = original
        self.assertEqual(contexto["ucNova"], "315903301205")
        self.assertEqual(contexto["ucsAntigas"], ["10016889892"])
        self.assertEqual(contexto["origemUcAntiga"], "cache")
        self.assertEqual(contexto["origemInfo"], "planilha_uc_antiga")

    def test_nao_aceita_mapa_da_central_com_conflito(self):
        class MotorDaCentral:
            limpar_numero = staticmethod(lambda valor: "".join(c for c in str(valor or "") if c.isdigit()))
            chave_uc = staticmethod(lambda valor: str(valor or "").lstrip("0"))
            buscar_medidor_em_antigos = staticmethod(lambda _m, _i: (None, "nao_encontrado"))
            obter_info_por_uc = staticmethod(lambda _u, mapa: mapa.get("nova"))
            info_tem_conflito_uc = staticmethod(lambda info: bool(info and info.get("__conflito_uc_duplicada")))

        original = MODULO.carregar_fontes_de_identificacao_central
        MODULO.carregar_fontes_de_identificacao_central = lambda _args, _app: {
            "indiceMedidores": {}, "mapaUcAntiga": {},
            "mapaUcNova": {"nova": {"__conflito_uc_duplicada": True}},
        }
        try:
            contexto = MODULO.resolver_contexto_pelas_fontes_da_central(
                SimpleNamespace(), MotorDaCentral(), {"ucNova": "123", "medidor": ""},
            )
        finally:
            MODULO.carregar_fontes_de_identificacao_central = original
        self.assertIsNone(contexto)


if __name__ == "__main__":
    unittest.main()
