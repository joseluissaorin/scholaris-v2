"""Scholaris en cinco verbos: subo cualquier cosa, busco, pregunto, cito.

Cliente fino de la API pública v1 (`/api/v1`). Crea una clave en Scholaris,
Ajustes → Claves de API, y:

    from scholaris.api import Scholaris

    s = Scholaris("sch_…")                       # o la variable SCHOLARIS_CLAVE
    doc = s.subir("articulo.pdf")                 # también una URL: s.subir("https://…")
    for p in s.buscar("atención escalada", k=3):
        print(f'«{p["pasaje"]}» {p["cita"]}', p["enlace"])   # el pasaje: las oraciones que se citan
    r = s.preguntar("¿Qué es la atención multicabeza?")
    print(r["respuesta"])                         # Markdown con notas [^n] verificadas
    print(s.citar("La atención sustituye a la recurrencia.")["texto"])
    print(s.verificar("El Transformer prescinde de la recurrencia.")["veredicto"])

Contra la versión local: `Scholaris(base="http://localhost:8790")`.
Para todo lo demás (bibliotecas, SPDF, metadatos), `scholaris.v2.Scholaris`.
"""
from __future__ import annotations

import json
import mimetypes
import os
from typing import Any, Dict, Iterator, List, Optional, Sequence, Union

import requests

__all__ = ["Scholaris", "ErrorScholaris", "BASE"]

BASE = os.environ.get("SCHOLARIS_URL", "https://scholaris.joseluissaorin.com")
_MAX_CRUDO = 95 * 1024 * 1024
_MIMES = {".md": "text/markdown", ".epub": "application/epub+zip", ".m4a": "audio/mp4", ".opus": "audio/ogg", ".mkv": "video/x-matroska"}


class ErrorScholaris(Exception):
    """Error de la API: `codigo` estable, `mensaje` en español y `message` en inglés."""

    def __init__(self, estado: int, codigo: str, mensaje: str, message: str = "", detalles: Optional[dict] = None):
        super().__init__(mensaje)
        self.estado, self.codigo, self.mensaje, self.message, self.detalles = estado, codigo, mensaje, message, detalles or {}

    def __str__(self) -> str:
        return f"{self.mensaje} ({self.codigo}, {self.estado})"


