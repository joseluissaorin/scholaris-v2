"""Cómo se imprime un ancla en una cita: el mismo criterio que `anclaACita` de
@scholaris/nucleo. «p. 23», «pp. 23-24», «12:04», «diap. 7»."""
from __future__ import annotations

from typing import Any, Mapping, Optional


def tiempo_a_cadena(s: float) -> str:
    h, m, x = int(s // 3600), int((s % 3600) // 60), int(s % 60)
    return f"{h}:{m:02d}:{x:02d}" if h else f"{m}:{x:02d}"


def ancla_a_cita(ancla: Mapping[str, Any], fin: Optional[Mapping[str, Any]] = None) -> str:
    tipo = ancla.get("tipo")
    if tipo == "pagina":
        a = ancla.get("impresa") or f"[{ancla.get('fisica')}]"
        if fin and fin.get("tipo") == "pagina":
            b = fin.get("impresa") or f"[{fin.get('fisica')}]"
            if b != a:
                return f"pp. {a}-{b}"
        return f"p. {a}"
    if tipo == "tiempo":
        t = tiempo_a_cadena(float(ancla.get("t0", 0)))
        if fin and fin.get("tipo") == "tiempo":
            t += "-" + tiempo_a_cadena(float(fin.get("t1", 0)))
        return t
    if tipo == "seccion":
        if ancla.get("impresa"):
            return f"p. {ancla['impresa']}"
        return ", ".join([*list(ancla.get("ruta") or [])[-1:], f"párr. {ancla.get('parrafo')}"])
    if tipo == "diapositiva":
        return f"diap. {ancla.get('n')}"
    if tipo == "hoja":
        return f"{ancla.get('hoja')}, filas {ancla.get('filaDesde')}-{ancla.get('filaHasta')}"
    if tipo == "web":
        return ", ".join([*list(ancla.get("ruta") or [])[-1:], f"párr. {ancla.get('parrafo')}"])
    if tipo == "imagen":
        return "fig."
    return ""


def cita_corta(metadatos: Mapping[str, Any], ancla: Mapping[str, Any], fin: Optional[Mapping[str, Any]] = None) -> str:
    """«(Foucault, 1975, p. 23)»."""
    autores = list(metadatos.get("autores") or [])
    nombre = lambda a: a.get("apellidos") or a.get("nombre") or ""  # noqa: E731
    if not autores:
        quien = f"«{(metadatos.get('titulo') or '')[:40]}»" if metadatos.get("titulo") else "s. a."
    elif len(autores) == 1:
        quien = nombre(autores[0])
    elif len(autores) == 2:
        quien = f"{nombre(autores[0])} y {nombre(autores[1])}"
    else:
        quien = f"{nombre(autores[0])} et al."
    partes = [quien, str(metadatos.get("anio") or "s. f.")]
    et = ancla_a_cita(ancla, fin)
    if et and ancla.get("tipo") != "imagen":
        partes.append(et)
    return "(" + ", ".join(partes) + ")"
