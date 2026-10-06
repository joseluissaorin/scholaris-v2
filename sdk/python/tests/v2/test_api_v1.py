"""Fachada de la API v1 (scholaris.api) sin red: una sesión de requests falsa.

Contra un servidor de verdad: SCHOLARIS_URL=http://localhost:8790 pytest tests/v2/test_api_v1.py
"""
import json
import os

import pytest

from scholaris.api import ErrorScholaris, Scholaris


class Respuesta:
    def __init__(self, estado, cuerpo, tipo="application/json"):
        self.status_code, self._cuerpo = estado, cuerpo
        self.headers = {"content-type": tipo}
        self.text = cuerpo if isinstance(cuerpo, str) else json.dumps(cuerpo)
        self.content = self.text.encode()

    def json(self):
        return self._cuerpo if not isinstance(self._cuerpo, str) else json.loads(self._cuerpo)


class SesionFalsa:
    def __init__(self, respuestas):
        self.respuestas, self.pedidas = list(respuestas), []

    def request(self, metodo, url, **k):
        self.pedidas.append((metodo, url, k))
        return self.respuestas.pop(0)


def test_buscar_manda_la_clave_y_devuelve_los_pasajes():
    f = SesionFalsa([Respuesta(200, {"consulta": "x", "pasajes": [{"cita": "(Darwin, 1859, p. 81)"}], "ms": 3})])
    s = Scholaris("sch_prueba", base="https://ejemplo.es/", sesion=f)
    assert s.buscar("x", k=3, documentos=["d1", "d2"])[0]["cita"] == "(Darwin, 1859, p. 81)"
    metodo, url, k = f.pedidas[0]
    assert (metodo, url) == ("GET", "https://ejemplo.es/api/v1/buscar")
    assert k["headers"]["authorization"] == "Bearer sch_prueba"
    assert k["params"] == {"q": "x", "k": 3, "documento": "d1,d2"}


def test_subir_una_url_va_como_json():
    f = SesionFalsa([Respuesta(201, {"id": "d1", "estado": "listo"})])
    s = Scholaris("sch_prueba", base="https://ejemplo.es", sesion=f)
    assert s.subir("https://ejemplo.es/articulo", titulo="Artículo")["estado"] == "listo"
    _, _, k = f.pedidas[0]
    assert k["json"] == {"url": "https://ejemplo.es/articulo", "titulo": "Artículo"}


def test_los_errores_traen_las_dos_lenguas():
    f = SesionFalsa([Respuesta(403, {"error": {"codigo": "prohibido", "mensaje": "Esta clave de API es de solo lectura.", "message": "This key is not allowed to do that.", "estado": 403}})])
    s = Scholaris("sch_prueba", base="https://ejemplo.es", sesion=f)
    with pytest.raises(ErrorScholaris) as e:
        s.borrar("d1")
    assert e.value.codigo == "prohibido" and e.value.estado == 403 and e.value.message.startswith("This key")


@pytest.mark.skipif(not os.environ.get("SCHOLARIS_URL"), reason="Define SCHOLARIS_URL para probar contra un servidor")
def test_de_verdad():
    s = Scholaris(base=os.environ["SCHOLARIS_URL"])
    d = s.subir(os.environ.get("SCHOLARIS_PDF", "../../bench/datos/originales/cortazar1959perseguidor.pdf"))
    assert d["estado"] == "listo"
    assert s.buscar("la música me metía en el tiempo", k=1)[0]["localizador"].startswith("p")
    assert s.verificar("Johnny Carter dice que la música lo mete en el tiempo.")["veredicto"] in ("respaldada", "parcial")