class Scholaris:
    def __init__(self, clave: Optional[str] = None, base: Optional[str] = None, *, sesion: Optional[requests.Session] = None, tiempo: float = 700):
        self.clave = clave or os.environ.get("SCHOLARIS_CLAVE") or os.environ.get("SCHOLARIS_TOKEN")
        self.base = (base or BASE).rstrip("/")
        self.http = sesion or requests.Session()
        self.tiempo = tiempo

    # -- bajo nivel ---------------------------------------------------------

    def pedir(self, metodo: str, ruta: str, *, json_: Any = None, datos: Any = None, params: Optional[dict] = None,
              cabeceras: Optional[dict] = None, stream: bool = False) -> requests.Response:
        h = {"x-scholaris-cliente": "python-v1", **(cabeceras or {})}
        if self.clave:
            h["authorization"] = f"Bearer {self.clave}"
        p = {k: v for k, v in (params or {}).items() if v is not None}
        r = self.http.request(metodo, f"{self.base}/api/v1{ruta}", json=json_, data=datos, params=p, headers=h, timeout=self.tiempo, stream=stream)
        if r.status_code >= 400:
            try:
                e = r.json()["error"]
            except Exception:
                e = {"codigo": "interno", "mensaje": r.text[:300] or f"Error {r.status_code}"}
            raise ErrorScholaris(r.status_code, e.get("codigo", "interno"), e.get("mensaje", ""), e.get("message", ""), e.get("detalles"))
        return r

    def _json(self, *a: Any, **k: Any) -> Any:
        return self.pedir(*a, **k).json()

    # -- documentos ---------------------------------------------------------

    def subir(self, ruta_o_url: str, *, titulo: Optional[str] = None, autores: Optional[Sequence[str]] = None,
              anio: Optional[int] = None, esperar: int = 300, idempotencia: Optional[str] = None) -> dict:
        """Un fichero o una URL (web, PDF, YouTube, pódcast). Espera hasta `esperar` segundos;
        si no ha terminado, el documento vuelve con `estado` y `progreso_url` (ver `documento(id, esperar=…)`)."""
        params: Dict[str, Any] = {"esperar": esperar, "titulo": titulo, "anio": anio, "autores": "; ".join(autores) if autores else None}
        cab = {"idempotency-key": idempotencia} if idempotencia else {}
        if ruta_o_url.startswith(("http://", "https://")):
            cuerpo = {"url": ruta_o_url, **{k: v for k, v in {"titulo": titulo, "autores": list(autores) if autores else None, "anio": anio}.items() if v is not None}}
            return self._json("POST", "/documentos", json_=cuerpo, params={"esperar": esperar}, cabeceras=cab)
        nombre = os.path.basename(ruta_o_url)
        if os.path.getsize(ruta_o_url) > _MAX_CRUDO:
            # Lo muy grande va por partes con el cliente de la v2, y se devuelve en la forma de la v1.
            from .v2.api import Scholaris as V2
            meta = {k: v for k, v in {"titulo": titulo, "anio": anio}.items() if v is not None}
            d = V2(self.base, clave=self.clave).subir(ruta_o_url, metadatos=meta or None)
            return self.documento(d["id"], esperar=esperar)
        mime = _MIMES.get(os.path.splitext(nombre)[1].lower()) or mimetypes.guess_type(nombre)[0] or "application/octet-stream"
        with open(ruta_o_url, "rb") as f:
            return self._json("POST", "/documentos", datos=f, params={**params, "nombre": nombre}, cabeceras={"content-type": mime, **cab})

    def documentos(self, q: Optional[str] = None, estado: Optional[str] = None) -> Iterator[dict]:
        """Toda la biblioteca, página a página."""
        cursor = None
        while True:
            p = self._json("GET", "/documentos", params={"q": q, "estado": estado, "cursor": cursor, "limite": 200})
            yield from p["documentos"]
            cursor = p.get("siguiente")
            if not cursor:
                return

    def documento(self, id: str, esperar: int = 0) -> dict:
        return self._json("GET", f"/documentos/{id}", params={"esperar": esperar or None})

    def borrar(self, id: str) -> dict:
        return self._json("DELETE", f"/documentos/{id}")

    def texto(self, id: str, desde: Union[str, int, None] = None, hasta: Union[str, int, None] = None, *, markdown: bool = False) -> Union[dict, str]:
        """Páginas por su folio impreso («23», «xiv») o física («[12]»); en audio y vídeo, tiempos («1:06:56»)."""
        p = {"desde": desde, "hasta": hasta, "formato": "markdown" if markdown else None}
        r = self.pedir("GET", f"/documentos/{id}/texto", params=p)
        return r.text if markdown else r.json()

    # -- buscar, preguntar, citar, verificar ---------------------------------

    def buscar(self, q: str, k: int = 10, documentos: Optional[Sequence[str]] = None) -> List[dict]:
        """Pasajes de la biblioteca. Cada uno trae `pasaje` (de 1 a 3 oraciones completas y
        literales que responden a la consulta: lo que se cita), `cita` y `localizador` (con la
        página o el segundo de esas oraciones), `ancla`, `enlace` (el lector con el pasaje
        subrayado), `pasaje_rango` ([desde, hasta) dentro de `texto`) y `texto`, el fragmento
        entero, como contexto. Para citar: `f'«{p["pasaje"]}» {p["cita"]}'` (ver `cita_literal`)."""
        return self._json("GET", "/buscar", params={"q": q, "k": k, "documento": ",".join(documentos) if documentos else None})["pasajes"]

    @staticmethod
    def cita_literal(p: dict) -> str:
        """La cita lista para pegar de un pasaje de `buscar` o una fuente de `preguntar`:
        «pasaje» (Autor, año, p. X). Solo texto literal del documento, nunca del modelo."""
        return f'«{p.get("pasaje") or p["texto"]}» {p["cita"]}'

    def preguntar(self, pregunta: str, k: int = 8, documentos: Optional[Sequence[str]] = None, *, stream: bool = False) -> Any:
        """Respuesta en Markdown con notas [^n] y sus `fuentes`. Con `stream=True`, un iterador de
        (evento, datos): «pasajes», «texto» (delta), «fuente», «fin»."""
        cuerpo = {"pregunta": pregunta, "k": k, **({"documentos": list(documentos)} if documentos else {})}
        if not stream:
            return self._json("POST", "/preguntar", json_=cuerpo)
        return self._eventos(self.pedir("POST", "/preguntar", json_={**cuerpo, "stream": True}, stream=True))

    @staticmethod
    def _eventos(r: requests.Response) -> Iterator[tuple]:
        evento, datos = "message", []
        for linea in r.iter_lines(decode_unicode=True):
            if linea is None:
                continue
            if linea == "":
                if datos:
                    yield evento, json.loads("\n".join(datos))
                evento, datos = "message", []
            elif linea.startswith("event:"):
                evento = linea[6:].strip()
            elif linea.startswith("data:"):
                datos.append(linea[5:].lstrip())

    def citar(self, texto: str, estilo: str = "apa", *, idioma: str = "es-ES", esperar: int = 300) -> dict:
        """El texto con citas verificadas insertadas, las `citas` y la `bibliografia`."""
        return self._json("POST", "/citar", json_={"texto": texto, "estilo": estilo, "idioma": idioma}, params={"esperar": esperar})

    def citar_docx(self, ruta: str, destino: str, estilo: str = "apa", *, esperar: int = 300) -> str:
        """Un .docx citado, conservando su formato."""
        with open(ruta, "rb") as f:
            r = self.pedir("POST", "/citar", datos=f, params={"estilo": estilo, "esperar": esperar, "nombre": os.path.basename(ruta)},
                           cabeceras={"content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                      "accept": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"})
        if r.headers.get("content-type", "").startswith("application/json"):
            raise ErrorScholaris(r.status_code, "conflicto", "La cita todavía no ha terminado: vuelve a pedirla con GET /citar/{id}.", detalles=r.json())
        with open(destino, "wb") as f:
            f.write(r.content)
        return destino

    def verificar(self, afirmacion: str, anio: Optional[int] = None) -> dict:
        """`veredicto` (respaldada, parcial, sin_respaldo, contradicha), `probabilidad` y los pasajes."""
        return self._json("POST", "/verificar", json_={"afirmacion": afirmacion, **({"anio": anio} if anio else {})})
