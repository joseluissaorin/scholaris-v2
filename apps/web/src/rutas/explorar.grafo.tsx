import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { GrafoCitas, NodoGrafo } from '@scholaris/contrato';
import { cx, Esqueleto, Rotulo, Vacio } from '@scholaris/ui';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';

export const Route = createFileRoute('/explorar/grafo')({
  loader: ({ context }) => context.consultas.ensureQueryData(q.grafo()),
  component: Grafo,
});

/** Disposición por fuerzas, determinista y corta: con decenas de nodos sobra. */
function disponer(g: GrafoCitas) {
  const n = g.nodos.length;
  const pos = new Map(g.nodos.map((x, i) => [x.documento, { x: 0.5 + 0.34 * Math.cos((i / n) * Math.PI * 2), y: 0.5 + 0.34 * Math.sin((i / n) * Math.PI * 2) }]));
  for (let it = 0; it < 220; it++) {
    const fuerza = new Map(g.nodos.map((x) => [x.documento, { x: 0, y: 0 }]));
    for (const a of g.nodos) for (const b of g.nodos) {
      if (a === b) continue;
      const pa = pos.get(a.documento)!, pb = pos.get(b.documento)!;
      const dx = pa.x - pb.x, dy = pa.y - pb.y, d2 = Math.max(0.002, dx * dx + dy * dy);
      const f = fuerza.get(a.documento)!; f.x += (dx / d2) * 0.0009; f.y += (dy / d2) * 0.0009;
    }
    for (const e of g.aristas) {
      const pa = pos.get(e.desde), pb = pos.get(e.hacia);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const fa = fuerza.get(e.desde)!, fb = fuerza.get(e.hacia)!;
      fa.x += dx * 0.02; fa.y += dy * 0.02; fb.x -= dx * 0.02; fb.y -= dy * 0.02;
    }
    for (const x of g.nodos) {
      const p = pos.get(x.documento)!, f = fuerza.get(x.documento)!;
      p.x = Math.min(0.92, Math.max(0.08, p.x + f.x + (0.5 - p.x) * 0.01));
      p.y = Math.min(0.9, Math.max(0.1, p.y + f.y + (0.5 - p.y) * 0.01));
    }
  }
  return pos;
}

