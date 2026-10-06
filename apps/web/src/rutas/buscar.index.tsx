import { useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Filtros, TipoEntrada } from '@scholaris/nucleo';
import type { EventoRespuesta, ResultadoVista } from '@scholaris/contrato';
import { avisar, Boton, Campo, Chip, cx, EsqueletoTexto, Folio, Icono, MenuContenido, MenuDisparador, MenuElemento, MenuRaiz, Rotulo, Teclas, Vacio } from '@scholaris/ui';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Resultado } from '../componentes/busqueda/resultado';
import { Lienzo } from '../componentes/comunes/cabecera';
import { anclaABusqueda } from '../lib/anclas';
import { etiquetaCorta, haceCuanto } from '../lib/formato';
import { textoLimpio } from '../lib/texto';
import { numero } from '../lib/numero';

type Modo = 'buscar' | 'preguntar';
interface BusquedaBuscar { q?: string; modo?: Modo; grupo?: string; col?: string; doc?: string; cruzada?: boolean; desde?: number; hasta?: number }

const GRUPOS: Array<{ id: string; nombre: string; tipos: TipoEntrada[] }> = [
  { id: 'libros', nombre: 'Libros y artículos', tipos: ['pdf', 'epub', 'pdf_escaneado', 'fotos'] },
  { id: 'medios', nombre: 'Audio y vídeo', tipos: ['audio', 'video'] },
  { id: 'textos', nombre: 'Textos y web', tipos: ['documento', 'web'] },
  { id: 'otros', nombre: 'Diapositivas, hojas e imágenes', tipos: ['presentacion', 'hoja', 'imagen'] },
];

export const Route = createFileRoute('/buscar/')({
  validateSearch: (s: Record<string, unknown>): BusquedaBuscar => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    modo: s.modo === 'preguntar' ? 'preguntar' : undefined,
    grupo: typeof s.grupo === 'string' ? s.grupo : undefined,
    col: typeof s.col === 'string' ? s.col : undefined,
    doc: typeof s.doc === 'string' ? s.doc : undefined,
    cruzada: s.cruzada === true || s.cruzada === 'true' ? true : undefined,
    desde: Number.isFinite(Number(s.desde)) && s.desde ? Number(s.desde) : undefined,
    hasta: Number.isFinite(Number(s.hasta)) && s.hasta ? Number(s.hasta) : undefined,
  }),
  component: PaginaBuscar,
});

function filtrosDe(b: BusquedaBuscar): Filtros {
  const g = GRUPOS.find((x) => x.id === b.grupo);
  return { ...(g ? { tipos: g.tipos } : {}), ...(b.col ? { bibliotecas: [b.col] } : {}), ...(b.doc ? { documentos: [b.doc] } : {}), ...(b.desde ? { anioDesde: b.desde } : {}), ...(b.hasta ? { anioHasta: b.hasta } : {}) };
}

