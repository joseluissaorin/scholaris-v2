import { useEffect, useMemo, useRef, useState } from 'react';
import { Resaltado } from '../lib/resaltado';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GrupoMapa, MapaConceptos } from '@scholaris/contrato';
import { avisar, BarraAvance, Boton, cx, Esqueleto, EsqueletoTexto, Folio, Rotulo, Vacio } from '@scholaris/ui';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { haceCuanto } from '../lib/formato';
import { esOscuro } from '../lib/acciones';
import { numero } from '../lib/numero';
import { Boceto } from '../bocetos/boceto';
import { quieto } from '../movimiento/preferencias';

export const Route = createFileRoute('/explorar/')({
  loader: ({ context }) => context.consultas.ensureQueryData(q.mapa()),
  component: Mapa,
});

/** Colores de grupo: las tres tintas y sus mezclas con el papel, para que no parezca confeti. */
const TINTAS = ['#b8321c', '#23457a', '#e2a52a', '#22160f', '#8a4a32', '#5f7aa8', '#b88a2e', '#6b5a4c'];
const TINTAS_OSCURO = ['#e7644a', '#8fa9dc', '#ecbb52', '#efe6d6', '#c98a6e', '#a9bde4', '#d8b46a', '#b9a993'];

/** Lleva las coordenadas a 0-1 con margen: la API puede darlas en cualquier escala. */
function normalizar(m: MapaConceptos): MapaConceptos {
  const xs = [...m.puntos.map((p) => p.x), ...m.grupos.map((g) => g.x)], ys = [...m.puntos.map((p) => p.y), ...m.grupos.map((g) => g.y)];
  if (!xs.length) return m;
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const fx = (x: number) => 0.06 + 0.88 * ((x - x0) / (x1 - x0 || 1)), fy = (y: number) => 0.08 + 0.84 * ((y - y0) / (y1 - y0 || 1));
  const grupos = m.grupos.map((g) => ({ ...g, x: fx(g.x), y: fy(g.y) }));
  // Los rótulos no se pisan: si dos chocan, el segundo baja una línea.
  const ordenados = [...grupos].sort((a, b) => a.y - b.y);
  for (let i = 0; i < ordenados.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = ordenados[j]!, b = ordenados[i]!;
      const ancho = ((a.etiqueta?.length ?? 8) + (b.etiqueta?.length ?? 8)) * 0.0045;
      if (Math.abs(a.x - b.x) < ancho && Math.abs(a.y - b.y) < 0.065) b.y = Math.min(0.96, a.y + 0.07);
    }
  }
  return { ...m, puntos: m.puntos.map((p) => ({ ...p, x: fx(p.x), y: fy(p.y) })), grupos };
}

