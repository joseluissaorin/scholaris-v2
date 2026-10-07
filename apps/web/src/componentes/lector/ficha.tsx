/**
 * La ficha del documento, editable en el sitio. Cada campo dice de dónde salió
 * (la lectura, Crossref, OpenAlex, tú) y con qué confianza: lo dudoso pide
 * revisión, lo tuyo manda.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Autor, MetadatosDocumento } from '@scholaris/nucleo';
import type { DetalleDocumento } from '@scholaris/contrato';
import { avisar, cx, Icono, Rotulo } from '@scholaris/ui';
import { api } from '../../datos/api';
import { bytes, fecha, NOMBRE_TIPO, nombreUnidad, duracion, esMedio } from '../../lib/formato';
import { numero } from '../../lib/numero';
import { nombreIdioma } from '../../lib/nombres';

type Metadatos = MetadatosDocumento;
type Campo = Exclude<keyof Metadatos, 'procedencia' | 'sinFecha' | 'editores'>;

const CAMPOS: Array<{ k: Campo; nombre: string; ancho?: 'medio'; numerico?: boolean; solo?: (m: Metadatos) => boolean }> = [
  { k: 'titulo', nombre: 'Título' },
  { k: 'subtitulo', nombre: 'Subtítulo' },
  { k: 'autores', nombre: 'Autoría' },
  { k: 'contenedor', nombre: 'Dentro de', solo: (m) => !!m.contenedor || ['chapter', 'broadcast', 'interview', 'speech', 'entry-encyclopedia'].includes(m.tipoCSL ?? '') },
  { k: 'tituloOriginal', nombre: 'Título original' },
  { k: 'traductores', nombre: 'Traducción' },
  { k: 'anioOriginal', nombre: 'Año de la obra', ancho: 'medio', numerico: true },
  { k: 'anio', nombre: 'Año de esta edición', ancho: 'medio', numerico: true },
  { k: 'fecha', nombre: 'Fecha', ancho: 'medio', solo: (m) => !!m.fecha },
  { k: 'edicion', nombre: 'Edición', ancho: 'medio' },
  { k: 'editorial', nombre: 'Editorial', ancho: 'medio' },
  { k: 'lugar', nombre: 'Lugar', ancho: 'medio' },
  { k: 'coleccion', nombre: 'Colección', solo: (m) => !!m.coleccion || m.tipoCSL === 'book' },
  { k: 'revista', nombre: 'Revista', solo: (m) => !!m.revista || m.tipoCSL === 'article-journal' },
  { k: 'volumen', nombre: 'Volumen', ancho: 'medio', solo: (m) => !!m.revista },
  { k: 'numero', nombre: 'Número', ancho: 'medio', solo: (m) => !!m.revista },
  { k: 'paginas', nombre: 'Páginas', ancho: 'medio', solo: (m) => !!m.revista },
  { k: 'doi', nombre: 'DOI', ancho: 'medio' },
  { k: 'isbn', nombre: 'ISBN', ancho: 'medio' },
  { k: 'url', nombre: 'URL', solo: (m) => !!m.url },
  { k: 'idioma', nombre: 'Idioma', ancho: 'medio' },
  { k: 'idiomaOriginal', nombre: 'Idioma original', ancho: 'medio', solo: (m) => !!m.idiomaOriginal || !!m.tituloOriginal || !!m.traductores?.length },
];

const FUENTE: Record<string, string> = {
  lectura: 'leído', crossref: 'Crossref', openalex: 'OpenAlex', usuario: 'tú', epub: 'EPUB', pdf: 'ficha del PDF', colofon: 'colofón',
  openlibrary: 'Open Library', wikidata: 'Wikidata', wikipedia: 'Wikipedia', googlebooks: 'Google Books', arxiv: 'arXiv', datacite: 'DataCite', impresores: 'impresor',
};

function aTexto(m: Metadatos, k: Campo): string {
  const v = m[k];
  if (k === 'autores' || k === 'traductores') return (v as Autor[] | undefined)?.map((a) => `${a.apellidos}, ${a.nombre}`).join('; ') ?? '';
  return v == null ? '' : String(v);
}

function deTexto(k: Campo, t: string, numerico?: boolean): unknown {
  if (k === 'autores' || k === 'traductores') return t.split(';').map((x) => x.trim()).filter(Boolean).map((x) => { const [ap, no] = x.split(',').map((y) => y.trim()); return { apellidos: ap ?? '', nombre: no ?? '' }; });
  if (numerico) return t.trim() ? Number(t) : undefined;
  return t.trim() || undefined;
}

export function Ficha({ doc }: { doc: DetalleDocumento }) {
  const qc = useQueryClient();
  const m = doc.metadatos as Metadatos;

  async function guardar(k: Campo, valor: unknown) {
    const previo = qc.getQueryData<DetalleDocumento>(['documento', doc.id]);
    const proc = { ...(m.procedencia ?? {}), [k as string]: { fuente: 'usuario' as const, confianza: 1 } };
    qc.setQueryData<DetalleDocumento>(['documento', doc.id], (d) => d && { ...d, metadatos: { ...d.metadatos, [k]: valor, procedencia: proc } });
    try {
      const nuevo = await api().documentos.metadatos(doc.id, { [k]: valor } as Partial<MetadatosDocumento>);
      qc.setQueryData(['documento', doc.id], nuevo);
      void qc.invalidateQueries({ queryKey: ['documentos'] });
    } catch {
      qc.setQueryData(['documento', doc.id], previo);
      avisar('No se pudo guardar el cambio.', { tono: 'error' });
    }
  }

  const sf = m.sinFecha;
  const dudosos = CAMPOS.filter((c) => (m.procedencia?.[c.k]?.confianza ?? 1) < 0.75 && aTexto(m, c.k)).length;

  return (
    <div className="flex flex-col gap-5">
      {dudosos ? (
        <p className="flex items-start gap-2 rounded-s border border-amarillo bg-amarillo-suave/60 px-3 py-2 text-[0.8125rem] text-tinta">
          <Icono nombre="aviso" tam={15} className="mt-0.5 shrink-0" />
          {dudosos === 1 ? 'Un campo se dedujo con poca confianza. Revísalo antes de citar.' : `${dudosos} campos se dedujeron con poca confianza. Revísalos antes de citar.`}
        </p>
      ) : null}
      {!m.anio && sf ? (
        <p className="rounded-xl border border-cream-400 bg-cream-50 shadow-[var(--levantado)] px-3 py-2 text-[0.875rem]">
          <span className="font-mono">s. f.</span>{sf.desde || sf.hasta ? <> (h. {sf.desde ?? '…'}{sf.hasta && sf.hasta !== sf.desde ? `-${sf.hasta}` : ''}{sf.fundamento ? `, según ${sf.fundamento}` : ''})</> : sf.fundamento ? <> ({sf.fundamento})</> : null}
          <span className="mt-1 block text-[0.8125rem] text-apagado">Sin año impreso. La horquilla es orientativa y no se usa al citar.</span>
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        {CAMPOS.filter((c) => !c.solo || c.solo(m)).map((c) => (
          <CampoEditable key={c.k} etiqueta={c.nombre} valor={aTexto(m, c.k)} ancho={c.ancho} numerico={c.numerico}
            mostrar={c.k === 'idioma' || c.k === 'idiomaOriginal' ? nombreIdioma : undefined}
            procedencia={m.procedencia?.[c.k as string]} ayuda={c.k === 'autores' || c.k === 'traductores' ? 'Apellidos, Nombre; separados por punto y coma' : c.k === 'anioOriginal' ? 'Se cita «1975/2009»: la obra y esta edición' : c.k === 'idioma' || c.k === 'idiomaOriginal' ? 'El código del idioma: «es», «en», «la», «fr»…' : undefined}
            alGuardar={(t) => void guardar(c.k, deTexto(c.k, t, c.numerico))} />
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-filete pt-4 text-[0.8125rem]">
        <dt className="rotulo text-apagado">Tipo</dt><dd>{NOMBRE_TIPO[doc.tipo]}</dd>
        <dt className="rotulo text-apagado">Extensión</dt><dd>{esMedio(doc.tipo) && doc.duracion ? duracion(doc.duracion) : nombreUnidad(doc.tipo, doc.unidades)}</dd>
        <dt className="rotulo text-apagado">Fragmentos</dt><dd className="tnum">{numero(doc.cuentas.fragmentos)}</dd>
        <dt className="rotulo text-apagado">Original</dt><dd>{bytes(doc.bytes)}</dd>
        <dt className="rotulo text-apagado">Añadido</dt><dd>{fecha(doc.creado)}</dd>
        <dt className="rotulo text-apagado">Vectores</dt><dd className="truncate font-mono text-[0.75rem]" title={doc.espacios.map((e) => e.id).join(', ')}>{doc.espacios.map((e) => e.modelo).join(', ') || '—'}</dd>
      </dl>
    </div>
  );
}

function CampoEditable({ etiqueta, valor, alGuardar, procedencia, ancho, numerico, ayuda, mostrar }: {
  etiqueta: string; valor: string; alGuardar: (v: string) => void; procedencia?: { fuente: string; confianza: number }; ancho?: 'medio'; numerico?: boolean; ayuda?: string;
  /** Cómo se enseña el valor guardado (el código «es» como «Español»); al editar se ve el valor tal cual. */
  mostrar?: (v: string) => string;
}) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(valor);
  const dudoso = procedencia && procedencia.confianza < 0.75 && !!valor;
  const terminar = (guardar: boolean) => { setEditando(false); if (guardar && borrador !== valor) alGuardar(borrador); };
  return (
    <div className={cx('min-w-0', ancho === 'medio' ? 'col-span-1' : 'col-span-2')}>
      <div className="flex items-center gap-1.5">
        <Rotulo className="text-tinta-2">{etiqueta}</Rotulo>
        {procedencia ? (
          <span className={cx('rotulo ml-auto text-[0.625rem]', dudoso ? 'text-tinta' : 'text-apagado')} title={`Origen: ${FUENTE[procedencia.fuente] ?? procedencia.fuente}, confianza ${Math.round(procedencia.confianza * 100)} %`}>
            {dudoso ? <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amarillo align-middle" /> : null}
            {FUENTE[procedencia.fuente] ?? procedencia.fuente}{procedencia.fuente !== 'usuario' ? ` · ${Math.round(procedencia.confianza * 100)} %` : ''}
          </span>
        ) : null}
      </div>
      {editando ? (
        <input
          autoFocus
          value={borrador}
          inputMode={numerico ? 'numeric' : undefined}
          onChange={(e) => setBorrador(e.target.value)}
          onBlur={() => terminar(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') terminar(true); if (e.key === 'Escape') { setBorrador(valor); terminar(false); } }}
          aria-label={etiqueta}
          className="mt-1 h-9 w-full rounded-s border border-tinta bg-hoja px-2 text-[0.9375rem] outline-none shadow-[0_0_0_3px_var(--s-rojo-suave)]"
        />
      ) : (
        <button type="button" onClick={() => { setBorrador(valor); setEditando(true); }} className={cx('group mt-1 flex min-h-9 w-full items-center gap-2 rounded-s border border-transparent px-2 text-left text-[0.9375rem] hover:border-filete-fuerte hover:bg-hoja', dudoso && 'border-amarillo/70 bg-amarillo-suave/40', !valor && 'text-apagado')}>
          <span className="min-w-0 flex-1 truncate" title={mostrar && valor ? valor : undefined}>{valor ? (mostrar ? mostrar(valor) : valor) : 'Añadir'}</span>
          <Icono nombre="editar" tam={13} className="shrink-0 opacity-0 group-hover:opacity-60" />
        </button>
      )}
      {ayuda && editando ? <p className="mt-1 text-[0.75rem] text-apagado">{ayuda}</p> : null}
    </div>
  );
}
