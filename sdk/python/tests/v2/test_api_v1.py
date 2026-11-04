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


def test_cita_literal_usa_el_pasaje_y_no_el_fragmento():
    p = {"texto": "Mirad: este es el bastidor. Un pie salía del caos. Nadie dijo nada.", "pasaje": "Un pie salía del caos.", "cita": "(Balzac, 1837, p. 21)"}
    assert Scholaris.cita_literal(p) == "«Un pie salía del caos.» (Balzac, 1837, p. 21)"
    assert Scholaris.cita_literal({"texto": "Solo el fragmento.", "cita": "(X, 2000, p. 1)"}) == "«Solo el fragmento.» (X, 2000, p. 1)"


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


def test_comprension_por_la_v1():
    mapa = {"documento": "d1", "estado": {"estado": "hecho", "lentes": ["cine"]}, "segmentos": [], "global": [], "totales": {"fichas": 3}}
    f = SesionFalsa([Respuesta(200, mapa), Respuesta(200, {"elementos": [{"rol": "visible"}], "total": 1}), Respuesta(202, {"documento": "d1", "instancia": "cmp-d1-x", "estado": "pendiente"}), Respuesta(202, {"encolados": 4, "lanzados": 2})])
    s = Scholaris("sch_prueba", base="https://ejemplo.es", sesion=f)
    assert s.comprension("d1")["estado"]["lentes"] == ["cine"]
    assert s.apariciones("d1", rol="visible")["total"] == 1
    assert s.comprender("d1", forzar=True, lentes=["cine", "documental"])["instancia"] == "cmp-d1-x"
    assert s.comprender(documentos=["d1", "d2"])["lanzados"] == 2
    rutas = [(m, u) for m, u, _ in f.pedidas]
    assert rutas == [("GET", "https://ejemplo.es/api/v1/documentos/d1/comprension"), ("GET", "https://ejemplo.es/api/v1/documentos/d1/apariciones"),
                     ("POST", "https://ejemplo.es/api/v1/documentos/d1/comprender"), ("POST", "https://ejemplo.es/api/v1/comprender")]
    assert f.pedidas[1][2]["params"] == {"rol": "visible", "desde": 0, "limite": 500}
    assert f.pedidas[2][2]["json"] == {"forzar": True, "lentes": ["cine", "documental"]}
    assert f.pedidas[3][2]["json"] == {"documentos": ["d1", "d2"]}


def test_relaciones_y_alineaciones_por_la_v1():
    rel = {"id": "rel-1", "origen": "d1", "destino": "d2", "tipo": "adaptacion_de", "otro": {"id": "d2", "titulo": "Cuento"}, "sentido": "origen", "alineaciones": 3, "confirmada": False}
    f = SesionFalsa([Respuesta(200, [rel]), Respuesta(200, {"elementos": [{"tipo": "suprimido"}], "total": 1}), Respuesta(201, {**rel, "confirmada": True}),
                     Respuesta(200, {"borrada": True}), Respuesta(202, {"instancia": "tmd-x", "relaciones": 1}), Respuesta(202, {"instancia": "tmd-y", "relaciones": 4})])
    s = Scholaris("sch_prueba", base="https://ejemplo.es", sesion=f)
    assert s.relaciones("d1")[0]["tipo"] == "adaptacion_de"
    assert s.alineaciones("rel-1", tipo="suprimido")["total"] == 1
    assert s.relacionar("d1", "d2", "adaptacion_de", nota="Créditos")["confirmada"] is True
    assert s.rechazar_relacion("rel-1")["borrada"] is True
    assert s.alinear("d1", forzar=True)["instancia"] == "tmd-x"
    assert s.alinear(documentos=["d1"], solo_detectar=True)["relaciones"] == 4
    rutas = [(m, u) for m, u, _ in f.pedidas]
    assert rutas == [("GET", "https://ejemplo.es/api/v1/documentos/d1/relaciones"), ("GET", "https://ejemplo.es/api/v1/relaciones/rel-1/alineaciones"),
                     ("POST", "https://ejemplo.es/api/v1/relaciones"), ("DELETE", "https://ejemplo.es/api/v1/relaciones/rel-1"),
                     ("POST", "https://ejemplo.es/api/v1/documentos/d1/alinear"), ("POST", "https://ejemplo.es/api/v1/transmedia")]
    assert f.pedidas[2][2]["json"] == {"origen": "d1", "destino": "d2", "tipo": "adaptacion_de", "nota": "Créditos"}
    assert f.pedidas[4][2]["json"] == {"forzar": True}
    assert f.pedidas[5][2]["json"] == {"documentos": ["d1"], "alinear": False}