function Mapa() {
  const qc = useQueryClient();
  const { data: crudo, isPending } = useQuery(q.mapa());
  const data = useMemo(() => (crudo ? normalizar(crudo) : undefined), [crudo]);
  const [elegido, setElegido] = useState<number | null>(null);
  const [construyendo, setConstruyendo] = useState<{ avance?: number; mensaje?: string } | null>(null);

  async function construir() {
    setConstruyendo({ mensaje: 'Empezando…' });
    try {
      for await (const e of api().mapa.construir()) {
        if (e.error) throw new Error(e.error);
        setConstruyendo({ avance: e.avance, mensaje: e.mensaje ?? e.fase });
        if (e.fin) break;
      }
      await qc.invalidateQueries({ queryKey: ['mapa'] });
      avisar('Mapa actualizado.', { tono: 'exito' });
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo construir el mapa.', { tono: 'error' }); }
    setConstruyendo(null);
  }

  return (
    <Lienzo>
      <div className="flex flex-wrap items-end gap-4">
        <div className="max-w-2xl">
          <h2 className="text-[1.125rem] font-semibold text-coffee-800">Cada punto es un pasaje; cada mancha, un tema.</h2>
          <p className="mt-1 text-tinta-2">Los pasajes que dicen cosas parecidas quedan cerca, vengan del libro que vengan. Pulsa un tema para leer sus pasajes.</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {data?.meta.construido ? <Rotulo>{numero(data.meta.puntos ?? data.puntos.length)} pasajes · hecho {haceCuanto(data.meta.construido)}</Rotulo> : null}
          <Boton variante="linea" icono="rayo" cargando={!!construyendo} onClick={() => void construir()}>Rehacer</Boton>
        </div>
      </div>
      {construyendo ? <div className="mt-4"><BarraAvance valor={construyendo.avance} etiqueta="Construyendo el mapa" /><Rotulo className="mt-2 block">{construyendo.mensaje}</Rotulo></div> : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        {isPending ? <Esqueleto className="aspect-[16/10]" /> : !data?.puntos.length ? (
          <Vacio forma="circulo" titulo="Aún no hay mapa." dibujo={<Boceto nombre="constelacion-vacia" decorativo />} accion={<Boton variante="tinta" onClick={() => void construir()}>Construirlo</Boton>}>Se construye con los pasajes de tu biblioteca; con unos pocos documentos ya se ven temas.</Vacio>
        ) : <Lamina mapa={data} elegido={elegido} alElegir={setElegido} />}
        <aside aria-label="Temas" className="min-w-0">
          {elegido != null && data ? <Grupo grupo={data.grupos[elegido]!} color={TINTAS[elegido % TINTAS.length]!} alCerrar={() => setElegido(null)} /> : (
            <>
              <Rotulo>Temas</Rotulo>
              <ul className="mt-3 flex flex-col">
                {data?.grupos.map((g) => (
                  <li key={g.indice}>
                    <button type="button" onClick={() => setElegido(g.indice)} className="flex w-full items-center gap-3 border-b border-filete py-2.5 text-left hover:bg-hondo/60">
                      <span className="h-3 w-3 shrink-0" style={{ background: TINTAS[g.indice % TINTAS.length] }} />
                      <span className="min-w-0 flex-1 truncate">{g.etiqueta ?? `Tema ${g.indice + 1}`}</span>
                      <span className="tnum font-mono text-[0.75rem] text-apagado">{g.tamano}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </Lienzo>
  );
}

/** El mapa en un lienzo: miles de puntos sin pesar en el DOM; los rótulos, en HTML accesible. */
function Lamina({ mapa, elegido, alElegir }: { mapa: MapaConceptos; elegido: number | null; alElegir: (i: number | null) => void }) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState({ w: 800, h: 500 });

  useEffect(() => {
    const el = caja.current!;
    const ro = new ResizeObserver(() => setTam({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // La primera vez, cada grupo florece desde su centro: sus puntos salen del rótulo y se abren a su sitio (en el lienzo, sin tocar el DOM).
  const florecido = useRef(false);
  useEffect(() => {
    const c = lienzo.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = tam.w * dpr; c.height = tam.h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const tintas = esOscuro() ? TINTAS_OSCURO : TINTAS;
    const r = tam.w < 600 ? 1.8 : 2.4;
    const centros = new Map(mapa.grupos.map((g) => [g.indice, g]));
    const pintar = (t: number) => {
      ctx.clearRect(0, 0, tam.w, tam.h);
      for (const p of mapa.puntos) {
        const apagado = elegido != null && p.grupo !== elegido;
        // Cada grupo empieza un poco después que el anterior; se abre con un rebote corto.
        const u = Math.max(0, Math.min(1, (t - (p.grupo % 12) * 0.05) / 0.6));
        if (u <= 0) continue;
        const e = 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2);
        const g = centros.get(p.grupo);
        const x = g ? g.x + (p.x - g.x) * e : p.x, y = g ? g.y + (p.y - g.y) * e : p.y;
        ctx.globalAlpha = (apagado ? 0.12 : 0.78) * Math.min(1, u * 1.6);
        ctx.fillStyle = tintas[p.grupo % tintas.length]!;
        ctx.beginPath();
        ctx.arc(x * tam.w, y * tam.h, (elegido === p.grupo ? r + 0.8 : r) * Math.min(1, 0.4 + u), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    if (florecido.current || quieto()) { pintar(2); return; }
    florecido.current = true;
    let raf = 0;
    const t0 = performance.now();
    const paso = (ahora: number) => { const t = (ahora - t0) / 1000; pintar(t); if (t < 1.3) raf = requestAnimationFrame(paso); };
    raf = requestAnimationFrame(paso);
    return () => { cancelAnimationFrame(raf); florecido.current = false; };
  }, [mapa, tam, elegido]);

  return (
    <div ref={caja} className="relative aspect-[16/11] w-full overflow-hidden rounded-2xl border border-cream-400 bg-cream-50 shadow-[var(--levantado)] md:aspect-[16/10]">
      {/* Retícula de imprenta: se nota que existe. */}
      <div aria-hidden className="absolute inset-0 opacity-60" style={{ backgroundImage: 'linear-gradient(var(--s-hondo) 1px, transparent 1px), linear-gradient(90deg, var(--s-hondo) 1px, transparent 1px)', backgroundSize: '10% 10%' }} />
      <canvas ref={lienzo} className="absolute inset-0 h-full w-full" onClick={() => alElegir(null)} aria-hidden />
      {mapa.grupos.map((g, k) => (
        <button key={g.indice} type="button" onClick={(e) => { e.stopPropagation(); alElegir(elegido === g.indice ? null : g.indice); }}
          className={cx('anim-sube absolute max-w-[48%] truncate whitespace-nowrap rounded-s px-2 py-1 text-[0.8125rem] transition-[opacity,background-color] md:text-[0.9375rem]',
            elegido === g.indice ? 'bg-tinta text-sobre-tinta' : 'bg-papel/85 text-tinta hover:bg-tinta hover:text-sobre-tinta', elegido != null && elegido !== g.indice && 'opacity-40')}
          // El rótulo se ancla según dónde cae: centrado en medio, por su izquierda junto al borde izquierdo y por su
          // derecha junto al derecho (igual arriba y abajo). Así nunca se sale de la lámina ni se corta.
          style={{ left: `${g.x * 100}%`, top: `${g.y * 100}%`, translate: `${-Math.min(1, Math.max(0, g.x)) * 100}% ${-Math.min(1, Math.max(0, g.y)) * 100}%`, animationDelay: `${(k % 12) * 50 + 260}ms` }} aria-pressed={elegido === g.indice} title={g.etiqueta ?? undefined}>
          {g.etiqueta ?? `Tema ${g.indice + 1}`}
        </button>
      ))}
      <span className="rotulo absolute bottom-2 right-3 text-apagado">{numero(mapa.puntos.length)} puntos</span>
    </div>
  );
}

function Grupo({ grupo, color, alCerrar }: { grupo: GrupoMapa; color: string; alCerrar: () => void }) {
  const { data, isPending } = useQuery(q.grupo(grupo.indice));
  return (
    <div className="anim-sube">
      <button type="button" onClick={alCerrar} className="text-[0.8125rem] text-tinta-2 underline underline-offset-4">← Todos los temas</button>
      <div className="mt-3 flex items-center gap-2"><span className="h-4 w-4" style={{ background: color }} /><h3 className="text-[1.5rem] leading-tight">{grupo.etiqueta}</h3></div>
      <Rotulo className="mt-1 block">{grupo.tamano} pasajes</Rotulo>
      <ul className="cascada mt-4 flex flex-col gap-3">
        {isPending ? [0, 1, 2].map((i) => <EsqueletoTexto key={i} lineas={3} />) : data?.miembros.map((m, k) => (
          <li key={m.id} style={{ ['--i' as string]: k }}>
            <Link to="/lector/$id" params={{ id: m.documento }} className="block rounded-xl border border-cream-400 bg-cream-50 shadow-[var(--levantado)] p-3 hover:border-filete-fuerte">
              <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[0.8125rem]">{m.titulo}</span>{m.etiqueta ? <Folio>{m.etiqueta}</Folio> : null}</div>
              {m.texto ? <p className="mt-1.5 line-clamp-3 text-[0.875rem] text-tinta-2"><Resaltado html={m.texto} /></p> : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
