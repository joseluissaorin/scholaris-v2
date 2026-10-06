"""Lector de SPDF 4.0 sin conexión.

Un .spdf 4.0 es una base SQLite comprimida con gzip (esquema en
packages/spdf/esquema/v4.0.sql del monorepo). Este lector solo necesita la
biblioteca estándar; numpy es opcional para la búsqueda vectorial.

    from scholaris.v2 import SPDF
    with SPDF.abrir("vigilar.spdf") as s:
        print(s.documento["metadatos"]["titulo"])
        for r in s.buscar("selección natural"):
            print(r.cita, r.texto[:80])
"""
from __future__ import annotations

import gzip
import json
import os
import sqlite3
import tempfile
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional, Sequence

from .citas import ancla_a_cita, cita_corta

__all__ = ["SPDF", "Fragmento", "Unidad", "ErrorSPDF"]


class ErrorSPDF(Exception):
    """El fichero no es un SPDF 4.0 legible."""


@dataclass
class Unidad:
    id: str
    orden: int
    ancla: Dict[str, Any]
    texto: str
    notas: List[str] = field(default_factory=list)
    imagen: Optional[str] = None

    @property
    def etiqueta(self) -> str:
        return ancla_a_cita(self.ancla)


@dataclass
class Fragmento:
    id: str
    documento: str
    unidad: str
    orden: int
    texto: str
    contexto: str
    seccion: List[str]
    ancla: Dict[str, Any]
    ancla_fin: Optional[Dict[str, Any]] = None
    puntuacion: float = 0.0
    cita: str = ""

    @property
    def etiqueta(self) -> str:
        return ancla_a_cita(self.ancla, self.ancla_fin)


def _json(v: Any, defecto: Any) -> Any:
    if v is None or v == "":
        return defecto
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return defecto


