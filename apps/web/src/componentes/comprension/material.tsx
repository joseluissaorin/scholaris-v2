/**
 * El anclaje material, en pequeño y en todas partes: el recorte de una región
 * de una página o de un fotograma con la pluma roja alrededor, los caracteres de
 * un texto subrayados en su contexto y las palabras de un tramo de audio o vídeo
 * con sus tiempos. Lo usan las pruebas de Investigar, las apariciones de las
 * entidades, las alineaciones entre obras y la vista de la película.
 *
 * Nada de esto sustituye al lector: cada pieza enlaza al sitio exacto
 * (`enlaceAncla`), donde se ve la página entera o el vídeo en su segundo.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AnclaMaterial, Region } from '@scholaris/nucleo';
import type { UnidadVista } from '@scholaris/contrato';
import { cx, Icono } from '@scholaris/ui';
import { BLOQUE, q } from '../../datos/consultas';
import { busquedaDePrueba, textoDeCaracteres } from '../../lib/anclas';
import { contextoDeCaracteres, geometriaRecorte, segundoDe } from '../../lib/comprension';
import { tiempoACadena } from '../../lib/formato';
import { RecuadroMano } from '../comunes/recuadro-mano';
import { motor } from '../reproductor/motor';
import { buscarPasaje, construirTranscripcion } from '../reproductor/transcripcion';

/** Lo que hay que pasarle a `<Link>` para abrir el lector en un ancla (página y caracteres, o segundo y región). */
export function enlaceAncla(documento: string, ancla: AnclaMaterial, orden?: number) {
  return { to: '/lector/$id' as const, params: { id: documento }, search: busquedaDePrueba({ ancla, ...(orden != null ? { orden } : {}) }) };
}

// ---------------------------------------------------------------------------
// Datos del material: la unidad de una página o de un segundo, y los fotogramas
// ---------------------------------------------------------------------------

/** Una unidad por su orden de la web (desde 1), de la caché de bloques del lector. */
export function useUnidad(documento: string, orden: number | null | undefined): UnidadVista | undefined {
  const bloque = orden != null && orden > 0 ? Math.floor((orden - 1) / BLOQUE) : 0;
  const { data } = useQuery({ ...q.bloque(documento, bloque), enabled: orden != null && orden > 0 });
  return orden != null ? data?.find((u) => u.orden === orden) : undefined;
}

/** El orden (desde 1) de la unidad de un medio que suena en el segundo `t`, por los folios. */
export function useOrdenEnTiempo(documento: string, t: number | null): number | null {
  const { data } = useQuery({ ...q.folios(documento), enabled: t != null });
  return useMemo(() => {
    if (t == null || !data) return null;
    let mejor: number | null = null;
    for (const f of data.folios) if (f.t0 != null && f.t0 <= t + 0.01) mejor = f.orden;
    return mejor ?? data.folios[0]?.orden ?? null;
  }, [data, t]);
}

/** El fotograma clave más cercano a un segundo (el último que empieza antes), o nada si el vídeo no los tiene. */
export function useFotogramaEn(documento: string, t: number | null, activo = true): { url: string; t: number; descripcion?: string } | null {
  const { data } = useQuery({ ...q.figuras(documento), enabled: activo && t != null });
  return useMemo(() => {
    if (t == null || !data) return null;
    const fs = data.filter((f) => f.t != null && f.imagenUrl);
    let mejor: (typeof fs)[number] | undefined;
    for (const f of fs) if (f.t! <= t + 1.5 && (!mejor || f.t! > mejor.t!)) mejor = f;
    mejor ??= fs.sort((a, b) => Math.abs(a.t! - t) - Math.abs(b.t! - t))[0];
    return mejor ? { url: mejor.imagenUrl, t: mejor.t!, ...(mejor.descripcion ? { descripcion: mejor.descripcion } : {}) } : null;
  }, [data, t]);
}

// ---------------------------------------------------------------------------
// El recorte de una región
// ---------------------------------------------------------------------------

/**
 * El trozo de una imagen (página o fotograma) alrededor de una región, con la
 * región rodeada a mano. Con `conEntera`, un botón alterna con la imagen entera.
 * La caja nunca pasa de `altoMax` de alto: se estrecha en vez de crecer.
 */
