/**
 * El flujo de páginas: imagen y texto lado a lado en la MISMA fila, así que el
 * desplazamiento va sincronizado por construcción. Virtualizado: solo existen
 * en el DOM (y solo se descargan) las páginas que se ven y las de al lado.
 */
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { DetalleDocumento, UnidadVista } from '@scholaris/contrato';
import { cx, EsqueletoTexto, Esqueleto, Folio, Rotulo } from '@scholaris/ui';
import { BLOQUE, q } from '../../datos/consultas';
import { Markdown } from './markdown';
import { Facsimil } from './facsimil';
import { etiquetaCorta } from '../../lib/formato';
import { paginaPrevia, usePrevia, type PaginaPrevia } from '../../datos/previa';
import { altPagina, MarcasFiguras, useFigurasDePagina } from '../inspector/marcas-pagina';
import { useFigurasDocumento } from '../inspector/figuras';

function unidadDePrevia(p: PaginaPrevia): UnidadVista {
  return {
    id: `previa-${p.fisica}`, orden: p.fisica, texto: p.texto, lector: 'imprenta', confianza: 0.5,
    ancla: { tipo: 'pagina', fisica: p.fisica, impresa: p.impresa, romana: false, origen: p.impresa ? 'leido' : 'ninguno', confianza: 1 },
    etiqueta: p.impresa ? `p. ${p.impresa}` : `[${p.fisica}]`,
    ...(p.imagenUrl ? { imagenUrl: p.imagenUrl } : {}),
  };
}

export type ModoLectura = 'ambas' | 'pagina' | 'texto';

export interface ManejadorFlujo { irA: (orden: number, suave?: boolean) => void }

const bloqueDe = (orden: number) => Math.floor((orden - 1) / BLOQUE);

/** Lee una unidad de la caché (para la selección y la cita). */
export function useUnidadEnCache(id: string) {
  const qc = useQueryClient();
  return useCallback((orden: number) => qc.getQueryData<UnidadVista[]>(['unidades', id, bloqueDe(orden)])?.find((u) => u.orden === orden), [qc, id]);
}

function soloTexto(tipo: DetalleDocumento['tipo']) {
  return tipo === 'epub' || tipo === 'documento' || tipo === 'web' || tipo === 'hoja';
}

