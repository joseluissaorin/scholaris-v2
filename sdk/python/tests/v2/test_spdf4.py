"""SPDF 4.0 sin conexión: el fichero de pruebas lo genera el escritor de TypeScript
(apps/api/scripts/fixtura-spdf-python.ts), así que esto comprueba la compatibilidad."""
from pathlib import Path

import pytest

from scholaris.v2 import SPDF, ErrorSPDF, ancla_a_cita

FIXTURA = Path(__file__).parent.parent / "datos" / "mini.v4.spdf"


def test_abre_y_lee_documento():
    with SPDF.abrir(str(FIXTURA)) as s:
        assert s.claves()["spdf_version"].startswith("4")
        d = s.documento
        assert d["metadatos"]["titulo"] == "Don Quijote"
        us = s.unidades()
        assert [u.orden for u in us] == [0, 1, 2]
        assert us[0].etiqueta == "p. [1]"
        assert us[1].etiqueta == "p. 23"
        assert s.pagina("24").texto.startswith("Una olla")
        assert s.original() == b"%PD"


def test_busqueda_lexica_con_cita():
    with SPDF.abrir(str(FIXTURA)) as s:
        r = s.buscar("rocin")  # sin acento: FTS5 con remove_diacritics
        assert r and r[0].id == "f1"
        assert r[0].cita == "(Cervantes Saavedra, 1605, p. 23)"


def test_busqueda_vectorial():
    with SPDF.abrir(str(FIXTURA)) as s:
        assert [e["id"] for e in s.espacios()] == ["prueba@4"]
        r = s.buscar_vector([0, 1, 0, 0], "prueba@4", k=1)
        assert r[0].id == "f2"


def test_rechaza_lo_que_no_es_spdf(tmp_path):
    malo = tmp_path / "malo.spdf"
    import sqlite3
    c = sqlite3.connect(malo)
    c.execute("create table pages (x)")
    c.close()
    with pytest.raises(ErrorSPDF, match="v3"):
        SPDF.abrir(str(malo))


def test_anclas():
    assert ancla_a_cita({"tipo": "tiempo", "t0": 3725, "t1": 3800}) == "1:02:05"
    assert ancla_a_cita({"tipo": "pagina", "fisica": 3, "impresa": "x"}, {"tipo": "pagina", "fisica": 4, "impresa": "xi"}) == "pp. x-xi"
    assert ancla_a_cita({"tipo": "diapositiva", "n": 7}) == "diap. 7"
