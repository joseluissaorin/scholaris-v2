"""Bibliotecas como objetos sociales con el SDK, contra un Scholaris local con dos personas.

    SCHOLARIS_USUARIOS="token-a-123456:ana:ana@casa.es:Ana;token-b-123456:luis:luis@casa.es:Luis" pnpm --filter @scholaris/local start
    SCHOLARIS_URL=http://localhost:8790 SCHOLARIS_TOKEN_A=token-a-123456 SCHOLARIS_TOKEN_B=token-b-123456 pytest tests/v2/test_bibliotecas.py
"""
import os
import zipfile

import pytest

from scholaris.v2 import Scholaris

URL = os.environ.get("SCHOLARIS_URL")
A, B = os.environ.get("SCHOLARIS_TOKEN_A"), os.environ.get("SCHOLARIS_TOKEN_B")
pytestmark = pytest.mark.skipif(not (URL and A and B), reason="Define SCHOLARIS_URL, SCHOLARIS_TOKEN_A y SCHOLARIS_TOKEN_B")


def test_llenar_compartir_copiar_y_paquete(tmp_path):
    ana, luis = Scholaris(URL, A), Scholaris(URL, B)
    bib = ana.crear_biblioteca("Desde Python")
    (tmp_path / "uno.md").write_text("# Uno\n\nLa memoria colectiva y los archivos.", encoding="utf-8")
    (tmp_path / "dos.md").write_text("# Dos\n\nEl olvido como forma de la memoria.", encoding="utf-8")
    est = ana.estimar_lote([str(tmp_path / "uno.md"), str(tmp_path / "dos.md")])
    assert est["elementos"] == 2
    lote = ana.llenar([str(tmp_path)], biblioteca=bib["id"], concurrencia=2)
    assert lote["estado"] == "terminado"
    assert lote["cuentas"].get("listo", 0) + lote["cuentas"].get("duplicado", 0) == 2

    inv = ana.invitar(bib["id"], "luis@casa.es", "lectura", mensaje="Para el seminario")
    assert inv["estado"] == "pendiente"
    pendiente = next(i for i in luis.invitaciones() if i["biblioteca"] == bib["id"])
    luis.aceptar(pendiente["id"])
    assert luis.compartida(bib["id"]).pedir("GET", "/documentos")["total"] == 2
    assert any(not r["origen"]["propia"] for r in luis.buscar_conjunta("memoria", alcance="seguidas"))
    copia = luis.copiar(biblioteca=bib["id"])
    assert len(copia["copiados"]) + len(copia["repetidos"]) == 2

    destino = tmp_path / "desde-python.scholaris"
    ana.exportar_paquete(bib["id"], str(destino), originales=False)
    with zipfile.ZipFile(destino) as z:
        assert "manifest.json" in z.namelist()
    imp = luis.importar_paquete(str(destino), nombre="Paquete de Ana")
    assert not imp["fallidos"]
    luis.dejar_de_seguir(bib["id"])