function PaginaBuscar() {
  const b = Route.useSearch();
  const navegar = useNavigate({ from: '/buscar/' });
  const modo: Modo = b.modo ?? 'buscar';
  const [texto, setTexto] = useState(b.q ?? '');
  const [pregunta, setPregunta] = useState<string | null>(b.modo === 'preguntar' && b.q ? b.q : null);
  const caja = useRef<HTMLInputElement>(null);
  const filtros = useMemo(() => filtrosDe(b), [b.grupo, b.col, b.doc, b.desde, b.hasta]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: bibliotecas = [] } = useQuery(q.bibliotecas());
  const { data: documentoFiltrado } = useQuery({ ...q.documento(b.doc ?? ''), enabled: !!b.doc });
  const fijar = (c: Partial<BusquedaBuscar>) => void navegar({ search: (s) => ({ ...s, ...c }), replace: true });

  // Resultados mientras se escribe: 180 ms de calma bastan.
  useEffect(() => {
    if (modo !== 'buscar') return;
    const h = setTimeout(() => { if ((b.q ?? '') !== texto) fijar({ q: texto || undefined }); }, 180);
    return () => clearTimeout(h);
  }, [texto, modo]); // eslint-disable-line react-hooks/exhaustive-deps

  const consulta = (b.q ?? '').trim();
  const normal = useQuery({ ...q.busqueda(consulta, filtros), enabled: modo === 'buscar' && !b.cruzada && consulta.length > 1 });
  const cruzada = useQuery({
    queryKey: ['multilingue', consulta, filtros],
    queryFn: () => api().busqueda.multilingue({ consulta, filtros, k: 30 }),
    enabled: modo === 'buscar' && !!b.cruzada && consulta.length > 1,
    placeholderData: keepPreviousData,
    staleTime: 120_000,
  });
  const datos = b.cruzada ? cruzada : normal;
  const resultados = datos.data?.resultados ?? [];

  function enviar() {
    const t = texto.trim();
    if (!t) return;
    if (modo === 'preguntar') { fijar({ q: t }); setPregunta(t); }
    else fijar({ q: t });
  }

  const titulo = b.cruzada && cruzada.data && 'traducciones' in cruzada.data ? cruzada.data.traducciones : null;

  return (
    <Lienzo ancho="normal">
      <div className="max-w-4xl">
        <div role="radiogroup" aria-label="Modo" className="mb-3 inline-flex rounded-s border border-filete-fuerte p-0.5">
          {(['buscar', 'preguntar'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={modo === m} onClick={() => { fijar({ modo: m === 'buscar' ? undefined : m }); caja.current?.focus(); }}
              className={cx('flex h-9 items-center gap-2 rounded-md px-3.5 text-[0.9375rem]', modo === m ? 'bg-tinta text-sobre-tinta' : 'text-tinta-2 hover:text-tinta')}>
              <Icono nombre={m === 'buscar' ? 'buscar' : 'chispa'} tam={15} />{m === 'buscar' ? 'Buscar pasajes' : 'Preguntar'}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); enviar(); }}>
          <Campo
            id="caja-busqueda"
            ref={caja}
            tam="g"
            icono={modo === 'buscar' ? 'buscar' : 'chispa'}
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={modo === 'buscar' ? 'Una idea, una frase, un nombre…' : '¿Qué dice tu biblioteca sobre…?'}
            aria-label={modo === 'buscar' ? 'Buscar en la biblioteca' : 'Pregunta a la biblioteca'}
            enterKeyHint={modo === 'buscar' ? 'search' : 'send'}
            sufijo={modo === 'preguntar' ? <Boton type="submit" variante="rojo" tam="p" disabled={!texto.trim()}>Preguntar</Boton> : datos.isFetching ? <span className="mr-3 h-2 w-2 rounded-full bg-rojo anim-pulso" aria-label="Buscando" /> : texto ? <button type="button" aria-label="Borrar" onClick={() => { setTexto(''); fijar({ q: undefined }); caja.current?.focus(); }} className="mr-1 grid h-9 w-9 place-items-center rounded-s text-apagado hover:text-tinta"><Icono nombre="cerrar" tam={16} /></button> : <Teclas className="mr-2">/</Teclas>}
          />
        </form>

        {/* Filtros como chips */}
        <div className="sin-barra -mx-5 mt-4 flex items-center gap-2 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0">
          {b.doc ? <Chip activo alQuitar={() => fijar({ doc: undefined })}>{documentoFiltrado?.metadatos.titulo ?? 'Un documento'}</Chip> : null}
          {GRUPOS.map((g) => <Chip key={g.id} activo={b.grupo === g.id} onClick={() => fijar({ grupo: b.grupo === g.id ? undefined : g.id })}>{g.nombre}</Chip>)}
          <MenuRaiz>
            <MenuDisparador asChild><Chip icono="biblioteca" activo={!!b.col}>{bibliotecas.find((x) => x.id === b.col)?.nombre ?? 'Colección'}</Chip></MenuDisparador>
            <MenuContenido alinear="start">
              <MenuElemento icono={!b.col ? 'hecho' : undefined} alElegir={() => fijar({ col: undefined })}>Toda la biblioteca</MenuElemento>
              {bibliotecas.map((x) => <MenuElemento key={x.id} icono={b.col === x.id ? 'hecho' : undefined} alElegir={() => fijar({ col: x.id })}>{x.nombre}</MenuElemento>)}
            </MenuContenido>
          </MenuRaiz>
          <Anios desde={b.desde} hasta={b.hasta} alCambiar={(d, h) => fijar({ desde: d, hasta: h })} />
          <Chip icono="idiomas" activo={!!b.cruzada} onClick={() => fijar({ cruzada: b.cruzada ? undefined : true })}>En todas las lenguas</Chip>
        </div>
      </div>

      <div className="mt-8 max-w-5xl">
        {modo === 'preguntar' ? (
          pregunta ? <Respuesta key={`${pregunta}|${JSON.stringify(filtros)}`} pregunta={pregunta} filtros={filtros} /> : <Inicio modo="preguntar" alElegir={(t) => { setTexto(t); setPregunta(t); fijar({ q: t }); }} />
        ) : !consulta ? (
          <Inicio modo="buscar" alElegir={(t) => { setTexto(t); fijar({ q: t }); }} />
        ) : datos.isPending ? (
          <div className="flex flex-col gap-8">{[0, 1, 2, 3].map((i) => <div key={i} className="grid gap-6 md:grid-cols-[7rem_1fr]"><div className="esqueleto h-5 w-16" /><EsqueletoTexto lineas={3} /></div>)}</div>
        ) : !resultados.length ? (
          <Vacio forma="triangulo" titulo={`Nada sobre «${consulta}».`} accion={<><Boton variante="linea" icono="chispa" onClick={() => { fijar({ modo: 'preguntar' }); setPregunta(consulta); }}>Preguntar en su lugar</Boton>{!b.cruzada ? <Boton variante="fantasma" icono="idiomas" onClick={() => fijar({ cruzada: true })}>Buscar en todas las lenguas</Boton> : null}</>}>
            Prueba con otras palabras, quita filtros o pregunta con una frase completa: la búsqueda entiende ideas, no solo palabras.
          </Vacio>
        ) : (
          <>
            <div className={cx('flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-tinta pb-2 transition-opacity', datos.isPlaceholderData && 'opacity-60')}>
              <p className="text-[0.9375rem]"><span className="tnum">{resultados.length}</span> pasajes</p>
              <Rotulo>{datos.data?.ms ? `${datos.data.ms} ms` : ''}{datos.data?.intencion ? ` · consulta ${datos.data.intencion}` : ''}</Rotulo>
              {titulo?.length ? <Rotulo className="truncate">También en: {titulo.map((t) => `${t.idioma} «${t.consulta}»`).join(' · ')}</Rotulo> : null}
              <button type="button" onClick={() => { fijar({ modo: 'preguntar' }); setPregunta(consulta); }} className="ml-auto flex items-center gap-1.5 text-[0.875rem] underline decoration-rojo decoration-2 underline-offset-4"><Icono nombre="chispa" tam={14} />Preguntar sobre esto</button>
            </div>
            <div className={cx('transition-opacity', datos.isPlaceholderData && 'opacity-60')}>
              {resultados.map((r, i) => <Resultado key={r.fragmento.id} r={r} consulta={consulta} indice={i} />)}
            </div>
          </>
        )}
      </div>
    </Lienzo>
  );
}

