/**
 * Las partes «de ficha» del inspector: la ficha con la procedencia de cada
 * campo, las cifras, quién leyó qué, de dónde salen los folios, la procedencia
 * de la ingesta (fases, proveedores, tiempos y coste), los hablantes, las
 * entidades y el fichero.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContenidoDocumento, DetalleDocumento } from '@scholaris/contrato';
import type { Autor, FuenteMetadato, MetadatosDocumento } from '@scholaris/nucleo';
import { avisar, cx, Esqueleto, Icono, Rotulo } from '@scholaris/ui';
import { numero } from '../../lib/numero';
import { bytes, duracion, fecha, NOMBRE_TIPO } from '../../lib/formato';
import { FormaHablante } from '../reproductor/hablantes';
import { qi } from './consultas';
import { nombreIdioma, nombreTipoCsl } from '../../lib/nombres';

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------

export function Apartado({ titulo, forma = 'circulo', descripcion, accion, children, className }: { titulo: ReactNode; forma?: 'circulo' | 'cuadrado' | 'triangulo'; descripcion?: ReactNode; accion?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-2xl border border-cream-400 bg-cream-50 p-5 shadow-[var(--levantado)] sm:p-6', className)}>
      <header className="mb-4 flex items-start gap-3">
        <span aria-hidden className={cx('mt-1.5 shrink-0', forma === 'circulo' ? 'h-2.5 w-2.5 rounded-full bg-azul' : forma === 'cuadrado' ? 'h-2.5 w-2.5 bg-rojo' : 'h-0 w-0 border-x-[6px] border-b-[10px] border-x-transparent border-b-amarillo')} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[1rem] font-semibold text-coffee-800">{titulo}</h2>
          {descripcion ? <p className="mt-0.5 text-[0.8125rem] text-coffee-500">{descripcion}</p> : null}
        </div>
        {accion}
      </header>
      {children}
    </section>
  );
}

/** Carril hundido con su parte llena: confianza, proporciones, tiempos. */
export function Carril({ valor, tono = 'tinta', className }: { valor: number; tono?: 'tinta' | 'rojo' | 'azul' | 'amarillo' | 'verde'; className?: string }) {
  const color = { tinta: 'bg-coffee-700', rojo: 'bg-rojo', azul: 'bg-azul', amarillo: 'bg-amarillo', verde: 'bg-verde' }[tono];
  return (
    <span className={cx('block h-1.5 overflow-hidden rounded-full bg-cream-300 shadow-[var(--hundido)]', className)} aria-hidden>
      <span className={cx('block h-full rounded-full', color)} style={{ width: `${Math.max(0, Math.min(1, valor)) * 100}%` }} />
    </span>
  );
}

export const pct = (x: number) => `${numero(Math.round(x * 100))} %`;
export const ms = (x: number) => (x >= 60_000 ? `${numero(Math.floor(x / 60_000))} min ${numero(Math.round((x % 60_000) / 1000))} s` : x >= 1000 ? `${numero(x / 1000, { maximumFractionDigits: 1 })} s` : `${numero(Math.round(x))} ms`);

async function copiar(texto: string, aviso: string) {
  try { await navigator.clipboard.writeText(texto); avisar(aviso, { tono: 'exito' }); } catch { avisar('El navegador no dejó copiar.', { tono: 'error' }); }
}

// ---------------------------------------------------------------------------
// Cifras
// ---------------------------------------------------------------------------