function Grafo() {
  const { data, isPending } = useQuery(q.grafo());
  const { data: huerfanas } = useQuery(q.huerfanas());
  const [foco, setFoco] = useState<string | null>(null);
  const pos = useMemo(() => (data ? disponer(data) : null), [data]);
  const vecinos = useMemo(() => new Set(data?.aristas.filter((e) => e.desde === foco || e.hacia === foco).flatMap((e) => [e.desde, e.hacia]) ?? []), [data, foco]);
  const nodo = data?.nodos.find((x) => x.documento === foco);

  return (
    <Lienzo>
      <h2 className="text-[1.625rem] tracking-[-0.015em]">Quién cita a quién dentro de tu biblioteca.</h2>
      <p className="mt-1 max-w-2xl text-tinta-2">El tamaño es cuántas veces lo citan tus documentos; el grosor de la línea, cuántas veces aparece la cita.</p>
      <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {isPending ? <Esqueleto className="aspect-[16/10]" /> : !data?.nodos.length ? <Vacio forma="triangulo" titulo="Sin citas que enlazar todavía.">El grafo aparece cuando tus documentos se citan entre sí.</Vacio> : (
          <svg viewBox="0 0 1000 620" className="w-full rounded-m border border-filete bg-hoja" role="img" aria-label="Grafo de citas">
            <defs><marker id="punta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--s-tinta-2)" /></marker></defs>
            {data.aristas.map((e, i) => {
              const a = pos!.get(e.desde), b = pos!.get(e.hacia);
              if (!a || !b) return null;
              const activo = !foco || e.desde === foco || e.hacia === foco;
              return <line key={i} x1={a.x * 1000} y1={a.y * 620} x2={b.x * 1000} y2={b.y * 620} stroke={activo && foco ? 'var(--s-rojo)' : 'var(--s-tinta-2)'} strokeOpacity={activo ? 0.7 : 0.12} strokeWidth={1 + e.peso * 0.5} markerEnd="url(#punta)" />;
            })}
            {data.nodos.map((x) => {
              const p = pos!.get(x.documento)!;
              const r = 10 + x.citadoPor * 7;
              const atenuado = foco && !vecinos.has(x.documento) && foco !== x.documento;
              return (
                <g key={x.documento} transform={`translate(${p.x * 1000} ${p.y * 620})`} className="cursor-pointer" opacity={atenuado ? 0.25 : 1}
                  onClick={() => setFoco(foco === x.documento ? null : x.documento)} onKeyDown={(e) => e.key === 'Enter' && setFoco(x.documento)} tabIndex={0} role="button" aria-label={`${x.titulo}, citado ${x.citadoPor} veces`}>
                  <circle r={r} fill={foco === x.documento ? 'var(--s-rojo)' : x.citadoPor >= 3 ? 'var(--s-tinta)' : x.citadoPor ? 'var(--s-azul)' : 'var(--s-hoja)'} stroke="var(--s-tinta)" strokeWidth="1.5" />
                  <text y={r + 18} textAnchor="middle" fontFamily="Georgia, serif" fontStyle="italic" fontSize="15" fill="var(--s-tinta)">{x.titulo.length > 28 ? `${x.titulo.slice(0, 27)}…` : x.titulo}</text>
                  <text y={r + 34} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" letterSpacing="0.06em" fill="var(--s-apagado)">{x.autores.toUpperCase()}{x.anio ? ` · ${x.anio}` : ''}</text>
                </g>
              );
            })}
          </svg>
        )}
        <aside className="flex flex-col gap-8">
          {nodo ? <FichaNodo nodo={nodo} data={data!} /> : <p className="text-[0.9375rem] text-tinta-2">Pulsa un documento para ver qué cita y quién lo cita.</p>}
          {huerfanas?.length ? (
            <div>
              <Rotulo>Citadas, pero no las tienes</Rotulo>
              <ul className="mt-3 flex flex-col gap-2">
                {huerfanas.map((h) => (
                  <li key={h.referencia} className="border-l-2 border-amarillo pl-3 text-[0.875rem]">
                    <p>{h.referencia}</p>
                    <Rotulo>citada por {h.citadaPor.length} de tus documentos</Rotulo>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </Lienzo>
  );
}

function FichaNodo({ nodo, data }: { nodo: NodoGrafo; data: GrafoCitas }) {
  const titulo = (id: string) => data.nodos.find((x) => x.documento === id)?.titulo ?? id;
  const cita = data.aristas.filter((e) => e.desde === nodo.documento);
  const citadoPor = data.aristas.filter((e) => e.hacia === nodo.documento);
  const lista = (es: typeof cita, campo: 'desde' | 'hacia') => (
    <ul className="mt-2 flex flex-col gap-1">{es.map((e) => <li key={e[campo]}><Link to="/lector/$id" params={{ id: e[campo] }} className="flex items-baseline gap-2 text-[0.9375rem] italic hover:underline"><span className="min-w-0 flex-1 truncate">{titulo(e[campo])}</span><span className="tnum font-mono text-[0.75rem] not-italic text-apagado">×{e.peso}</span></Link></li>)}</ul>
  );
  return (
    <div className="anim-entra">
      <h3 className="text-[1.375rem] italic leading-tight">{nodo.titulo}</h3>
      <Rotulo className="mt-1 block">{nodo.autores}{nodo.anio ? ` · ${nodo.anio}` : ''}</Rotulo>
      <Link to="/lector/$id" params={{ id: nodo.documento }} className="mt-3 inline-block text-[0.875rem] underline decoration-rojo decoration-2 underline-offset-4">Abrir</Link>
      <div className={cx('mt-5 grid gap-5')}>
        <div><Rotulo>Lo citan ({citadoPor.length})</Rotulo>{citadoPor.length ? lista(citadoPor, 'desde') : <p className="mt-2 text-[0.875rem] text-apagado">Nadie en tu biblioteca.</p>}</div>
        <div><Rotulo>Cita a ({cita.length})</Rotulo>{cita.length ? lista(cita, 'hacia') : <p className="mt-2 text-[0.875rem] text-apagado">A nadie de tu biblioteca.</p>}</div>
      </div>
    </div>
  );
}