function Anios({ desde, hasta, alCambiar }: { desde?: number; hasta?: number; alCambiar: (d?: number, h?: number) => void }) {
  const [d, setD] = useState(desde ? String(desde) : '');
  const [h, setH] = useState(hasta ? String(hasta) : '');
  const activo = !!desde || !!hasta;
  return (
    <MenuRaiz>
      <MenuDisparador asChild><Chip icono="historial" activo={activo}>{activo ? `${desde ?? '…'}–${hasta ?? '…'}` : 'Años'}</Chip></MenuDisparador>
      <MenuContenido alinear="start" className="w-72 p-3">
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); alCambiar(d ? Number(d) : undefined, h ? Number(h) : undefined); }}>
          <Rotulo>Año de la obra (el original, si se conoce)</Rotulo>
          <div className="flex items-center gap-2">
            <Campo aria-label="Desde" placeholder="Desde" inputMode="numeric" value={d} onChange={(e) => setD(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.stopPropagation()} />
            <span className="text-apagado">–</span>
            <Campo aria-label="Hasta" placeholder="Hasta" inputMode="numeric" value={h} onChange={(e) => setH(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.stopPropagation()} />
          </div>
          <div className="flex justify-end gap-2">
            {activo ? <Boton variante="fantasma" tam="p" onClick={() => { setD(''); setH(''); alCambiar(); }}>Quitar</Boton> : null}
            <Boton type="submit" variante="tinta" tam="p">Aplicar</Boton>
          </div>
        </form>
      </MenuContenido>
    </MenuRaiz>
  );
}

