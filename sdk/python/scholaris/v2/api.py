"""Cliente de la API v2 de Scholaris con claves personales.

Crea una clave en la aplicación (Ajustes → Claves de API, con los alcances
que hagan falta) y úsala aquí. Sirve igual para la nube y para la versión
local (Docker o escritorio).

    from scholaris.v2 import Scholaris
    s = Scholaris("https://scholaris-v2.jlsf2005.workers.dev", clave="sch_…")
    doc = s.subir("articulo.pdf")                 # sube, convierte en el servidor y espera
    for r in s.buscar("atención escalada", k=5):
        print(r["citaCorta"], r["fragmento"]["texto"][:80])
    s.descargar_spdf(doc["id"], "articulo.spdf")  # SPDF 4.0, legible sin conexión con SPDF.abrir()
"""
from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import time
from typing import Any, Callable, Dict, Iterator, List, Optional

import requests

__all__ = ["Scholaris", "ErrorApi"]

PREFIJO = "/api/v2"
_MIMES_EXTRA = {".md": "text/markdown", ".epub": "application/epub+zip", ".m4a": "audio/mp4", ".opus": "audio/ogg", ".mkv": "video/x-matroska"}


class ErrorApi(Exception):
    """Error de la API con su código estable (`no_autenticado`, `cuota_superada`…)."""

    def __init__(self, estado: int, codigo: str, mensaje: str, detalles: Optional[dict] = None):
        super().__init__(mensaje)
        self.estado, self.codigo, self.mensaje, self.detalles = estado, codigo, mensaje, detalles or {}

    def __str__(self) -> str:
        return f"{self.mensaje} ({self.codigo}, {self.estado})"


