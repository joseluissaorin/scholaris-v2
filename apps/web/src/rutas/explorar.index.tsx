import { useEffect, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GrupoMapa, MapaConceptos } from '@scholaris/contrato';
import { avisar, BarraAvance, Boton, cx, Esqueleto, EsqueletoTexto, Folio, Rotulo, Vacio } from '@scholaris/ui';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { haceCuanto } from '../lib/formato';
import { esOscuro } from '../lib/acciones';

export const Route = createFileRoute('/explorar/')({
  loader: ({ context }) => context.consultas.ensureQueryData(q.mapa()),
  component: Mapa,
});

/** Colores de grupo: las tres tintas y sus mezclas con el papel, para que no parezca confeti. */
const TINTAS = ['#b8321c', '#23457a', '#e2a52a', '#22160f', '#8a4a32', '#5f7aa8', '#b88a2e', '#6b5a4c'];
const TINTAS_OSCURO = ['#e7644a', '#8fa9dc', '#ecbb52', '#efe6d6', '#c98a6e', '#a9bde4', '#d8b46a', '#b9a993'];

function Mapa() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery(q.mapa());
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
          <h2 className="text-[1.625rem] tracking-[-0.015em]">Cada punto es un pasaje; cada mancha, un tema.</h2>
          <p className="mt-1 text-tinta-2">Los pasajes que dicen cosas parecidas quedan cerca, vengan del libro que vengan. Pulsa un tema para leer sus pasajes.</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {data?.meta.construido ? <Rotulo>{data.meta.puntos?.toLocaleString('es-ES')} pasajes · hecho {haceCuanto(data.meta.construido)}</Rotulo> : null}
          <Boton variante="linea" icono="rayo" cargando={!!construyendo} onClick={() => void construir()}>Rehacer</Boton>
        </div>
      </div>
      {construyendo ? <div className="mt-4"><BarraAvance valor={construyendo.avance} etiqueta="Construyendo el mapa" /><Rotulo className="mt-2 block">{construyendo.mensaje}</Rotulo></div> : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        {isPending ? <Esqueleto className="aspect-[16/10]" /> : !data?.puntos.length ? (
          <Vacio forma="circulo" titulo="Aún no hay mapa." accion={<Boton variante="tinta" onClick={() => void construir()}>Construirlo</Boton>}>Se construye con los pasajes de tu biblioteca; con unos pocos documentos ya se ven temas.</Vacio>
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
                      <span className="min-w-0 flex-1 truncate italic">{g.etiqueta ?? `Tema ${g.indice + 1}`}</span>
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

  useEffect(() => {
    const c = lienzo.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = tam.w * dpr; c.height = tam.h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, tam.w, tam.h);
    const tintas = esOscuro() ? TINTAS_OSCURO : TINTAS;
    const r = tam.w < 600 ? 1.8 : 2.4;
    for (const p of mapa.puntos) {
      const apagado = elegido != null && p.grupo !== elegido;
      ctx.globalAlpha = apagado ? 0.12 : 0.78;
      ctx.fillStyle = tintas[p.grupo % tintas.length]!;
      ctx.beginPath();
      ctx.arc(p.x * tam.w, p.y * tam.h, elegido === p.grupo ? r + 0.8 : r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [mapa, tam, elegido]);

  return (
    <div ref={caja} className="relative aspect-[16/11] w-full overflow-hidden rounded-m border border-filete bg-hoja md:aspect-[16/10]">
      {/* Retícula de imprenta: se nota que existe. */}
      <div aria-hidden className="absolute inset-0 opacity-60" style={{ backgroundImage: 'linear-gradient(var(--s-hondo) 1px, transparent 1px), linear-gradient(90deg, var(--s-hondo) 1px, transparent 1px)', backgroundSize: '10% 10%' }} />
      <canvas ref={lienzo} className="absolute inset-0 h-full w-full" onClick={() => alElegir(null)} aria-hidden />
      {mapa.grupos.map((g) => (
        <button key={g.indice} type="button" onClick={(e) => { e.stopPropagation(); alElegir(elegido === g.indice ? null : g.indice); }}
          className={cx('absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-s px-2 py-1 text-[0.8125rem] italic transition-[opacity,background-color] md:text-[0.9375rem]',
            elegido === g.indice ? 'bg-tinta text-sobre-tinta' : 'bg-papel/85 text-tinta hover:bg-tinta hover:text-sobre-tinta', elegido != null && elegido !== g.indice && 'opacity-40')}
          style={{ left: `${g.x * 100}%`, top: `${g.y * 100}%` }} aria-pressed={elegido === g.indice}>
          {g.etiqueta ?? `Tema ${g.indice + 1}`}
        </button>
      ))}
      <span className="rotulo absolute bottom-2 right-3 text-apagado">{mapa.puntos.length.toLocaleString('es-ES')} puntos</span>
    </div>
  );
}

function Grupo({ grupo, color, alCerrar }: { grupo: GrupoMapa; color: string; alCerrar: () => void }) {
  const { data, isPending } = useQuery(q.grupo(grupo.indice));
  return (
    <div className="anim-entra">
      <button type="button" onClick={alCerrar} className="text-[0.8125rem] text-tinta-2 underline underline-offset-4">← Todos los temas</button>
      <div className="mt-3 flex items-center gap-2"><span className="h-4 w-4" style={{ background: color }} /><h3 className="text-[1.5rem] italic leading-tight">{grupo.etiqueta}</h3></div>
      <Rotulo className="mt-1 block">{grupo.tamano} pasajes</Rotulo>
      <ul className="mt-4 flex flex-col gap-3">
        {isPending ? [0, 1, 2].map((i) => <EsqueletoTexto key={i} lineas={3} />) : data?.miembros.map((m) => (
          <li key={m.id}>
            <Link to="/lector/$id" params={{ id: m.documento }} className="block rounded-s border border-filete bg-hoja p-3 hover:border-filete-fuerte">
              <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[0.8125rem] italic">{m.titulo}</span>{m.etiqueta ? <Folio>{m.etiqueta}</Folio> : null}</div>
              {m.texto ? <p className="mt-1.5 line-clamp-3 text-[0.875rem] text-tinta-2">{m.texto}</p> : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