export const RecorteRegion = memo(function RecorteRegion({ src, region, aspectoInicial = 1 / 1.414, etiqueta, clave, conEntera, altoMax = 12, holgura = 0.35, tinta, className, oscuro }: {
  src: string;
  region: Region;
  /** Ancho/alto de la imagen entera hasta que se sepa el real. */
  aspectoInicial?: number;
  etiqueta: string;
  clave?: string;
  conEntera?: boolean;
  /** Alto máximo en rem. */
  altoMax?: number;
  holgura?: number;
  tinta?: 'rojo' | 'azul' | 'amarillo' | 'crema';
  className?: string;
  /** Sobre una bandeja oscura (fotogramas): el filo es más claro. */
  oscuro?: boolean;
}) {
  const [aspecto, setAspecto] = useState(aspectoInicial);
  const [entera, setEntera] = useState(false);
  const g = useMemo(() => geometriaRecorte(region, aspecto, holgura), [region, aspecto, holgura]);
  const proporcion = entera ? aspecto : g.aspecto;
  return (
    <div className={cx('relative', className)}>
      <div
        role="img"
        aria-label={entera ? `${etiqueta} (imagen entera)` : etiqueta}
        className={cx('relative mx-auto overflow-hidden rounded-[3px] bg-white', oscuro ? 'ring-1 ring-white/15' : 'ring-1 ring-cream-400')}
        style={{ aspectRatio: String(proporcion), width: '100%', maxWidth: `calc(${altoMax}rem * ${proporcion})` }}
      >
        <img
          src={src} alt="" loading="lazy" decoding="async" draggable={false}
          onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setAspecto(i.naturalWidth / i.naturalHeight); }}
          className={cx('absolute max-w-none select-none', entera && 'inset-0 h-full w-full')}
          style={entera ? undefined : g.imagen}
        />
        <RecuadroMano region={entera ? region : g.marca} clave={`${clave ?? src.slice(-24)}|${entera ? 'e' : 'r'}`} etiqueta={etiqueta} {...(tinta ? { tinta } : {})} />
      </div>
      {conEntera ? (
        <button type="button" onClick={() => setEntera((x) => !x)} aria-pressed={entera}
          className="absolute right-1.5 top-1.5 flex h-7 items-center gap-1 rounded-lg bg-[rgb(26_15_10/0.78)] px-2 text-[0.6875rem] font-semibold text-cream-50 shadow-[0_2px_8px_rgb(0_0_0/0.3)] hover:bg-[rgb(26_15_10/0.9)]">
          <Icono nombre={entera ? 'buscar' : 'imagen'} tam={12} />{entera ? 'Ver el detalle' : 'Ver entera'}
        </button>
      ) : null}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Caracteres en su texto
// ---------------------------------------------------------------------------

const limpiar = (t: string) => t.replace(/\*\*([^*\n]+?):\*\*\s*/g, '$1: ').replace(/^#+\s+/gm, '').replace(/\*\*/g, '').replace(/\s+/g, ' ');

/** El texto de una unidad con los caracteres [inicio, fin) subrayados en su contexto (en Georgia, como se lee). */
export function TextoSenalado({ texto, caracteres, margen = 140, className }: { texto: string; caracteres: readonly [number, number]; margen?: number; className?: string }) {
  const [pre, dentro, post] = contextoDeCaracteres(texto, caracteres, margen);
  if (!dentro.trim()) return null;
  return (
    <p className={cx('font-serif text-[0.875rem] leading-snug text-coffee-700', className)}>
      {limpiar(pre)}<mark className="text-coffee-900">{limpiar(dentro)}</mark>{limpiar(post)}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Palabras de un tramo de audio o vídeo
// ---------------------------------------------------------------------------

/**
 * Las palabras que se oyen en un ancla de un medio, con las del ancla marcadas
 * (por sus caracteres o por su tramo). Cada palabra lleva su instante: al
 * pulsarla se va ahí, y con `vivo` la que suena se enciende.
 */
export function PalabrasDelTramo({ documento, ancla, alrededor = 18, vivo, alIr, className }: {
  documento: string;
  ancla: AnclaMaterial;
  alrededor?: number;
  vivo?: boolean;
  alIr?: (t: number) => void;
  className?: string;
}) {
  const t = segundoDe(ancla);
  const orden = useOrdenEnTiempo(documento, ancla.tipo === 'tiempo' ? ancla.t0 : null);
  const u = useUnidad(documento, orden);
  const datos = useMemo(() => {
    if (!u || ancla.tipo !== 'tiempo') return null;
    const tr = construirTranscripcion([u]);
    if (!tr.palabras.length) return null;
    let desde = -1, hasta = -1;
    if (ancla.caracteres) {
      const texto = textoDeCaracteres(u.texto, ancla.caracteres);
      const r = texto ? buscarPasaje(tr.palabras, texto) : null;
      if (r) { desde = r.desde; hasta = r.hasta; }
    }
    if (desde < 0) {
      tr.palabras.forEach((w, i) => { if (w.t0 >= ancla.t0 - 0.05 && w.t1 <= ancla.t1 + 0.05) { if (desde < 0) desde = i; hasta = i + 1; } });
    }
    const a = Math.max(0, (desde < 0 ? 0 : desde) - alrededor), b = Math.min(tr.palabras.length, (hasta < 0 ? alrededor * 2 : hasta) + alrededor);
    return { tr, desde, hasta, a, b };
  }, [u, ancla, alrededor]);
  const [ahora, setAhora] = useState(-1);
  useEffect(() => {
    if (!vivo || !datos) return;
    return motor().escucharTiempo((s) => {
      const w = datos.tr.palabras;
      let k = -1;
      for (let i = datos.a; i < datos.b; i++) if (w[i]!.t0 <= s && s < w[i]!.t1 + 0.15) { k = i; break; }
      setAhora(k);
    });
  }, [vivo, datos]);
  if (!datos) return t != null ? <p className={cx('text-[0.8125rem] text-apagado', className)}>{tiempoACadena(t)}</p> : null;
  const { tr, desde, hasta, a, b } = datos;
  // Un tramo sin palabras (música, silencio, una escena muda): no se enseña el diálogo de otro sitio.
  if (desde < 0) return <p className={cx('text-[0.8125rem] text-apagado', className)}>No se habla en este tramo ({tiempoACadena(ancla.tipo === 'tiempo' ? ancla.t0 : 0)}).</p>;
  const hablantes = tr.hablantes;
  return (
    <p className={cx('font-serif text-[0.875rem] leading-relaxed text-coffee-700', className)}>
      {a > 0 ? '… ' : ''}
      {tr.palabras.slice(a, b).map((w, j) => {
        const i = a + j;
        const nuevoTurno = i === a || tr.palabras[i - 1]!.h !== w.h;
        const dentro = i >= desde && i < hasta;
        const palabra = (
          <span className="palabra-tramo" data-dentro={dentro ? '' : undefined} data-ahora={ahora === i ? '' : undefined}>
            {alIr ? <button type="button" onClick={() => alIr(w.t0)} className="rounded-[3px] hover:underline hover:decoration-cream-500 hover:underline-offset-2" aria-label={`${w.texto}, ${tiempoACadena(w.t0)}`}>{w.texto}</button> : w.texto}
          </span>
        );
        return (
          <span key={i}>
            {nuevoTurno && w.h >= 0 && hablantes[w.h] ? <span className="mr-1 font-sans text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-coffee-500">{hablantes[w.h]}</span> : null}
            {palabra}{' '}
          </span>
        );
      })}
      {b < tr.palabras.length ? '…' : ''}
      {desde >= 0 ? <span className="ml-1 font-mono text-[0.6875rem] text-apagado">{tiempoACadena(tr.palabras[desde]!.t0)}</span> : null}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Un ancla, sea del medio que sea
// ---------------------------------------------------------------------------

/**
 * Lo que señala un ancla, en pequeño: en un libro, el recorte de la región de la
 * página (si la hay) y los caracteres en su contexto; en un vídeo, el fotograma
 * de su instante con la región y las palabras del tramo; en audio, las palabras.
 */
export function VistaAncla({ documento, ancla, cita, recorte = true, palabras = true, texto = true, vivo, alIr, className, altoMax }: {
  documento: string;
  ancla: AnclaMaterial;
  /** Lo que dice (si no hay texto en la unidad): se enseña tal cual. */
  cita?: string;
  recorte?: boolean;
  palabras?: boolean;
  /** Los caracteres en su contexto (en una página). Sin él, solo el recorte. */
  texto?: boolean;
  vivo?: boolean;
  alIr?: (t: number) => void;
  className?: string;
  altoMax?: number;
}) {
  const { data: doc } = useQuery(q.documento(documento));
  const esVideo = doc?.tipo === 'video';
  const orden = ancla.tipo === 'pagina' ? ancla.fisica : ancla.tipo === 'diapositiva' ? ancla.n : null;
  const u = useUnidad(documento, orden);
  const segundo = segundoDe(ancla);
  const fotograma = useFotogramaEn(documento, esVideo && recorte ? segundo : null, esVideo);
  const region = ancla.region;
  const imagen = ancla.tipo === 'tiempo' ? fotograma?.url : u?.imagenUrl ?? u?.miniaturaUrl;
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      {recorte && imagen ? (
        region ? (
          <div className={cx('rounded-lg p-1.5 shadow-[var(--hundido)]', ancla.tipo === 'tiempo' ? 'bg-[rgb(26_15_10/0.88)]' : 'bg-cream-200')}>
            <RecorteRegion src={imagen} region={region} aspectoInicial={ancla.tipo === 'tiempo' ? 16 / 9 : 1 / 1.414} oscuro={ancla.tipo === 'tiempo'} {...(altoMax ? { altoMax } : {})}
              etiqueta={ancla.tipo === 'tiempo' ? `La región del fotograma de ${tiempoACadena(segundo ?? 0)}` : 'La región de la página'} clave={`${documento}|${JSON.stringify(region)}`} />
          </div>
        ) : ancla.tipo === 'tiempo' ? (
          <div className="rounded-lg bg-[rgb(26_15_10/0.88)] p-1.5 shadow-[var(--hundido)]">
            <img src={imagen} alt={fotograma?.descripcion ? `Fotograma: ${fotograma.descripcion}` : `Fotograma de ${tiempoACadena(segundo ?? 0)}`} loading="lazy" className="mx-auto block max-h-40 w-auto max-w-full rounded-[3px]" />
          </div>
        ) : null
      ) : null}
      {ancla.tipo === 'tiempo' && palabras && (ancla.caracteres || !region) ? (
        <PalabrasDelTramo documento={documento} ancla={ancla} {...(vivo ? { vivo } : {})} {...(alIr ? { alIr } : {})} />
      ) : texto && ancla.caracteres && u?.texto ? (
        <TextoSenalado texto={u.texto} caracteres={ancla.caracteres} />
      ) : cita ? (
        <p className="text-[0.8125rem] leading-snug text-coffee-700">{cita}</p>
      ) : null}
    </div>
  );
}

/** El fotograma clave del instante del motor (la demostración no tiene vídeo: se ve su guion gráfico). */
export function FotogramaVirtual({ documento, className }: { documento: string; className?: string }) {
  const { data } = useQuery(q.figuras(documento));
  const fs = useMemo(() => (data ?? []).filter((f) => f.t != null && f.imagenUrl).sort((a, b) => a.t! - b.t!), [data]);
  const [i, setI] = useState(-1);
  useEffect(() => {
    if (!fs.length) return;
    return motor().escucharTiempo((t) => {
      let k = 0;
      // El último fotograma que empieza antes (o muy poco después: los clave suelen ir un segundo dentro del plano).
      for (let j = 0; j < fs.length; j++) if (fs[j]!.t! <= t + 1.5) k = j; else break;
      setI((x) => (x === k ? x : k));
    });
  }, [fs]);
  const f = fs[i];
  if (!f) return null;
  return <img src={f.imagenUrl} alt={f.descripcion ? `Fotograma: ${f.descripcion}` : ''} className={cx('absolute inset-0 h-full w-full object-cover', className)} />;
}

/**
 * Una página entera con la región de un ancla rodeada (o, sin imagen, el
 * facsímil con su texto), y debajo los caracteres subrayados en su contexto.
 * Es el lado «páginas» de la vista lado a lado.
 */
export function PaginaConRegion({ documento, ancla, className }: { documento: string; ancla: AnclaMaterial; className?: string }) {
  const orden = ancla.tipo === 'pagina' ? ancla.fisica : ancla.tipo === 'diapositiva' ? ancla.n : null;
  const u = useUnidad(documento, orden);
  const imagen = u?.imagenUrl ?? u?.miniaturaUrl;
  const region = ancla.region;
  return (
    <div className={cx('flex flex-col gap-3', className)}>
      {imagen ? (
        <div className="rounded-xl bg-cream-200 p-2 shadow-[var(--hundido)]">
          <div className="relative mx-auto w-full max-w-[min(100%,calc(52dvh/1.414))]">
            <img src={imagen} alt={`Página ${u?.etiqueta ?? ''}`} className="block w-full rounded-[3px] bg-white shadow-hoja" />
            {region ? <RecuadroMano key={JSON.stringify(region)} region={region} clave={`${documento}|${orden}|${region.x},${region.y}`} etiqueta={`La región de ${u?.etiqueta ?? 'la página'} que señala la correspondencia`} /> : null}
          </div>
        </div>
      ) : null}
      {ancla.caracteres && u?.texto ? <TextoSenalado texto={u.texto} caracteres={ancla.caracteres} margen={220} className="text-[0.9375rem]" /> : !u ? <span className="esqueleto block h-24 rounded-xl" /> : null}
    </div>
  );
}
