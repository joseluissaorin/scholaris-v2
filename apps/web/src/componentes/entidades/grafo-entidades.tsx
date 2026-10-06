/**
 * El vecindario de una entidad, dibujado por fuerzas en SVG y sin librerías.
 * La disposición se calcula de una vez (unas centenas de iteraciones sobre
 * menos de cincuenta nodos: milisegundos) y se pinta quieta; así no hay
 * movimiento que respetar ni que desactivar. Las formas siguen a Kandinsky:
 * personas, círculo azul; obras, cuadrado rojo; lugares, triángulo amarillo.
 */
import { memo, useMemo, useState } from 'react';
import type { Entidad, TipoEntidad, VecindarioEntidad } from '@scholaris/contrato';

const ANCHO = 1000, ALTO = 560;

interface Punto { x: number; y: number }

function disponer(v: VecindarioEntidad): Map<string, Punto> {
  const n = v.nodos.length;
  const pos = new Map<string, Punto>();
  const directos = new Set(v.aristas.filter((a) => a.desde === v.centro || a.hacia === v.centro).flatMap((a) => [a.desde, a.hacia]));
  // Arranque determinista: el centro en medio, los vecinos en un anillo y los de segundo salto fuera.
  v.nodos.forEach((x, i) => {
    if (x.id === v.centro) { pos.set(x.id, { x: 0.5, y: 0.5 }); return; }
    const r = directos.has(x.id) ? 0.22 : 0.38;
    const ang = (i / Math.max(1, n)) * Math.PI * 2;
    pos.set(x.id, { x: 0.5 + r * Math.cos(ang), y: 0.5 + r * Math.sin(ang) * 0.9 });
  });
  const pesoMax = Math.max(1, ...v.aristas.map((a) => a.peso));
  for (let it = 0; it < 280; it++) {
    const f = new Map(v.nodos.map((x) => [x.id, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = v.nodos[i]!.id, b = v.nodos[j]!.id;
        const pa = pos.get(a)!, pb = pos.get(b)!;
        const dx = pa.x - pb.x, dy = pa.y - pb.y, d2 = Math.max(0.0016, dx * dx + dy * dy);
        const k = 0.0009 / d2;
        f.get(a)!.x += dx * k; f.get(a)!.y += dy * k; f.get(b)!.x -= dx * k; f.get(b)!.y -= dy * k;
      }
    }
    for (const e of v.aristas) {
      const pa = pos.get(e.desde), pb = pos.get(e.hacia);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.max(0.01, Math.hypot(dx, dy));
      // Más fuerte, más corto.
      const largo = 0.3 - 0.14 * (e.peso / pesoMax);
      const k = ((d - largo) / d) * 0.04;
      f.get(e.desde)!.x += dx * k; f.get(e.desde)!.y += dy * k; f.get(e.hacia)!.x -= dx * k; f.get(e.hacia)!.y -= dy * k;
    }
    const enfriar = 1 - it / 320;
    for (const x of v.nodos) {
      if (x.id === v.centro) continue;
      const p = pos.get(x.id)!, g = f.get(x.id)!;
      p.x = Math.min(0.93, Math.max(0.07, p.x + (g.x + (0.5 - p.x) * 0.006) * enfriar));
      p.y = Math.min(0.9, Math.max(0.08, p.y + (g.y + (0.5 - p.y) * 0.006) * enfriar));
    }
  }
  return pos;
}

const COLOR: Record<TipoEntidad, string> = {
  persona: 'var(--color-azul)', obra: 'var(--color-rojo)', lugar: 'var(--color-amarillo)',
  organizacion: 'var(--color-coffee-600)', concepto: 'var(--color-coffee-400)', evento: 'var(--color-ocre)', fecha: 'var(--color-coffee-300)',
};

export function FormaEntidad({ tipo, r, activa }: { tipo: TipoEntidad; r: number; activa?: boolean }) {
  const comun = { fill: COLOR[tipo], stroke: activa ? 'var(--color-coffee-900)' : 'var(--color-cream-50)', strokeWidth: activa ? 3 : 2 };
  if (tipo === 'obra') return <rect x={-r * 0.88} y={-r * 0.88} width={r * 1.76} height={r * 1.76} rx={2} {...comun} />;
  if (tipo === 'lugar') return <path d={`M0 ${-r * 1.1}L${r * 1.05} ${r * 0.8}L${-r * 1.05} ${r * 0.8}Z`} {...comun} />;
  if (tipo === 'persona') return <circle r={r} {...comun} />;
  return <rect x={-r * 0.8} y={-r * 0.8} width={r * 1.6} height={r * 1.6} transform="rotate(45)" {...comun} />;
}

export const GrafoEntidades = memo(function GrafoEntidades({ datos, alElegir }: { datos: VecindarioEntidad; alElegir: (e: Entidad) => void }) {
  const pos = useMemo(() => disponer(datos), [datos]);
  const [foco, setFoco] = useState<string | null>(null);
  const porId = useMemo(() => new Map(datos.nodos.map((x) => [x.id, x])), [datos]);
  const vecinosFoco = useMemo(() => new Set(foco ? datos.aristas.filter((a) => a.desde === foco || a.hacia === foco).flatMap((a) => [a.desde, a.hacia]) : []), [datos, foco]);
  const pesoMax = Math.max(1, ...datos.aristas.map((a) => a.peso));
  const radio = (e: Entidad) => (e.id === datos.centro ? 17 : 6 + Math.min(10, Math.log2(1 + e.menciones) * 1.6));

  return (
    <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="h-auto w-full select-none" role="img" aria-label={`Vecindario de ${porId.get(datos.centro)?.nombre ?? 'la entidad'}: ${datos.nodos.length - 1} entidades relacionadas`}>
      {datos.aristas.map((a) => {
        const p = pos.get(a.desde), q = pos.get(a.hacia);
        if (!p || !q) return null;
        const central = a.desde === datos.centro || a.hacia === datos.centro;
        const encendida = foco ? a.desde === foco || a.hacia === foco : central;
        return (
          <line key={`${a.desde}-${a.hacia}`} x1={p.x * ANCHO} y1={p.y * ALTO} x2={q.x * ANCHO} y2={q.y * ALTO}
            stroke={encendida ? 'var(--color-coffee-700)' : 'var(--color-coffee-300)'} strokeOpacity={encendida ? 0.75 : 0.35}
            strokeWidth={0.8 + 3.2 * (a.peso / pesoMax)} strokeLinecap="round">
            {a.relacion ? <title>{a.relacion}</title> : null}
          </line>
        );
      })}
      {datos.nodos.map((e) => {
        const p = pos.get(e.id)!;
        const r = radio(e);
        const atenuado = foco && foco !== e.id && !vecinosFoco.has(e.id);
        const nombre = e.nombre.length > 26 ? `${e.nombre.slice(0, 25)}…` : e.nombre;
        return (
          <g key={e.id} transform={`translate(${p.x * ANCHO} ${p.y * ALTO})`} opacity={atenuado ? 0.3 : 1} className="cursor-pointer outline-none focus-visible:[&>text]:underline"
            tabIndex={0} role="button" aria-label={`${e.nombre}, ${e.menciones} menciones en ${e.documentos} ${e.documentos === 1 ? 'documento' : 'documentos'}`}
            onMouseEnter={() => setFoco(e.id)} onMouseLeave={() => setFoco(null)} onFocus={() => setFoco(e.id)} onBlur={() => setFoco(null)}
            onClick={() => alElegir(e)} onKeyDown={(k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); alElegir(e); } }}>
            <FormaEntidad tipo={e.tipo} r={r} activa={e.id === datos.centro} />
            <text y={r + 16} textAnchor="middle" paintOrder="stroke" stroke="var(--color-cream-50)" strokeWidth={5} strokeLinejoin="round"
              fontSize={e.id === datos.centro ? 17 : 13.5} fontWeight={e.id === datos.centro ? 700 : 500} fill="var(--color-coffee-800)">{nombre}</text>
          </g>
        );
      })}
    </svg>
  );
});
