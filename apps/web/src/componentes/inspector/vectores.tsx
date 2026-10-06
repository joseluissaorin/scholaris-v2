/**
 * Los espacios vectoriales del documento (modelo, dimensiones, cuántos vectores
 * y de qué) y un mapa pequeño: una muestra de vectores proyectada a dos
 * dimensiones, con la forma de Kandinsky de cada objetivo (fragmento círculo
 * azul, página cuadrado rojo, figura triángulo amarillo).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ContenidoDocumento, DetalleDocumento, MapaVectores } from '@scholaris/contrato';
import { cx, Esqueleto } from '@scholaris/ui';
import { numero } from '../../lib/numero';
import { esMedio } from '../../lib/formato';
import { qi } from './consultas';
import { Apartado, pct } from './resumen';

const OBJETIVO: Record<string, { nombre: string; plural: string; color: string }> = {
  fragmento: { nombre: 'fragmento', plural: 'fragmentos', color: 'var(--s-azul)' },
  unidad: { nombre: 'página', plural: 'páginas', color: 'var(--s-rojo)' },
  figura: { nombre: 'figura', plural: 'figuras', color: 'var(--s-amarillo)' },
};

function Forma({ objetivo, x, y, r, activo }: { objetivo: string; x: number; y: number; r: number; activo?: boolean }) {
  const color = OBJETIVO[objetivo]?.color ?? 'var(--s-coffee-500)';
  const props = { fill: color, fillOpacity: activo ? 1 : 0.72, stroke: activo ? 'var(--s-coffee-900)' : 'none', strokeWidth: 1.5 };
  if (objetivo === 'unidad') return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} {...props} />;
  if (objetivo === 'figura') return <path d={`M${x} ${y - r * 1.2} L${x + r * 1.1} ${y + r * 0.8} L${x - r * 1.1} ${y + r * 0.8} Z`} {...props} />;
  return <circle cx={x} cy={y} r={r} {...props} />;
}

export function Vectores({ c, doc }: { c: ContenidoDocumento; doc: DetalleDocumento }) {
  const [espacio, setEspacio] = useState(c.espacios[0]?.id);
  return (
    <div className="flex flex-col gap-5">
      <Apartado titulo="Espacios vectoriales" descripcion="Los modelos que convirtieron el texto y las imágenes en vectores para buscar por significado. Un documento puede tener vectores de varios espacios.">
        {!c.espacios.length ? <p className="text-[0.875rem] text-apagado">Este documento aún no tiene vectores: se busca solo por texto.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {c.espacios.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setEspacio(e.id)} aria-pressed={espacio === e.id}
                  className={cx('block w-full rounded-xl border p-4 text-left shadow-[var(--relieve)] transition-[border-color]', espacio === e.id ? 'border-coffee-600 bg-cream-50' : 'border-cream-400 bg-cream-100/60 hover:border-cream-500')}>
                  <p className="font-mono text-[0.8125rem] font-semibold text-coffee-800">{e.modelo}</p>
                  <p className="mt-0.5 text-[0.75rem] text-apagado">{e.proveedor}{e.version ? ` · versión ${e.version}` : ''} · {numero(e.dims)} dimensiones{e.normalizado ? ' · normalizados' : ''}</p>
                  <p className="mt-2 text-[0.8125rem] text-coffee-700"><span className="font-semibold tnum">{numero(e.vectores)}</span> vectores: {Object.entries(e.porObjetivo).map(([k, n]) => `${numero(n)} ${n === 1 ? OBJETIVO[k]?.nombre ?? k : OBJETIVO[k]?.plural ?? k}`).join(', ')}</p>
                  <p className="mt-1 text-[0.75rem] text-apagado">Admite: {e.modalidades.join(', ')}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Apartado>
      {espacio ? <Mapa doc={doc} espacio={espacio} /> : null}
    </div>
  );
}

function Mapa({ doc, espacio }: { doc: DetalleDocumento; espacio: string }) {
  const { data, isPending, isError } = useQuery(qi.mapa(doc.id, espacio));
  const navegar = useNavigate();
  const [sobre, setSobre] = useState<number | null>(null);
  const [ocultos, setOcultos] = useState<Set<string>>(() => new Set());
  const W = 640, H = 380, M = 18;
  const puntos = useMemo(() => (data?.puntos ?? []).map((p, i) => ({ ...p, i, px: M + ((p.x + 1) / 2) * (W - 2 * M), py: M + ((1 - (p.y + 1) / 2)) * (H - 2 * M) })), [data]);
  const cuentas = useMemo(() => { const m = new Map<string, number>(); for (const p of puntos) m.set(p.objetivo, (m.get(p.objetivo) ?? 0) + 1); return m; }, [puntos]);
  const p = sobre != null ? puntos[sobre] : null;
  const ir = (x: MapaVectores['puntos'][number]) => {
    if (x.unidad == null) return;
    const medio = esMedio(doc.tipo);
    const t = /^(\d+):(\d{2})(?::(\d{2}))?/.exec(x.etiqueta);
    const seg = t ? (t[3] ? Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]) : Number(t[1]) * 60 + Number(t[2])) : 0;
    void navegar({ to: '/lector/$id', params: { id: doc.id }, search: medio ? { t: seg } : { u: x.unidad + 1 } });
  };
  return (
    <Apartado titulo="Mapa de los vectores" forma="cuadrado"
      descripcion={data ? `Una muestra de ${numero(data.puntos.length)} de ${numero(data.total)} vectores, proyectada a dos dimensiones (componentes principales). Lo que está cerca habla de lo mismo. Los dos ejes recogen el ${pct(data.varianza[0] + data.varianza[1])} de la variación.` : 'Una muestra de vectores proyectada a dos dimensiones: lo que está cerca habla de lo mismo.'}>
      {isPending ? <Esqueleto className="aspect-[640/380] w-full" /> : isError || !data ? <p className="text-[0.875rem] text-apagado">No se pudo dibujar el mapa.</p> : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {[...cuentas].map(([o, n]) => (
              <button key={o} type="button" aria-pressed={!ocultos.has(o)} onClick={() => setOcultos((s) => { const x = new Set(s); if (x.has(o)) x.delete(o); else x.add(o); return x; })}
                className={cx('inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[0.8125rem] shadow-[var(--relieve)]', ocultos.has(o) ? 'border-cream-400 bg-cream-200 text-apagado' : 'border-cream-400 bg-cream-50 text-coffee-700')}>
                <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden><Forma objetivo={o} x={0} y={0} r={4.5} /></svg>
                {numero(n)} {n === 1 ? OBJETIVO[o]?.nombre : OBJETIVO[o]?.plural}
              </button>
            ))}
          </div>
          <div className="relative overflow-hidden rounded-xl border border-cream-400 bg-cream-100 shadow-[var(--hundido)]">
            <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Mapa de ${numero(puntos.length)} vectores del espacio ${espacio}`} onPointerLeave={() => setSobre(null)}>
              <line x1={W / 2} y1={M} x2={W / 2} y2={H - M} stroke="var(--s-cream-400)" strokeDasharray="2 4" />
              <line x1={M} y1={H / 2} x2={W - M} y2={H / 2} stroke="var(--s-cream-400)" strokeDasharray="2 4" />
              {puntos.filter((x) => !ocultos.has(x.objetivo)).map((x) => (
                <g key={x.id} onPointerEnter={() => setSobre(x.i)} onClick={() => ir(x)} className={x.unidad != null ? 'cursor-pointer' : undefined}>
                  <Forma objetivo={x.objetivo} x={x.px} y={x.py} r={sobre === x.i ? 6 : 3.6} activo={sobre === x.i} />
                </g>
              ))}
              <text x={W - M} y={H / 2 + 14} textAnchor="end" className="fill-[var(--s-coffee-400)] text-[10px]">eje 1 · {pct(data.varianza[0])}</text>
              <text x={W / 2 + 6} y={M + 8} className="fill-[var(--s-coffee-400)] text-[10px]">eje 2 · {pct(data.varianza[1])}</text>
            </svg>
            {p ? (
              <div className="pointer-events-none absolute max-w-[18rem] rounded-xl border border-cream-400 bg-cream-50 p-2.5 text-[0.75rem] shadow-[var(--levantado)]"
                style={{ left: `min(calc(${(p.px / W) * 100}% + 10px), calc(100% - 18.5rem))`, top: `${(p.py / H) * 100}%` }}>
                <p className="font-semibold text-coffee-800">{OBJETIVO[p.objetivo]?.nombre ?? p.objetivo} · <span className="font-mono">{p.etiqueta}</span></p>
                <p className="mt-0.5 line-clamp-4 text-coffee-600">{p.texto || '—'}</p>
              </div>
            ) : null}
          </div>
          <p className="mt-2 text-[0.75rem] text-apagado">Pulsa un punto para abrirlo en el lector. Los números de los vectores no se enseñan: no dicen nada a simple vista.</p>
        </>
      )}
    </Apartado>
  );
}