/** Antes de escribir: lo que buscaste hace poco y ejemplos que enseñan qué se puede hacer. */
function Inicio({ modo, alElegir }: { modo: Modo; alElegir: (t: string) => void }) {
  const { data } = useQuery(q.historial());
  const recientes = (data?.elementos ?? []).filter((e) => (modo === 'preguntar') === (e.tipo === 'respuesta')).slice(0, 6);
  const ejemplos = modo === 'preguntar'
    ? ['¿Qué efecto tiene el panóptico sobre quien se sabe vigilado?', '¿Cómo define Kristeva lo abyecto?', '¿Qué dice Serrat sobre musicar a Machado?']
    : ['vigilancia y visibilidad', 'el cadáver como límite', 'rizoma frente a árbol', 'cartas sin enviar'];
  return (
    <div className="grid gap-10 md:grid-cols-2">
      <div>
        <Rotulo>{modo === 'preguntar' ? 'Preguntas de ejemplo' : 'Prueba con'}</Rotulo>
        <ul className="mt-3 flex flex-col gap-1">
          {ejemplos.map((e) => (
            <li key={e}><button type="button" onClick={() => alElegir(e)} className="group flex w-full items-center gap-3 rounded-s py-2 text-left text-[1.0625rem] hover:bg-hondo md:-ml-2 md:px-2">
              <Icono nombre={modo === 'preguntar' ? 'chispa' : 'buscar'} tam={16} className="shrink-0 text-apagado" />
              <span className="">{e}</span>
              <Icono nombre="derecha" tam={15} className="ml-auto opacity-0 group-hover:opacity-60" />
            </button></li>
          ))}
        </ul>
        <p className="mt-6 max-w-md text-[0.9375rem] text-tinta-2">
          {modo === 'preguntar'
            ? 'La respuesta solo puede citar pasajes que existen en tu biblioteca. Cada cita lleva su página impresa o su minuto, y abre el lector justo ahí.'
            : 'Busca por ideas, no solo por palabras: la búsqueda combina el texto exacto, el sentido y, en los escaneos, la imagen de la página.'}
        </p>
      </div>
      {recientes.length ? (
        <div>
          <div className="flex items-baseline justify-between"><Rotulo>Hace poco</Rotulo><Link to="/buscar/historial" className="text-[0.8125rem] text-tinta-2 underline-offset-4 hover:underline">Todo el historial</Link></div>
          <ul className="mt-3 flex flex-col">
            {recientes.map((e) => (
              <li key={e.id}><button type="button" onClick={() => alElegir(e.consulta)} className="flex w-full items-baseline gap-3 border-b border-filete py-2.5 text-left hover:bg-hondo/60">
                {e.fijado ? <Icono nombre="fijar" tam={13} className="shrink-0 text-rojo" /> : null}
                <span className="min-w-0 flex-1 truncate">{e.consulta}</span>
                <span className="shrink-0 text-[0.75rem] text-apagado">{haceCuanto(e.cuando)}</span>
              </button></li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * La respuesta, a medida que llega. Las citas [n] son anclas: cada una abre el
 * lector en su página o su segundo. Nada se cita que no esté en la biblioteca.
 */
function Respuesta({ pregunta, filtros }: { pregunta: string; filtros: Filtros }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [fuentes, setFuentes] = useState<ResultadoVista[]>([]);
  const [citas, setCitas] = useState<Map<number, Extract<EventoRespuesta, { tipo: 'cita' }>>>(new Map());
  const [estado, setEstado] = useState<'pensando' | 'escribiendo' | 'hecho' | 'error'>('pensando');
  const [fin, setFin] = useState<Extract<EventoRespuesta, { tipo: 'fin' }> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        for await (const e of api().busqueda.responder({ consulta: pregunta, filtros, verificar: true })) {
          if (!vivo) return;
          if (e.tipo === 'resultados') setFuentes(e.resultados);
          else if (e.tipo === 'cita') setCitas((m) => new Map(m).set(e.n, e));
          else if (e.tipo === 'texto') { setEstado('escribiendo'); setTexto((t) => t + e.delta); }
          else if (e.tipo === 'fin') { setFin(e); setEstado('hecho'); void qc.invalidateQueries({ queryKey: ['historial'] }); }
          else if (e.tipo === 'error') { setError(e.mensaje); setEstado('error'); }
        }
      } catch (err) { if (vivo) { setError(err instanceof Error ? err.message : 'Falló la respuesta.'); setEstado('error'); } }
    })();
    return () => { vivo = false; };
  }, [pregunta, filtros, qc]);

  const fuentePorCita = (n: number) => {
    const c = citas.get(n);
    return c ? fuentes.find((f) => f.fragmento.id === c.fragmento) ?? fuentes[n - 1] : fuentes[n - 1];
  };

  // El texto con sus [n] convertidos en anclas.
  // La API marca las citas como [n] o [^n] (estilo nota): las dos valen.
  const partes = texto.split(/(\[\^?\d+\])/g);

  async function copiar() {
    const plano = texto.replace(/\[\^?(\d+)\]/g, (_, n) => { const c = citas.get(Number(n)); return c ? ` ${c.citaCorta}` : ''; });
    try { await navigator.clipboard.writeText(plano.trim()); avisar('Respuesta copiada con sus citas.', { tono: 'exito' }); } catch { avisar('No se pudo copiar.', { tono: 'error' }); }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-live="polite" aria-busy={estado !== 'hecho'}>
        <p className="rotulo text-apagado">Pregunta</p>
        <h2 className="mt-1 text-[1.625rem] leading-tight tracking-[-0.015em]">{pregunta}</h2>
        <div className="mt-6 border-l-[3px] border-tinta pl-5">
          {estado === 'pensando' ? (
            <div><p className="mb-3 flex items-center gap-2 text-[0.875rem] text-tinta-2"><span className="h-2 w-2 rounded-full bg-rojo anim-pulso" />{fuentes.length ? `Leyendo ${fuentes.length} pasajes…` : 'Buscando en tu biblioteca…'}</p><EsqueletoTexto lineas={4} /></div>
          ) : estado === 'error' ? (
            <p className="text-rojo">{error}</p>
          ) : (
            <p className="lectura whitespace-pre-line text-[1.1875rem] leading-[1.65]">
              {partes.map((p, i) => {
                const m = /^\[\^?(\d+)\]$/.exec(p);
                if (!m) return <span key={i}>{p}</span>;
                const n = Number(m[1]);
                const f = fuentePorCita(n);
                const c = citas.get(n);
                if (!f) return <sup key={i} className="font-mono text-[0.7em] text-apagado">[{n}]</sup>;
                return (
                  <Link key={i} to="/lector/$id" params={{ id: f.documento.id }} search={anclaABusqueda(f.fragmento.ancla, { q: pregunta })}
                    className="mx-0.5 inline-flex -translate-y-[0.15em] items-baseline gap-1 rounded-s border border-filete-fuerte bg-hoja px-1.5 align-baseline font-mono text-[0.7em] text-tinta no-underline hover:border-tinta"
                    title={`${f.documento.metadatos.titulo}, ${c?.etiqueta ?? f.etiqueta}`}>
                    <span className="text-rojo">{n}</span>{etiquetaCorta(f.fragmento.ancla, c?.etiqueta ?? f.etiqueta)}
                  </Link>
                );
              })}
              {estado === 'escribiendo' ? <span className="ml-0.5 inline-block h-[1em] w-[0.5ch] translate-y-[0.15em] bg-tinta anim-pulso" aria-hidden /> : null}
            </p>
          )}
        </div>
        {estado === 'hecho' ? (
          <div className="mt-5 flex flex-wrap items-center gap-3 pl-5">
            {fin?.confianza ? <span className={cx('rotulo rounded-full px-2 py-1', fin.confianza === 'alta' ? 'bg-amarillo text-tinta' : fin.confianza === 'media' ? 'bg-hondo text-tinta' : 'bg-rojo-suave text-rojo')}>Confianza {fin.confianza}</span> : null}
            <Rotulo>{citas.size} citas verificadas · {fin ? `${numero(fin.ms / 1000, { maximumFractionDigits: 1 })} s` : ''}</Rotulo>
            <Boton variante="fantasma" tam="p" icono="copiar" onClick={() => void copiar()}>Copiar con citas</Boton>
          </div>
        ) : null}
      </section>
      <aside aria-label="Fuentes">
        <Rotulo>Fuentes</Rotulo>
        <ol className="mt-3 flex flex-col gap-3">
          {fuentes.length ? fuentes.slice(0, 8).map((f, i) => {
            const n = [...citas.values()].find((c) => c.fragmento === f.fragmento.id)?.n;
            return (
              <li key={f.fragmento.id} className={cx('anim-entra', !n && estado === 'hecho' && 'opacity-55')} style={{ animationDelay: `${i * 40}ms` }}>
                <Link to="/lector/$id" params={{ id: f.documento.id }} search={anclaABusqueda(f.fragmento.ancla, { q: pregunta })} className="group block rounded-s border border-filete bg-hoja p-3 hover:border-filete-fuerte">
                  <div className="flex items-center gap-2">
                    {n ? <span className="grid h-5 w-5 place-items-center rounded-full bg-tinta font-mono text-[0.6875rem] text-sobre-tinta">{n}</span> : null}
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{f.documento.metadatos.titulo}</span>
                    <Folio className="shrink-0">{etiquetaCorta(f.fragmento.ancla, f.etiqueta)}</Folio>
                  </div>
                  <p className="mt-2 line-clamp-3 text-[0.8125rem] text-tinta-2">{textoLimpio(f.fragmento.texto)}</p>
                </Link>
              </li>
            );
          }) : [0, 1, 2].map((i) => <li key={i} className="esqueleto h-24" />)}
        </ol>
      </aside>
    </div>
  );
}