export function Cifras({ doc, c }: { doc: DetalleDocumento; c: ContenidoDocumento | undefined }) {
  const medio = doc.tipo === 'audio' || doc.tipo === 'video';
  const k = c?.cuentas;
  const cifras: Array<[string, string]> = [
    [medio ? 'tramos' : doc.tipo === 'presentacion' ? 'diapositivas' : 'unidades', numero(k?.unidades ?? doc.unidades)],
    ['fragmentos', numero(k?.fragmentos ?? doc.cuentas.fragmentos)],
    [medio ? 'fotogramas' : 'figuras', numero(k?.figuras ?? doc.cuentas.figuras)],
    ['vectores', k ? numero(k.vectores) : '…'],
    ['caracteres', k ? numero(k.caracteres) : '…'],
    [medio ? 'de duración' : 'de ingesta', medio ? duracion(doc.duracion ?? 0) : !c ? '…' : c.coste.msTotal ? ms(c.coste.msTotal) : '—'],
  ];
  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-cream-400 bg-cream-300 shadow-[var(--levantado)] sm:grid-cols-6">
      {cifras.map(([n, v]) => (
        <div key={n} className="bg-cream-50 px-4 py-3">
          <dd className="text-[1.375rem] font-bold tracking-[-0.01em] text-coffee-800 tnum">{v}</dd>
          <dt className="text-[0.75rem] text-apagado">{n}</dt>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Ficha con procedencia por campo
// ---------------------------------------------------------------------------

const FUENTE: Record<FuenteMetadato, string> = {
  lectura: 'lectura', crossref: 'Crossref', openalex: 'OpenAlex', usuario: 'tú', epub: 'metadatos del EPUB', pdf: 'metadatos del PDF',
  colofon: 'colofón', openlibrary: 'Open Library', wikidata: 'Wikidata', wikipedia: 'Wikipedia', googlebooks: 'Google Books', arxiv: 'arXiv',
  datacite: 'DataCite', impresores: 'repertorio de impresores', rtve: 'RTVE',
};

const CAMPOS: Array<[keyof MetadatosDocumento, string]> = [
  ['titulo', 'Título'], ['subtitulo', 'Subtítulo'], ['tituloOriginal', 'Título original'], ['autores', 'Autores'], ['entrevistadores', 'Entrevistadores'],
  ['editores', 'Editores'], ['traductores', 'Traductores'], ['anio', 'Año'], ['anioOriginal', 'Año de la obra'], ['fecha', 'Fecha'], ['sinFecha', 'Sin fecha'],
  ['editorial', 'Editorial'], ['lugar', 'Lugar'], ['edicion', 'Edición'], ['coleccion', 'Colección'], ['contenedor', 'Contenedor'], ['revista', 'Revista'],
  ['volumen', 'Volumen'], ['numero', 'Número'], ['paginas', 'Páginas'], ['doi', 'DOI'], ['isbn', 'ISBN'], ['url', 'URL'], ['idioma', 'Idioma'],
  ['idiomaOriginal', 'Idioma original'], ['tipoCSL', 'Tipo de obra'], ['resumen', 'Resumen'],
];

function valorCampo(v: unknown, k?: keyof MetadatosDocumento): string {
  if (v == null || v === '') return '';
  // Códigos que se guardan tal cual y se enseñan con su nombre: «es» → «Español», «chapter» → «Capítulo».
  if (typeof v === 'string' && (k === 'idioma' || k === 'idiomaOriginal')) return nombreIdioma(v);
  if (typeof v === 'string' && k === 'tipoCSL') return nombreTipoCsl(v);
  if (Array.isArray(v)) return (v as Autor[]).map((a) => [a.nombre, a.apellidos].filter(Boolean).join(' ')).join('; ');
  if (typeof v === 'object') { const s = v as { desde?: number; hasta?: number; fundamento?: string }; return `h. ${s.desde ?? '…'}-${s.hasta ?? '…'}${s.fundamento ? ` (${s.fundamento})` : ''}`; }
  return String(v);
}

export function FichaProcedencia({ doc }: { doc: DetalleDocumento }) {
  const m = doc.metadatos;
  const filas = CAMPOS.map(([k, n]) => ({ k, n, v: valorCampo(m[k], k), p: m.procedencia?.[k] })).filter((f) => f.v);
  return (
    <Apartado titulo="Ficha" descripcion="Cada campo con su fuente y la confianza que se le da. Lo dudoso va en amarillo; se corrige en la ficha del lector.">
      <dl className="divide-y divide-cream-300">
        {filas.map((f) => {
          const dudoso = f.p && f.p.confianza < 0.75;
          return (
            <div key={f.k} className="grid grid-cols-1 gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)_11rem]">
              <dt className="text-[0.8125rem] text-apagado">{f.n}</dt>
              <dd className={cx('min-w-0 text-[0.875rem] text-coffee-800', f.k === 'resumen' ? 'font-serif leading-relaxed' : 'break-words', dudoso && 'rounded-md bg-amarillo-suave/70 px-1.5')}>{f.v}</dd>
              <dd className="flex items-center gap-2 text-[0.75rem] text-coffee-500">
                {f.p ? (<><Carril valor={f.p.confianza} tono={dudoso ? 'amarillo' : 'tinta'} className="w-12 shrink-0" /><span className="truncate">{FUENTE[f.p.fuente] ?? f.p.fuente} · {pct(f.p.confianza)}</span></>) : <span className="text-apagado">sin procedencia</span>}
              </dd>
            </div>
          );
        })}
      </dl>
    </Apartado>
  );
}

// ---------------------------------------------------------------------------
// Lectura: lectores y folios
// ---------------------------------------------------------------------------

/** El nombre corto de un lector: «cascada(gemini:gemini-3.8-flash → …)» → «gemini-3.8-flash y 2 más». */
export function nombreLector(l: string): string {
  const m = /^cascada\((.*)\)$/.exec(l);
  if (!m) return l;
  const partes = m[1]!.split('→').map((x) => x.trim().replace(/^[a-z-]+:/, ''));
  return `${partes[0]}${partes.length > 1 ? ` (y ${partes.length - 1} de reserva)` : ''}`;
}

export function Lectura({ c, doc }: { c: ContenidoDocumento; doc: DetalleDocumento }) {
  const f = c.folios;
  const total = f ? f.leido + f.deducido + f.epub + f.ninguno : 0;
  const k = c.cuentas;
  return (
    <Apartado titulo="Cómo se leyó" forma="cuadrado" descripcion="Qué lector leyó cada unidad, con qué confianza y de dónde sale el folio impreso que se cita.">
      <ul className="flex flex-col gap-3">
        {c.lectores.map((l) => (
          <li key={l.lector}>
            <div className="flex items-baseline gap-3 text-[0.875rem]">
              <span className="min-w-0 flex-1 truncate font-medium text-coffee-800" title={l.lector}>{nombreLector(l.lector)}</span>
              <span className="text-[0.8125rem] text-coffee-600 tnum">{numero(l.unidades)} {l.unidades === 1 ? 'unidad' : 'unidades'}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[0.75rem] text-apagado">
              <Carril valor={l.confianzaMedia} className="flex-1" /><span className="tnum">media {pct(l.confianzaMedia)} · mínima {pct(l.confianzaMin)}</span>
            </div>
          </li>
        ))}
      </ul>
      {f && total ? (
        <div className="mt-6">
          <Rotulo>Folios impresos</Rotulo>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full shadow-[var(--hundido)]" aria-hidden>
            {([['leido', 'bg-coffee-700'], ['deducido', 'bg-azul'], ['epub', 'bg-verde'], ['ninguno', 'bg-cream-400']] as const).map(([k2, color]) => f[k2] ? <span key={k2} className={color} style={{ width: `${(f[k2] / total) * 100}%` }} /> : null)}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-coffee-600">
            <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-coffee-700" />{numero(f.leido)} leídos en la página</li>
            <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-azul" />{numero(f.deducido)} deducidos por la secuencia</li>
            {f.epub ? <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-verde" />{numero(f.epub)} del EPUB</li> : null}
            {f.ninguno ? <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-cream-400" />{numero(f.ninguno)} sin folio</li> : null}
            {f.romanas ? <li>{numero(f.romanas)} en romanos (preliminares)</li> : null}
            {f.dudosos ? <li className="rounded bg-amarillo-suave px-1">{numero(f.dudosos)} dudosos (confianza por debajo del 75 %)</li> : null}
          </ul>
        </div>
      ) : null}
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[0.8125rem] sm:grid-cols-3">
        {([
          ['con imagen', k.conImagen], ['con notas al pie', k.conNotas], ['con cabecera', k.conCabecera], ['con pie de página', k.conPiePagina],
          ['fragmentos con capa moderna', k.conBusqueda], [doc.tipo === 'video' ? 'fotogramas descritos' : 'figuras descritas', k.descritas],
        ] as Array<[string, number]>).map(([n, v]) => <p key={n} className="text-coffee-600"><span className="font-semibold text-coffee-800 tnum">{numero(v)}</span> {n}</p>)}
      </div>
    </Apartado>
  );
}

// ---------------------------------------------------------------------------
// Procedencia de la ingesta
// ---------------------------------------------------------------------------

const FASE: Record<string, string> = {
  subida: 'Subida', conversion: 'Conversión', lectura: 'Lectura', folios: 'Folios', metadatos: 'Ficha', estructura: 'Estructura',
  contexto: 'Contexto', vectores: 'Vectores', figuras: 'Figuras', indexado: 'Índice', listo: 'Listo',
};
const TIEMPO: Record<string, string> = { esperaTandas: 'Espera de las tandas', nuevos: 'Lo nuevo', escritura: 'Escritura', consolidacion: 'Consolidación', transcripcion: 'Transcripción', hablantes: 'Hablantes', paginas: 'páginas', fragmentos: 'fragmentos' };
/** «vectores:paginas» → «Vectores · páginas»; «esperaTandas» → «Espera de las tandas». */
function nombreFase(k: string): string {
  const [a, b] = k.split(':') as [string, string | undefined];
  const base = FASE[a] ?? TIEMPO[a] ?? a.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (x) => x.toUpperCase());
  return b ? `${base} · ${TIEMPO[b] ?? b}` : base;
}
const COLOR_FASE: Record<string, string> = { lectura: 'bg-coffee-700', folios: 'bg-azul', metadatos: 'bg-amarillo', estructura: 'bg-azul', contexto: 'bg-verde', vectores: 'bg-rojo', figuras: 'bg-ocre', indexado: 'bg-coffee-500' };

const NOMBRE_CLAVE: Record<string, string> = {
  paginas: 'páginas', pliego: 'pliego', desde: 'desde', hasta: 'hasta', motivo: 'motivo', secciones: 'secciones', fuente: 'fuente', fragmentos: 'fragmentos',
  tokensMediana: 'tokens (mediana)', tokensMax: 'tokens (máx.)', cruzan: 'cruzan unidades', textos: 'textos', imagenes: 'imágenes', lotes: 'lotes', vectores: 'vectores',
  fallidos: 'fallidos', omitidas: 'omitidas', que: 'qué', campos: 'campos', consultas: 'consultas', encontrado: 'encontrado', puntuacion: 'puntuación', figuras: 'figuras',
  descritas: 'descritas', conPie: 'con pie', grupos: 'grupos', estrategia: 'estrategia', disposicion: 'disposición', leido: 'leídos', deducido: 'deducidos', ninguno: 'sin folio',
  tramo: 'tramo', t0: 'desde (s)', t1: 'hasta (s)', palabras: 'palabras', reaprovechados: 'reaprovechados', rehechos: 'rehechos', sobrantes: 'sobrantes', tandas: 'tandas',
};

function resumenDetalle(d: unknown): Array<[string, string]> {
  if (!d || typeof d !== 'object') return [];
  return Object.entries(d as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && (typeof v !== 'object' || (Array.isArray(v) && v.every((x) => typeof x !== 'object'))))
    .slice(0, 8)
    .map(([k, v]) => [NOMBRE_CLAVE[k] ?? k, Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'sí' : 'no') : typeof v === 'number' ? numero(v, { maximumFractionDigits: 2 }) : String(v)]);
}

export function Procedencia({ c, doc }: { c: ContenidoDocumento; doc: DetalleDocumento }) {
  const [abierta, setAbierta] = useState<number | null>(null);
  const entradas = c.procedencia;
  const max = Math.max(1, ...entradas.map((e) => e.ms ?? 0));
  const porFase = new Map<string, number>();
  for (const e of entradas) if (e.fase !== 'indexado') porFase.set(e.fase, (porFase.get(e.fase) ?? 0) + (e.ms ?? 0));
  const tiempos = (entradas.find((e) => e.fase === 'indexado')?.detalle as { tiempos?: Record<string, number> } | undefined)?.tiempos;
  return (
    <div className="flex flex-col gap-5">
      <Apartado titulo="Lo que costó" forma="triangulo" descripcion="El gasto en tu plan y el tiempo de la ingesta. Los tiempos de cada fase se solapan: varias van en paralelo.">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {([
            ['En tu plan', `${numero(c.coste.unidades)} ${c.coste.medida === 'minutos' ? (c.coste.unidades === 1 ? 'minuto de transcripción' : 'minutos de transcripción') : (c.coste.unidades === 1 ? 'página de lectura' : 'páginas de lectura')}`],
            ['Tiempo total', c.coste.msTotal ? ms(c.coste.msTotal) : 'sin registrar'],
            ['Llamadas a modelos', numero(c.coste.llamadas)],
            ['Pasos registrados', numero(entradas.length)],
          ] as Array<[string, string]>).map(([n, v]) => (
            <div key={n}><dt className="text-[0.75rem] text-apagado">{n}</dt><dd className="mt-0.5 text-[0.9375rem] font-semibold text-coffee-800">{v}</dd></div>
          ))}
        </dl>
        {tiempos ? (
          <div className="mt-5">
            <Rotulo>Tiempo por fase</Rotulo>
            <ul className="mt-2 flex flex-col gap-1.5">
              {Object.entries(tiempos).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k} className="grid grid-cols-[9rem_minmax(0,1fr)_5rem] items-center gap-3 text-[0.8125rem]">
                  <span className="truncate text-coffee-700">{nombreFase(k)}</span>
                  <Carril valor={v / Math.max(...Object.values(tiempos))} tono="tinta" />
                  <span className="text-right text-coffee-600 tnum">{ms(v)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Apartado>

      <Apartado titulo="Registro de la ingesta" forma="cuadrado" descripcion={`Cada paso, en orden: qué se hizo, con qué proveedor y cuánto tardó. Se registró el ${fecha(entradas[0]?.cuando ?? doc.actualizado)}.`}>
        {!entradas.length ? <p className="text-[0.875rem] text-apagado">Este documento no tiene registro de ingesta (se importó de un .spdf sin él).</p> : (
          <ol className="relative border-l-2 border-cream-300 pl-5">
            {entradas.map((e, i) => {
              const chips = resumenDetalle(e.detalle);
              return (
                <li key={i} className="relative pb-4 last:pb-0 [content-visibility:auto] [contain-intrinsic-size:auto_4rem]">
                  <span aria-hidden className={cx('absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-cream-50', COLOR_FASE[e.fase] ?? 'bg-coffee-400')} />
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="text-[0.875rem] font-semibold text-coffee-800">{FASE[e.fase] ?? e.fase}</span>
                    {e.proveedor ? <span className="min-w-0 max-w-full truncate font-mono text-[0.75rem] text-coffee-600" title={e.proveedor}>{nombreLector(e.proveedor)}</span> : null}
                    {e.ms != null ? <span className="ml-auto flex items-center gap-2 text-[0.75rem] text-coffee-600 tnum"><Carril valor={(e.ms ?? 0) / max} tono="tinta" className="hidden w-20 sm:block" />{ms(e.ms)}</span> : null}
                  </div>
                  {chips.length ? (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {chips.map(([k, v]) => <li key={k} className="rounded-md border border-cream-400 bg-cream-100 px-1.5 py-0.5 text-[0.6875rem] text-coffee-600"><span className="text-apagado">{k}</span> {v}</li>)}
                    </ul>
                  ) : null}
                  {e.detalle && typeof e.detalle === 'object' ? (
                    <button type="button" onClick={() => setAbierta(abierta === i ? null : i)} aria-expanded={abierta === i} className="mt-1 text-[0.75rem] text-coffee-500 underline decoration-filete-fuerte underline-offset-4 hover:text-coffee-800">{abierta === i ? 'Ocultar el detalle' : 'Ver el detalle'}</button>
                  ) : null}
                  {abierta === i ? <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-coffee-900 p-3 font-mono text-[0.6875rem] leading-relaxed text-cream-100">{JSON.stringify(e.detalle, null, 2)}</pre> : null}
                </li>
              );
            })}
          </ol>
        )}
      </Apartado>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hablantes y entidades
// ---------------------------------------------------------------------------

export function Hablantes({ c, doc }: { c: ContenidoDocumento; doc: DetalleDocumento }) {
  const total = c.hablantes.reduce((s, h) => s + h.segundos, 0) || 1;
  const m = doc.metadatos;
  const rol = (n: string) => (m.entrevistadores?.some((a) => n.includes(a.apellidos)) ? 'entrevista' : m.autores.some((a) => n.includes(a.apellidos)) ? 'autor' : null);
  return (
    <Apartado titulo="Quién habla" descripcion="Los hablantes que distinguió la transcripción, sus turnos y cuánto tiempo hablan (repartido por palabras dentro de cada tramo).">
      {!c.hablantes.length ? <p className="text-[0.875rem] text-apagado">La transcripción no distingue hablantes.</p> : (
        <ul className="flex flex-col gap-4">
          {c.hablantes.map((h, i) => (
            <li key={h.nombre}>
              <div className="flex items-center gap-2.5 text-[0.9375rem]">
                <FormaHablante h={i} tam={12} />
                <span className="font-semibold text-coffee-800">{h.nombre}</span>
                {rol(h.nombre) ? <span className="text-[0.75rem] text-apagado">{rol(h.nombre) === 'entrevista' ? 'entrevistador' : 'autor'}</span> : null}
                <span className="ml-auto text-[0.8125rem] text-coffee-600 tnum">{duracion(h.segundos)} · {numero(h.turnos)} {h.turnos === 1 ? 'turno' : 'turnos'}</span>
              </div>
              <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-cream-300 shadow-[var(--hundido)]"><span className="block h-full rounded-full" style={{ width: `${(h.segundos / total) * 100}%`, background: ['var(--s-azul)', 'var(--s-rojo)', 'var(--s-amarillo)', 'var(--s-verde)'][i % 4] }} /></span>
            </li>
          ))}
        </ul>
      )}
    </Apartado>
  );
}

const TIPO_ENTIDAD: Record<string, string> = { persona: 'Personas', obra: 'Obras', lugar: 'Lugares', organizacion: 'Organizaciones', concepto: 'Conceptos', evento: 'Acontecimientos', fecha: 'Fechas' };

export function Entidades({ documento }: { documento: string }) {
  const { data, isPending, isError } = useQuery(qi.entidades(documento));
  const grupos = new Map<string, NonNullable<typeof data>['entidades']>();
  for (const e of data?.entidades ?? []) grupos.set(e.tipo, [...(grupos.get(e.tipo) ?? []), e]);
  return (
    <Apartado titulo="Entidades mencionadas" forma="triangulo" descripcion="Personas, obras, lugares y conceptos que se nombran aquí, con cuántas veces aparecen en este documento y en cuántos otros de tu biblioteca.">
      {isPending ? <div className="flex flex-wrap gap-2">{Array.from({ length: 12 }, (_, i) => <Esqueleto key={i} className="h-7 w-24" />)}</div>
        : isError ? <p className="text-[0.875rem] text-apagado">No se pudieron cargar las entidades.</p>
        : !data?.entidades.length ? <p className="text-[0.875rem] text-apagado">{data?.extraccion?.estado === 'en_marcha' || data?.extraccion?.estado === 'pendiente' ? 'Las entidades se están extrayendo; aparecerán aquí en unos minutos.' : 'Aún no se han extraído entidades de este documento.'}</p>
        : (
          <div className="flex flex-col gap-5">
            {[...grupos].sort((a, b) => b[1].length - a[1].length).map(([tipo, es]) => (
              <div key={tipo}>
                <Rotulo>{TIPO_ENTIDAD[tipo] ?? tipo} · {numero(es.length)}</Rotulo>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {[...es].sort((a, b) => b.aqui - a.aqui).slice(0, 80).map((e) => (
                    <li key={e.id} title={e.descripcion} className="inline-flex items-center gap-1.5 rounded-lg border border-cream-400 bg-cream-50 px-2.5 py-1 text-[0.8125rem] text-coffee-700 shadow-[var(--relieve)]">
                      {e.nombre}<span className="text-[0.6875rem] text-apagado tnum">{numero(e.aqui)}{e.documentos > 1 ? ` · en ${numero(e.documentos)} docs.` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
    </Apartado>
  );
}

// ---------------------------------------------------------------------------
// El fichero
// ---------------------------------------------------------------------------

export function Fichero({ c, doc, acciones }: { c: ContenidoDocumento; doc: DetalleDocumento; acciones: ReactNode }) {
  const a = c.archivo;
  const filas: Array<[string, ReactNode]> = [
    ['Versión de SPDF', <span className="font-mono">{a.spdfVersion}</span>],
    ['Generador', a.claves.generador ?? '—'],
    ['Tipo', `${NOMBRE_TIPO[doc.tipo]} · ${a.mime}`],
    ['Original', `${bytes(a.bytes)}${a.original ? '' : ' · incrustado en el .spdf'}`],
    ['Huella SHA-256', <button type="button" onClick={() => void copiar(a.huella, 'Huella copiada.')} className="break-all text-left font-mono text-[0.75rem] hover:underline" title="Copiar">{a.huella}</button>],
    ['Identificador', <button type="button" onClick={() => void copiar(doc.id, 'Identificador copiado.')} className="font-mono text-[0.75rem] hover:underline" title="Copiar">{doc.id}</button>],
    ...(a.original ? [['Clave del original', <span className="break-all font-mono text-[0.75rem]">{a.original}</span>] as [string, ReactNode]] : []),
    ['Añadido', fecha(a.creado)],
    ['Última actualización', fecha(a.actualizado)],
    ['Estado', doc.estado === 'listo' ? 'listo' : doc.estado === 'error' ? `error${doc.error ? `: ${doc.error}` : ''}` : doc.estado],
  ];
  return (
    <Apartado titulo="El fichero" forma="cuadrado" descripcion="Un .spdf es una base SQLite comprimida: el documento, sus unidades, fragmentos, figuras, vectores y la procedencia, todo en un archivo." accion={acciones}>
      <dl className="divide-y divide-cream-300">
        {filas.map(([n, v]) => (
          <div key={n} className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <dt className="text-[0.8125rem] text-apagado">{n}</dt>
            <dd className="min-w-0 text-[0.875rem] text-coffee-800">{v}</dd>
          </div>
        ))}
      </dl>
      {Object.keys(a.claves).length ? (
        <div className="mt-5">
          <Rotulo>Tabla «spdf»</Rotulo>
          <ul className="mt-2 grid gap-1 font-mono text-[0.75rem] text-coffee-600">
            {Object.entries(a.claves).map(([k, v]) => <li key={k}><span className="text-apagado">{k}</span> = {v}</li>)}
          </ul>
        </div>
      ) : null}
      {doc.espacios.length || c.espacios.length ? null : <p className="mt-3 flex items-center gap-1.5 text-[0.8125rem] text-apagado"><Icono nombre="aviso" tam={13} />Sin vectores: solo se puede buscar por texto.</p>}
    </Apartado>
  );
}
