"""Aplica a un medio de Scholaris una revisión de su transcripción (o pide una nueva) con la API v1.

Una sola orden, contra producción o contra la versión local:

    SCHOLARIS_CLAVE=sch_… python3 apps/api/scripts/revisar-transcripcion.py \\
        --documento dmw21xnomjseg07mi --revision ~/tmp/scholaris-fresa/percepcion/fresa-y-chocolate.transcripcion.json

Sin `--revision`, el servidor revisa la transcripción él mismo (huecos y, si el medio ya tiene
percepción y el plan es de pago, hablantes); con `--percepcion`, además percibe antes el medio
entero. Primero enseña lo que se haría y lo que costaría; con `--simular` se queda ahí. Después
lanza la tarea y espera a que la revisión conste como aplicada (la transcripción reescrita).

Lo que hace en el servidor: comprueba que la revisión corresponde a la transcripción actual (si
no, no la aplica), reescribe unidades, fragmentos, instantes, hablantes y vectores (lo que no
cambia conserva su id y sus vectores) y, en los planes de pago, la comprensión se pone al día
sola (solo los segmentos cuyo texto cambió).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "sdk", "python"))
from scholaris.api import ErrorScholaris, Scholaris  # noqa: E402


def main() -> int:
    a = argparse.ArgumentParser(description="Revisa y reescribe la transcripción de un audio o un vídeo de Scholaris.")
    a.add_argument("--documento", required=True, help="Id del documento (p. ej. dmw21xnomjseg07mi).")
    a.add_argument("--revision", help="JSON con la revisión (RevisionTranscripcion de la percepción).")
    a.add_argument("--percepcion", action="store_true", help="Percibir antes el medio entero (proxy y percepción completa).")
    a.add_argument("--rehacer", action="store_true", help="Volver a revisar aunque haya una revisión guardada sin aplicar.")
    a.add_argument("--forzar", action="store_true", help="Aplicar aunque no case del todo con la transcripción actual (con cuidado).")
    a.add_argument("--simular", action="store_true", help="Solo enseñar lo que se haría y lo que costaría.")
    a.add_argument("--base", default=os.environ.get("SCHOLARIS_URL"), help="URL de Scholaris (por defecto, SCHOLARIS_URL o producción).")
    a.add_argument("--esperar", type=int, default=3600, help="Segundos que se espera a que termine (0: no esperar).")
    o = a.parse_args()

    s = Scholaris(base=o.base)
    d = s.documento(o.documento)
    print(f"«{d.get('titulo')}» ({d.get('tipo')}, {d.get('unidades')} unidades, {round((d.get('duracion') or 0) / 60)} min)")
    revision = None
    if o.revision:
        with open(os.path.expanduser(o.revision), encoding="utf-8") as f:
            revision = json.load(f)
        revision.pop("unidadesRevisadas", None)
        if revision.get("documento") and revision["documento"] != o.documento:
            print(f"La revisión es de otro documento ({revision['documento']}).", file=sys.stderr)
            return 2
        tipos: dict = {}
        for c in revision.get("correcciones", []):
            tipos[c["tipo"]] = tipos.get(c["tipo"], 0) + 1
        print(f"Revisión: {revision.get('modelo')} ({revision.get('version')}), correcciones {tipos}")

    simulacion = s.revisar_transcripcion(o.documento, revision=revision, rehacer=o.rehacer, percepcion=o.percepcion, simular=True)
    e = simulacion.get("estimacion") or {}
    print(f"Se haría: {', '.join(e.get('hara') or []) or 'nada'}; coste estimado {e.get('usd', 0):.2f} $")
    if o.simular:
        return 0

    try:
        antes = s.revision_transcripcion(o.documento).get("aplicada")
    except ErrorScholaris:
        antes = None
    try:
        r = s.revisar_transcripcion(o.documento, revision=revision, rehacer=o.rehacer, forzar=o.forzar, percepcion=o.percepcion)
    except ErrorScholaris as x:
        print(f"No se pudo lanzar: {x}", file=sys.stderr)
        return 1
    print(f"Tarea {r.get('tarea')} lanzada.")
    if not o.esperar:
        return 0
    fin = time.time() + o.esperar
    while time.time() < fin:
        time.sleep(10)
        try:
            v = s.revision_transcripcion(o.documento)
        except ErrorScholaris:
            continue
        t = v.get("tarea") or {}
        if t.get("id") != r.get("tarea") or t.get("estado") not in ("listo", "error"):
            continue
        print(json.dumps(v, ensure_ascii=False, indent=2))
        if v.get("aplicada") and v.get("aplicada") != antes:
            print("Revisión aplicada: la transcripción está reescrita.")
            return 0
        print("La tarea terminó sin aplicar la revisión: mira «avisosDocumento».", file=sys.stderr)
        return 1
    print("La tarea sigue en marcha: vuelve a mirar más tarde con revision_transcripcion().", file=sys.stderr)
    return 3


if __name__ == "__main__":
    sys.exit(main())