class Scholaris:
    def __init__(self, base: str, clave: Optional[str] = None, *, sesion: Optional[requests.Session] = None, tiempo: float = 120):
        self.base = base.rstrip("/")
        self.clave = clave or os.environ.get("SCHOLARIS_CLAVE") or os.environ.get("SCHOLARIS_TOKEN")
        self.http = sesion or requests.Session()
        self.tiempo = tiempo

    # -- bajo nivel ---------------------------------------------------------

    def _cabeceras(self, extra: Optional[dict] = None) -> dict:
        h = {"x-scholaris-cliente": "python"}
        if self.clave:
            h["authorization"] = f"Bearer {self.clave}"
        return {**h, **(extra or {})}

    def pedir(self, metodo: str, ruta: str, *, json_: Any = None, datos: Any = None, params: Optional[dict] = None,
              cabeceras: Optional[dict] = None, crudo: bool = False, stream: bool = False) -> Any:
        r = self.http.request(metodo, f"{self.base}{PREFIJO}{ruta}", json=json_, data=datos, params=params,
                              headers=self._cabeceras(cabeceras), timeout=self.tiempo, stream=stream)
        if r.status_code >= 400:
            try:
                e = r.json()["error"]
            except Exception:
                e = {"codigo": "interno", "mensaje": r.text[:300] or f"Error {r.status_code}"}
            raise ErrorApi(r.status_code, e.get("codigo", "interno"), e.get("mensaje", ""), e.get("detalles"))
        if crudo or stream:
            return r
        return r.json() if r.content else {"ok": True}

    # -- cuenta -------------------------------------------------------------

    def config(self) -> dict:
        return self.pedir("GET", "/config")

    def yo(self) -> dict:
        return self.pedir("GET", "/auth/yo")

    # -- documentos ---------------------------------------------------------

    def documentos(self, **filtros: Any) -> Iterator[dict]:
        """Todos los documentos (pagina sola). Filtros: q, biblioteca, tipo, autor, anioDesde, anioHasta, idioma, orden, dir."""
        cursor = None
        while True:
            p = {k: v for k, v in {**filtros, "cursor": cursor, "limite": 200}.items() if v is not None}
            pag = self.pedir("GET", "/documentos", params=p)
            yield from pag["elementos"]
            cursor = pag.get("siguiente")
            if not cursor:
                return

    def documento(self, id: str) -> dict:
        return self.pedir("GET", f"/documentos/{id}")

    def unidades(self, id: str, desde: int = 0, hasta: Optional[int] = None) -> List[dict]:
        """Unidades (páginas, tramos, diapositivas) con orden base 0."""
        return self.pedir("GET", f"/documentos/{id}/unidades", params={"desde": desde, "hasta": hasta if hasta is not None else desde + 99})

    def fragmentos(self, id: str, desde: int = 0, hasta: Optional[int] = None) -> List[dict]:
        return self.pedir("GET", f"/documentos/{id}/fragmentos", params={"desde": desde, "hasta": hasta if hasta is not None else desde + 9})

    def metadatos(self, id: str, **cambios: Any) -> dict:
        return self.pedir("PATCH", f"/documentos/{id}/metadatos", json_=cambios)

    def borrar(self, id: str) -> dict:
        return self.pedir("DELETE", f"/documentos/{id}")

    def descargar_spdf(self, id: str, destino: Optional[str] = None) -> bytes:
        datos = self.pedir("GET", f"/documentos/{id}/spdf", crudo=True).content
        if destino:
            with open(destino, "wb") as f:
                f.write(datos)
        return datos

    def importar_spdf(self, ruta: str) -> dict:
        with open(ruta, "rb") as f:
            return self.pedir("POST", "/documentos/importar", datos=f.read(), cabeceras={"content-type": "application/x-spdf"})

    def cita(self, id: str, estilo: str = "apa", idioma: str = "es-ES") -> dict:
        return self.pedir("GET", f"/documentos/{id}/cita", params={"estilo": estilo, "idioma": idioma})

    # -- subidas e ingesta --------------------------------------------------

    def subir(self, ruta: str, *, bibliotecas: Optional[List[str]] = None, metadatos: Optional[dict] = None,
              esperar: bool = True, al_progreso: Optional[Callable[[dict], None]] = None) -> dict:
        """Sube un fichero (directo al almacén, por partes si es grande), lo convierte en el
        servidor y, si `esperar`, devuelve el documento ya listo."""
        nombre = os.path.basename(ruta)
        ext = os.path.splitext(nombre)[1].lower()
        mime = _MIMES_EXTRA.get(ext) or mimetypes.guess_type(nombre)[0] or "application/octet-stream"
        tam = os.path.getsize(ruta)
        h = hashlib.sha256()
        with open(ruta, "rb") as f:
            for trozo in iter(lambda: f.read(1 << 20), b""):
                h.update(trozo)
        s = self.pedir("POST", "/subidas", json_={"nombre": nombre, "mime": mime, "bytes": tam, "huella": h.hexdigest(),
                                                   **({"bibliotecas": bibliotecas} if bibliotecas else {}), **({"metadatos": metadatos} if metadatos else {})})
        if s.get("duplicado"):
            return self.documento(s["duplicado"])
        destino = s["original"]
        if destino["modo"] == "simple":
            with open(ruta, "rb") as f:
                r = self.http.put(destino["url"], data=f, headers=destino.get("cabeceras") or {}, timeout=None)
            r.raise_for_status()
        else:
            tam_parte = destino.get("tamParte") or 16 * 1024 * 1024
            n = max(1, -(-tam // tam_parte))
            hechas = []
            with open(ruta, "rb") as f:
                for i in range(0, n, 20):
                    numeros = list(range(i + 1, min(n, i + 20) + 1))
                    for p in self.pedir("POST", f"/subidas/{s['subida']}/partes", json_={"numeros": numeros})["partes"]:
                        f.seek((p["numero"] - 1) * tam_parte)
                        trozo = f.read(tam_parte)
                        for intento in range(4):
                            try:
                                r = self.http.put(p["url"], data=trozo, headers=p.get("cabeceras") or {}, timeout=None)
                                r.raise_for_status()
                                etag = r.headers.get("etag") or r.json().get("etag")
                                hechas.append({"numero": p["numero"], "etag": etag})
                                break
                            except Exception:
                                if intento == 3:
                                    raise
                                time.sleep(2 ** intento)
            self.pedir("POST", f"/subidas/{s['subida']}/completar", json_={"partes": sorted(hechas, key=lambda x: x["numero"])})
        ing = self.pedir("POST", f"/subidas/{s['subida']}/ingestar", json_={})
        if not esperar:
            return ing
        self.esperar(ing["tarea"], al_progreso=al_progreso)
        return self.documento(ing["documento"])

    def subir_url(self, url: str, *, tipo: Optional[str] = None, esperar: bool = True,
                  al_progreso: Optional[Callable[[dict], None]] = None) -> dict:
        """Una página web, un vídeo de YouTube, un pódcast o un PDF por URL."""
        ing = self.pedir("POST", "/subidas/url", json_={"url": url, **({"tipo": tipo} if tipo else {})})
        if not esperar:
            return ing
        self.esperar(ing["tarea"], al_progreso=al_progreso)
        return self.documento(ing["documento"])

    def tarea(self, id: str) -> dict:
        return self.pedir("GET", f"/tareas/{id}")

    def esperar(self, tarea: str, *, cada: float = 3, limite: float = 6 * 3600,
                al_progreso: Optional[Callable[[dict], None]] = None) -> dict:
        """Espera a que una tarea termine (por sondeo; sin WebSocket)."""
        fin = time.time() + limite
        while time.time() < fin:
            t = self.tarea(tarea)
            if al_progreso and t.get("progreso"):
                al_progreso(t["progreso"])
            if t["estado"] == "listo":
                return t
            if t["estado"] in ("error", "cancelada"):
                raise ErrorApi(500, "tarea_fallida", t.get("error") or f"La tarea terminó en «{t['estado']}».")
            time.sleep(cada)
        raise TimeoutError(f"La tarea {tarea} no terminó en {limite} s")

    def reintentar(self, documento: str) -> dict:
        return self.pedir("POST", f"/documentos/{documento}/reintentar")

    # -- búsqueda y citas ---------------------------------------------------

    def buscar(self, consulta: str, *, k: int = 20, filtros: Optional[dict] = None, modo: str = "hibrida", reordenar: Optional[bool] = None) -> List[dict]:
        cuerpo = {"consulta": consulta, "k": k, "modo": modo, **({"filtros": filtros} if filtros else {}), **({"reordenar": reordenar} if reordenar is not None else {})}
        return self.pedir("POST", "/busqueda", json_=cuerpo)["resultados"]

    def responder(self, pregunta: str, **opciones: Any) -> Iterator[dict]:
        """Respuesta con citas en flujo: eventos «resultados», «texto», «cita», «fin»."""
        r = self.pedir("POST", "/busqueda/responder", json_={"consulta": pregunta, **opciones}, stream=True, cabeceras={"accept": "text/event-stream"})
        datos: List[str] = []
        for linea in r.iter_lines(decode_unicode=True):
            if linea is None:
                continue
            if linea.startswith("data:"):
                datos.append(linea[5:].lstrip())
            elif linea == "" and datos:
                yield json.loads("\n".join(datos))
                datos = []

    def respuesta(self, pregunta: str, **opciones: Any) -> dict:
        """La respuesta entera: {texto, citas, resultados}."""
        texto, citas, resultados = [], [], []
        for e in self.responder(pregunta, **opciones):
            if e["tipo"] == "texto":
                texto.append(e["delta"])
            elif e["tipo"] == "cita":
                citas.append(e)
            elif e["tipo"] == "resultados":
                resultados = e["resultados"]
            elif e["tipo"] == "error":
                raise ErrorApi(500, "respuesta", e["mensaje"])
        return {"texto": "".join(texto), "citas": citas, "resultados": resultados}

    def verificar(self, afirmacion: str, **opciones: Any) -> dict:
        return self.pedir("POST", "/citas/verificar", json_={"afirmacion": afirmacion, **opciones})

    def referencias(self, formato: str = "bibtex", *, documentos: Optional[List[str]] = None, biblioteca: Optional[str] = None) -> str:
        cuerpo = {"formato": formato, **({"documentos": documentos} if documentos else {}), **({"biblioteca": biblioteca} if biblioteca else {})}
        return self.pedir("POST", "/citas/exportar", json_=cuerpo, crudo=True).text

    def bibliografia(self, *, estilo: str = "apa", idioma: str = "es-ES", documentos: Optional[List[str]] = None, biblioteca: Optional[str] = None) -> dict:
        return self.pedir("POST", "/citas/bibliografia", json_={"estilo": estilo, "idioma": idioma, **({"documentos": documentos} if documentos else {}), **({"biblioteca": biblioteca} if biblioteca else {})})

    def autocitar(self, ruta_o_texto: str, *, estilo: str = "apa", esperar: bool = True, **opciones: Any) -> dict:
        """Autocita un texto o un DOCX (que conserva su formato al exportar)."""
        cuerpo: Dict[str, Any] = {"estilo": estilo, **opciones}
        if os.path.exists(ruta_o_texto):
            nombre = os.path.basename(ruta_o_texto)
            mime = mimetypes.guess_type(nombre)[0] or "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            with open(ruta_o_texto, "rb") as f:
                sub = self.pedir("POST", "/citas/subir", datos=f.read(), params={"nombre": nombre}, cabeceras={"content-type": mime})
            cuerpo["subida"] = sub["clave"]
        else:
            cuerpo["texto"] = ruta_o_texto
        a = self.pedir("POST", "/citas/autocita", json_=cuerpo)
        if not esperar:
            return a
        self.esperar(a["tarea"])
        return self.pedir("GET", f"/citas/autocita/{a['autocita']}")

    def exportar_autocita(self, id: str, destino: str, formato: str = "docx") -> str:
        datos = self.pedir("GET", f"/citas/autocita/{id}/exportar", params={"formato": formato}, crudo=True).content
        with open(destino, "wb") as f:
            f.write(datos)
        return destino

    # -- bibliotecas --------------------------------------------------------

    def bibliotecas(self) -> List[dict]:
        return self.pedir("GET", "/bibliotecas")

    def crear_biblioteca(self, nombre: str, descripcion: Optional[str] = None) -> dict:
        return self.pedir("POST", "/bibliotecas", json_={"nombre": nombre, **({"descripcion": descripcion} if descripcion else {})})

    def anadir(self, biblioteca: str, documentos: List[str]) -> dict:
        return self.pedir("POST", f"/bibliotecas/{biblioteca}/documentos", json_={"documentos": documentos})

    def compartida(self, biblioteca: str) -> "Scholaris":
        """El mismo cliente, dentro de una biblioteca que otra persona comparte contigo."""
        otro = Scholaris(self.base, self.clave, sesion=self.http, tiempo=self.tiempo)
        otro.base = f"{self.base}"
        original = otro.pedir

        def pedir(metodo: str, ruta: str, **kw: Any) -> Any:
            return original(metodo, f"/compartidas/{biblioteca}{ruta}", **kw)

        otro.pedir = pedir  # type: ignore[method-assign]
        return otro