export const Flujo = memo(forwardRef<ManejadorFlujo, {
  doc: DetalleDocumento; modo: ModoLectura; inicial: number; resaltar?: string; destacar?: string; leidas?: number;
  /** Unidades totales si se conocen antes que el servidor (la imprenta ya las contó). */
  total?: number;
  alVer: (orden: number) => void;
}>(function Flujo({ doc, modo, inicial, resaltar, destacar, leidas, total: totalConocido, alVer }, ref) {
  const total = Math.max(doc.unidades, totalConocido ?? 0);
  const contenedor = useRef<HTMLDivElement>(null);
  const [margen, setMargen] = useState(0);
  const texto = soloTexto(doc.tipo);
  const apaisada = doc.tipo === 'presentacion';
  const modoReal: ModoLectura = texto ? 'texto' : modo;

  useLayoutEffect(() => { setMargen((contenedor.current?.getBoundingClientRect().top ?? 0) + window.scrollY); }, []);

  const qc = useQueryClient();
  const estimar = useCallback((i: number) => {
    const ancho = contenedor.current?.clientWidth ?? 900;
    if (modoReal === 'texto') {
      // Con el texto ya en la caché, la altura se calcula por su longitud y el ancho real de la
      // columna: en el móvil una página mide el triple que en el escritorio y, con una cifra fija,
      // la primera medición empujaba las siguientes (CLS de 0,47 en el lector del móvil).
      const u = qc.getQueryData<UnidadVista[]>(q.bloque(doc.id, bloqueDe(i + 1)).queryKey)?.find((x) => x.orden === i + 1);
      if (u) {
        const columna = Math.min(ancho, 720);
        const porLinea = Math.max(24, Math.floor(columna / 8.4));
        const lineas = u.texto.split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / porLinea)), 0);
        return Math.round(lineas * 29 + 96);
      }
      return Math.round((texto ? 150 : 560) * Math.max(1, 700 / Math.max(320, ancho)));
    }
    const col = modoReal === 'pagina' ? Math.min(ancho, 760) : ancho * 0.46;
    return col * (apaisada ? 0.5625 : 1.414) + 64;
  }, [modoReal, texto, apaisada, qc, doc.id]);

  // El margen superior descuenta la barra del lector, que va pegada arriba.
  const v = useWindowVirtualizer({ count: total, estimateSize: estimar, overscan: 2, scrollMargin: margen, scrollPaddingStart: 84 });

  // La página que se está leyendo: la que cruza una línea a 30 % de la ventana.
  useEffect(() => {
    let h = 0;
    const medir = () => {
      cancelAnimationFrame(h);
      h = requestAnimationFrame(() => {
        const linea = window.scrollY + window.innerHeight * 0.3;
        const it = v.getVirtualItems().find((x) => x.start <= linea && x.end > linea);
        if (it) alVer(it.index + 1);
      });
    };
    window.addEventListener('scroll', medir, { passive: true });
    medir();
    return () => { window.removeEventListener('scroll', medir); cancelAnimationFrame(h); };
  }, [v, alVer]);

  useImperativeHandle(ref, () => ({
    irA: (orden, suave) => v.scrollToIndex(Math.max(0, Math.min(total - 1, orden - 1)), { align: 'start', behavior: suave ? 'smooth' : 'auto' }),
  }), [v, total]);

  // Primera posición: la del enlace (ancla, cita, resultado).
  const yaSituado = useRef(false);
  useEffect(() => {
    if (yaSituado.current || !margen) return;
    yaSituado.current = true;
    if (inicial > 1) {
      v.scrollToIndex(inicial - 1, { align: 'start' });
      // Segunda pasada cuando las alturas reales ya se han medido.
      setTimeout(() => v.scrollToIndex(inicial - 1, { align: 'start' }), 260);
    }
  }, [margen, inicial, v]);

  return (
    <div ref={contenedor} className="relative" style={{ height: v.getTotalSize() }}>
      {v.getVirtualItems().map((it) => (
        // `top` y no `transform`: el folio pegado (sticky) no ve las transformaciones.
        <div key={it.key} data-index={it.index} ref={v.measureElement} className="absolute inset-x-0" style={{ top: it.start - v.options.scrollMargin }}>
          <Fila docId={doc.id} orden={it.index + 1} modo={modoReal} texto={texto} apaisada={apaisada} resaltar={resaltar} destacar={inicial === it.index + 1 ? destacar : undefined} pendiente={leidas != null && it.index + 1 > leidas} procesando={doc.estado !== 'listo'} titulillo={doc.metadatos.titulo} />
        </div>
      ))}
    </div>
  );
}));

