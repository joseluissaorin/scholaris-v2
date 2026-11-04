"""El agente de investigación en el SDK, sin servidor: una sesión falsa que responde con SSE."""
import json

import pytest

from scholaris.v2 import Scholaris
from scholaris.v2.api import ErrorApi


class _Respuesta:
    def __init__(self, eventos, estado=200):
        self.status_code = estado
        self._lineas = []
        for e in eventos:
            self._lineas += [f"event: {e['tipo']}", f"data: {json.dumps(e, ensure_ascii=False)}", ""]
        self.content = b"x"

    def iter_lines(self, decode_unicode=True):
        yield from self._lineas


class _Sesion:
    def __init__(self, eventos):
        self.eventos, self.peticiones = eventos, []

    def request(self, metodo, url, **kw):
        self.peticiones.append((metodo, url, kw))
        return _Respuesta(self.eventos)


EVENTOS = [
    {"tipo": "inicio", "id": "inv1", "modelo": "gemini-4-argon", "presupuesto": {"pasos": 16, "segundos": 210, "usd": 0.75}},
    {"tipo": "plan", "plan": {"enfoque": "Comparar.", "documentos": [], "subpreguntas": [], "idiomas": ["es"], "idiomaRespuesta": "es"}},
    {"tipo": "paso", "n": 1, "herramienta": "buscar", "entrada": {"consulta": "Coppelia"}, "resumen": "6 pasajes", "ms": 10, "evidencias": ["P1"]},
    {"tipo": "texto", "delta": "En el cuento «había pedido fresa» [E1].", "marcas": {"E1": "P1"}},
    {"tipo": "fin", "markdown": "En el cuento «había pedido fresa» [E1].", "evidencias": [{"id": "E1", "etiqueta": "p. 4"}], "fuentes": [],
     "confianza": "alta", "coste": {"usd": 0.1}, "avisos": [], "ms": 1000},
]


def test_investigar_en_flujo_y_bloqueante():
    sesion = _Sesion(EVENTOS)
    s = Scholaris("https://ejemplo", "sch_prueba", sesion=sesion)
    tipos = [e["tipo"] for e in s.investigar("¿Coppelia?", documentos=["d1"], profundidad="rapida", cuaderno=False)]
    assert tipos == ["inicio", "plan", "paso", "texto", "fin"]
    metodo, url, kw = sesion.peticiones[0]
    assert metodo == "POST" and url.endswith("/api/v2/busqueda/investigar")
    assert kw["json"] == {"pregunta": "¿Coppelia?", "profundidad": "rapida", "filtros": {"documentos": ["d1"]}, "cuaderno": False}
    assert kw["headers"]["accept"] == "text/event-stream"
    fin = s.investigacion("¿Coppelia?")
    assert fin["markdown"].endswith("[E1].") and fin["plan"]["enfoque"] == "Comparar." and len(fin["pasos"]) == 1


def test_un_error_del_agente_se_lanza():
    s = Scholaris("https://ejemplo", "sch_prueba", sesion=_Sesion([{"tipo": "error", "mensaje": "No he podido terminar la investigación."}]))
    with pytest.raises(ErrorApi):
        s.investigar("x", flujo=False)
