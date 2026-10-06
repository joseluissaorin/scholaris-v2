"""Cliente de la API v2 contra un Scholaris de verdad (local o preview).

    SCHOLARIS_URL=http://localhost:8790 [SCHOLARIS_CLAVE=sch_…] pytest tests/v2/test_api.py
"""
import os
from pathlib import Path

import pytest

from scholaris.v2 import SPDF, Scholaris

URL = os.environ.get("SCHOLARIS_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Define SCHOLARIS_URL para probar contra un servidor")


def test_extremo_a_extremo(tmp_path):
    s = Scholaris(URL)
    assert s.config()["version"]
    assert s.yo()["usuario"]["id"]
    pdf = Path(os.environ.get("SCHOLARIS_PDF", "../../bench/datos/originales/attention_2017.pdf"))
    doc = s.subir(str(pdf))
    assert doc["estado"] == "listo"
    r = s.buscar("scaled dot-product attention", k=3)
    assert r and "p." in r[0]["citaCorta"]
    destino = tmp_path / "doc.spdf"
    s.descargar_spdf(doc["id"], str(destino))
    with SPDF.abrir(str(destino)) as f:
        assert f.buscar("attention")
    v = s.verificar("The Transformer dispenses with recurrence and convolutions entirely.")
    assert v["veredicto"] in ("respaldada", "parcial")
    resp = s.respuesta("What is multi-head attention?")
    assert resp["texto"]