const Fila = memo(function Fila({ docId, orden, modo, texto, apaisada, resaltar, destacar, pendiente: pendienteServidor, procesando, titulillo }: {
  docId: string; orden: number; modo: ModoLectura; texto: boolean; apaisada: boolean; resaltar?: string; destacar?: string; pendiente: boolean; procesando: boolean; titulillo: string;
}) {
  const { data } = useQuery({ ...q.bloque(docId, bloqueDe(orden)), enabled: !pendienteServidor });
  usePrevia(docId);
  // Mientras el servidor lee, la página sale de lo que ya imprimió el navegador.
  const previa = procesando ? paginaPrevia(docId, orden) : undefined;
  const u = data?.find((x) => x.orden === orden) ?? (previa ? unidadDePrevia(previa) : undefined);
  const esPrevia = !!previa && !data?.some((x) => x.orden === orden);
  const pendiente = pendienteServidor && !previa;
  // Si la imagen no llega, la página sigue siendo una página: el facsímil con su texto.
  const [imagenRota, setImagenRota] = useState(false);
  // Las figuras de esta página: marcadas sobre la imagen, y descritas en su texto alternativo.
  const figuras = useFigurasDePagina(docId, orden);
  const { figuras: todas } = useFigurasDocumento(docId, figuras.length > 0);
  const [aspectoImagen, setAspectoImagen] = useState<number | null>(null);

  if (texto) {
    return (
      <section data-orden={orden} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 py-3 md:grid-cols-[7rem_minmax(0,42rem)] md:gap-8">
        <div className="pt-1 text-right">{u ? <Folio className="justify-end">{etiquetaCorta(u.ancla, u.etiqueta)}</Folio> : <Esqueleto className="ml-auto h-3 w-12" />}</div>
        <div className="lectura min-w-0">{u ? <Markdown texto={u.texto} q={resaltar} destacar={destacar} /> : <EsqueletoTexto lineas={4} />}</div>
      </section>
    );
  }

  const folio = u?.ancla.tipo === 'pagina' ? u.ancla : null;
  // Los documentos migrados de la v1 solo guardan la vista previa de cada página: mejor eso que el facsímil.
  const imagenPagina = u?.imagenUrl ?? u?.miniaturaUrl;
  const pagina = (
    <div className={cx('relative', modo === 'pagina' && 'mx-auto w-full max-w-[46rem]')}>
      {pendiente ? (
        <div className={cx('grid w-full place-items-center rounded-md border border-dashed border-filete-fuerte bg-hondo/40', apaisada ? 'aspect-[16/9]' : 'aspect-[1/1.414]')}>
          <span className="flex items-center gap-2 text-[0.875rem] text-apagado"><span className="h-1.5 w-1.5 rounded-full bg-rojo anim-pulso" />Leyendo esta página…</span>
        </div>
      ) : imagenPagina && !imagenRota ? (
        <div className="relative">
          <img src={imagenPagina} alt={altPagina(u?.etiqueta ?? '', figuras)} loading="lazy" decoding="async" onError={() => setImagenRota(true)} onLoad={(e) => setAspectoImagen(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} className={cx('w-full rounded-md bg-white object-contain shadow-hoja', apaisada ? 'aspect-[16/9]' : 'aspect-[1/1.414]')} />
          <MarcasFiguras documento={docId} figuras={figuras} aspecto={aspectoImagen ? { imagen: aspectoImagen, caja: apaisada ? 16 / 9 : 1 / 1.414 } : undefined} todas={todas.filter((f) => f.ancla.tipo !== 'tiempo')} alIr={() => undefined} />
        </div>
      ) : u ? (
        <Facsimil texto={u.texto} folio={folio?.impresa} titulillo={orden % 2 ? titulillo : undefined} apaisada={apaisada} />
      ) : (
        <Esqueleto className={cx('w-full', apaisada ? 'aspect-[16/9]' : 'aspect-[1/1.414]')} />
      )}
      {modo === 'pagina' && u ? <Folio grande className="absolute -left-2 top-3 -translate-x-full max-md:hidden">{u.etiqueta}</Folio> : null}
    </div>
  );

  if (modo === 'pagina') return <section data-orden={orden} aria-label={u ? `Página ${u.etiqueta}` : undefined} className="py-5">{pagina}</section>;

  const columnaTexto = (
    <div className="min-w-0">
      <div className="folio-pegado z-10 mb-4 flex items-center gap-3 rounded-xl bg-cream-100/85 py-1 backdrop-blur-sm">
        {u ? <Folio grande dudoso={!!folio && folio.confianza < 0.75}>{u.etiqueta}</Folio> : <Esqueleto className="h-5 w-14" />}
        {folio ? <Rotulo>física {folio.fisica}{folio.origen === 'deducido' ? ' · folio deducido' : ''}</Rotulo> : null}
        {esPrevia ? <Rotulo className="ml-auto text-rojo">Vista previa · aún se está leyendo</Rotulo> : null}
      </div>
      {pendiente ? <p className="text-[0.875rem] text-apagado">El texto llegará en cuanto se lea esta página.</p> : u && !u.texto.trim() && !esPrevia ? <p className=" text-apagado">Página sin texto: en blanco, guarda o lámina.</p> : u ? <Markdown texto={u.texto} q={resaltar} destacar={destacar} className="lectura" /> : <EsqueletoTexto lineas={9} />}
    </div>
  );

  if (modo === 'texto') return <section data-orden={orden} className="mx-auto max-w-[42rem] border-b border-filete py-8">{columnaTexto}</section>;

  return (
    <section data-orden={orden} aria-label={u ? `Página ${u.etiqueta}` : undefined} className="grid grid-cols-1 gap-6 border-b border-filete py-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-10">
      <div className="max-lg:hidden">{pagina}</div>
      {columnaTexto}
    </section>
  );
});