class SPDF:
    """Un SPDF 4.0 abierto (solo lectura)."""

    def __init__(self, ruta_sqlite: str, temporal: bool = False):
        self._ruta = ruta_sqlite
        self._temporal = temporal
        self.db = sqlite3.connect(f"file:{ruta_sqlite}?mode=ro", uri=True)
        self.db.row_factory = sqlite3.Row
        version = self.claves().get("spdf_version", "")
        if not version.startswith("4"):
            tablas = {r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.cerrar()
            if "pages" in tablas or "chunks" in tablas:
                raise ErrorSPDF("Es un SPDF v3: conviértelo a 4.0 importándolo en Scholaris (o con migrarV3aV4).")
            raise ErrorSPDF(f"Versión de SPDF desconocida: {version or 'sin versión'}")

    # -- apertura -----------------------------------------------------------

    @classmethod
    def abrir(cls, ruta: str) -> "SPDF":
        with open(ruta, "rb") as f:
            cabeza = f.read(2)
        if cabeza == b"\x1f\x8b":
            fd, tmp = tempfile.mkstemp(suffix=".sqlite")
            with os.fdopen(fd, "wb") as salida, gzip.open(ruta, "rb") as entrada:
                while True:
                    trozo = entrada.read(1 << 20)
                    if not trozo:
                        break
                    salida.write(trozo)
            return cls(tmp, temporal=True)
        return cls(ruta)

    @classmethod
    def desde_bytes(cls, datos: bytes) -> "SPDF":
        fd, tmp = tempfile.mkstemp(suffix=".spdf")
        with os.fdopen(fd, "wb") as f:
            f.write(datos)
        try:
            return cls.abrir(tmp)
        finally:
            os.unlink(tmp)

    def cerrar(self) -> None:
        try:
            self.db.close()
        finally:
            if self._temporal and os.path.exists(self._ruta):
                os.unlink(self._ruta)

    def __enter__(self) -> "SPDF":
        return self

    def __exit__(self, *_: Any) -> None:
        self.cerrar()

    # -- contenido ----------------------------------------------------------

    def claves(self) -> Dict[str, str]:
        try:
            return {r["clave"]: r["valor"] for r in self.db.execute("SELECT clave, valor FROM spdf")}
        except sqlite3.DatabaseError:
            return {}

    @property
    def documentos(self) -> List[Dict[str, Any]]:
        out = []
        for r in self.db.execute("SELECT * FROM documentos ORDER BY creado"):
            d = dict(r)
            d["metadatos"] = _json(d.get("metadatos"), {})
            d["bibliotecas"] = _json(d.get("bibliotecas"), [])
            out.append(d)
        return out

    @property
    def documento(self) -> Dict[str, Any]:
        """El documento del fichero (un .spdf exportado lleva exactamente uno)."""
        ds = self.documentos
        if not ds:
            raise ErrorSPDF("El SPDF no contiene ningún documento.")
        return ds[0]

    def unidades(self, documento: Optional[str] = None) -> List[Unidad]:
        doc = documento or self.documento["id"]
        return [
            Unidad(r["id"], r["orden"], _json(r["ancla"], {}), r["texto"] or "", _json(r["notas"], []), r["imagen"])
            for r in self.db.execute("SELECT * FROM unidades WHERE documento = ? ORDER BY orden", (doc,))
        ]

    def pagina(self, impresa: str, documento: Optional[str] = None) -> Optional[Unidad]:
        """La unidad cuyo folio impreso es `impresa` («145», «xiv»)."""
        doc = documento or self.documento["id"]
        r = self.db.execute("SELECT * FROM unidades WHERE documento = ? AND impresa = ? ORDER BY orden LIMIT 1", (doc, impresa)).fetchone()
        return Unidad(r["id"], r["orden"], _json(r["ancla"], {}), r["texto"] or "", _json(r["notas"], []), r["imagen"]) if r else None

    def fragmentos(self, documento: Optional[str] = None) -> List[Fragmento]:
        doc = documento or self.documento["id"]
        return [self._fragmento(r) for r in self.db.execute("SELECT * FROM fragmentos WHERE documento = ? ORDER BY orden", (doc,))]

    def secciones(self, documento: Optional[str] = None) -> List[Dict[str, Any]]:
        doc = documento or self.documento["id"]
        return [dict(r) for r in self.db.execute("SELECT * FROM secciones WHERE documento = ?", (doc,))]

    def espacios(self) -> List[Dict[str, Any]]:
        out = []
        for r in self.db.execute("SELECT * FROM espacios"):
            e = dict(r)
            e["modalidades"] = _json(e.get("modalidades"), [])
            out.append(e)
        return out

    def blob(self, clave: str) -> Optional[bytes]:
        r = self.db.execute("SELECT datos FROM blobs WHERE clave = ?", (clave,)).fetchone()
        return bytes(r[0]) if r else None

    def original(self) -> Optional[bytes]:
        """El original incrustado (PDF, audio…), si el fichero lo trae."""
        clave = self.documento.get("original") or ""
        return self.blob(clave) if clave else None

    # -- búsqueda -----------------------------------------------------------

    def _fragmento(self, r: sqlite3.Row, puntuacion: float = 0.0) -> Fragmento:
        f = Fragmento(
            r["id"], r["documento"], r["unidad"], r["orden"], r["texto"], r["contexto"] or "",
            _json(r["seccion"], []), _json(r["ancla"], {}), _json(r["ancla_fin"], None), puntuacion,
        )
        try:
            meta = self._metadatos(f.documento)
            f.cita = cita_corta(meta, f.ancla, f.ancla_fin)
        except Exception:  # pragma: no cover
            f.cita = f.etiqueta
        return f

    def _metadatos(self, documento: str) -> Dict[str, Any]:
        cache = self.__dict__.setdefault("_cache_meta", {})
        if documento not in cache:
            r = self.db.execute("SELECT metadatos FROM documentos WHERE id = ?", (documento,)).fetchone()
            cache[documento] = _json(r[0], {}) if r else {}
        return cache[documento]

    def buscar(self, consulta: str, k: int = 10) -> List[Fragmento]:
        """Búsqueda léxica (BM25 con FTS5, sin acentos)."""
        terminos = [t for t in "".join(c if c.isalnum() else " " for c in consulta).split() if len(t) > 1]
        if not terminos:
            return []
        q = " OR ".join(f'"{t}"' for t in terminos)
        filas = self.db.execute(
            "SELECT f.*, bm25(fragmentos_fts) AS rango FROM fragmentos_fts JOIN fragmentos f ON f.n = fragmentos_fts.rowid "
            "WHERE fragmentos_fts MATCH ? ORDER BY rango LIMIT ?",
            (q, k),
        ).fetchall()
        return [self._fragmento(r, -float(r["rango"])) for r in filas]

    def vectores(self, espacio: str, objetivo: str = "fragmento") -> Iterator[tuple]:
        """(id, vector float32) de un espacio. El vector es una lista o un array de numpy si está instalado."""
        try:
            import numpy as np  # type: ignore
        except ImportError:  # pragma: no cover
            np = None
        import struct

        for r in self.db.execute("SELECT id, valores FROM vectores WHERE espacio = ? AND objetivo = ?", (espacio, objetivo)):
            b = bytes(r["valores"])
            yield r["id"], (np.frombuffer(b, dtype="<f4") if np is not None else list(struct.unpack(f"<{len(b) // 4}f", b)))

    def buscar_vector(self, vector: Sequence[float], espacio: str, k: int = 10) -> List[Fragmento]:
        """Búsqueda densa por coseno con un vector de consulta del mismo espacio."""
        import math

        q = list(vector)
        nq = math.sqrt(sum(x * x for x in q)) or 1.0
        puntos = []
        for fid, v in self.vectores(espacio):
            vv = list(v)
            n = math.sqrt(sum(x * x for x in vv)) or 1.0
            puntos.append((sum(a * b for a, b in zip(q, vv)) / (nq * n), fid))
        puntos.sort(reverse=True)
        out = []
        for p, fid in puntos[:k]:
            r = self.db.execute("SELECT * FROM fragmentos WHERE id = ?", (fid,)).fetchone()
            if r:
                out.append(self._fragmento(r, p))
        return out