def test_alineaciones_de_la_v2_pasan_de_pagina():
    from scholaris.v2 import Scholaris as V2

    f = SesionFalsa([Respuesta(200, {"elementos": [{"id": "a1"}], "total": 2, "siguiente": "1"}), Respuesta(200, {"elementos": [{"id": "a2"}], "total": 2})])
    s = V2("https://ejemplo.es", clave="sch_prueba", sesion=f)
    assert [x["id"] for x in s.alineaciones("rel-1")] == ["a1", "a2"]
    assert f.pedidas[1][1] == "https://ejemplo.es/api/v2/relaciones/rel-1/alineaciones"

def test_revisar_la_transcripcion_por_la_v1(tmp_path):
    rev = {"documento": "d1", "version": "revision-1", "cobertura": {"huecos": []}, "correcciones": [{"tipo": "hueco"}]}
    ruta = tmp_path / "revision.json"
    ruta.write_text(json.dumps(rev), encoding="utf-8")
    f = SesionFalsa([
        Respuesta(202, {"documento": "d1", "tarea": "t1", "lanzada": True}),
        Respuesta(200, {"documento": "d1", "aplicada": "2026-11-04T10:00:00Z", "correcciones": {"huecos": 1}}),
        Respuesta(200, {"lanzada": False, "usd": 3.2, "documentos": []}),
        Respuesta(200, {"lanzada": False, "usd": 5.1, "documentos": []}),
    ])
    s = Scholaris("sch_prueba", base="https://ejemplo.es", sesion=f)
    assert s.revisar_transcripcion("d1", revision=str(ruta))["tarea"] == "t1"
    metodo, url, k = f.pedidas[0]
    assert (metodo, url) == ("POST", "https://ejemplo.es/api/v1/documentos/d1/transcripcion/revisar")
    assert k["json"] == {"revision": rev}
    assert s.revision_transcripcion("d1")["aplicada"]
    assert f.pedidas[1][1] == "https://ejemplo.es/api/v1/documentos/d1/transcripcion/revision"
    assert s.revisar_transcripciones(presupuesto_usd=4)["usd"] == 3.2
    assert f.pedidas[2][2]["json"] == {"presupuestoUsd": 4}
    assert s.percibir_medios(["d1", "d2"], confirmar=True)["usd"] == 5.1
    assert (f.pedidas[3][1], f.pedidas[3][2]["json"]) == ("https://ejemplo.es/api/v1/medios/percibir", {"documentos": ["d1", "d2"], "confirmar": True})


def test_fichas_de_la_v2_pasan_de_pagina():
    from scholaris.v2 import Scholaris as V2

    f = SesionFalsa([Respuesta(200, {"elementos": [{"id": "f1"}], "total": 2, "siguiente": "1"}), Respuesta(200, {"elementos": [{"id": "f2"}], "total": 2})])
    s = V2("https://ejemplo.es", clave="sch_prueba", sesion=f)
    assert [x["id"] for x in s.fichas("d1", clase="escena")] == ["f1", "f2"]
    assert f.pedidas[1][1] == "https://ejemplo.es/api/v2/documentos/d1/fichas"
    assert f.pedidas[1][2]["params"] == {"clase": "escena", "desde": 1, "limite": 500}


@pytest.mark.skipif(not os.environ.get("SCHOLARIS_URL"), reason="Define SCHOLARIS_URL para probar contra un servidor")
def test_de_verdad():
    s = Scholaris(base=os.environ["SCHOLARIS_URL"])
    d = s.subir(os.environ.get("SCHOLARIS_PDF", "../../bench/datos/originales/cortazar1959perseguidor.pdf"))
    assert d["estado"] == "listo"
    assert s.buscar("la música me metía en el tiempo", k=1)[0]["localizador"].startswith("p")
    assert s.verificar("Johnny Carter dice que la música lo mete en el tiempo.")["veredicto"] in ("respaldada", "parcial")
