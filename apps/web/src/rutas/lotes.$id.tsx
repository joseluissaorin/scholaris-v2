/**
 * El avance de un lote: cada elemento con su estado, la cola con su
 * concurrencia, pausar y reanudar, reintentar lo que falló u omitirlo, y soltar
 * otra vez los archivos si la pestaña que los subía se cerró.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DetalleLote, ElementoLote, EstadoElemento } from '@scholaris/contrato';
import { avisar, BarraAvance, Boton, Chip, cx, Esqueleto, Icono, Tarjeta } from '@scholaris/ui';
import { api } from '../datos/api';
import { archivosDeSoltar, conducir, conduciendo, euros, reasociar, tiempoAproximado, tieneFuente } from '../datos/lotes';
import { Cabecera } from '../componentes/comunes/cabecera';
import { IconoTipo } from '../componentes/comunes/icono-tipo';
import { numero } from '../lib/numero';
import { bytes } from '../lib/formato';

export const Route = createFileRoute('/lotes/$id')({ component: PaginaLote });

const ESTADO: Record<EstadoElemento, { texto: string; clase: string }> = {
  pendiente: { texto: 'En cola', clase: 'bg-cream-200 text-coffee-600' },
  subiendo: { texto: 'Subiendo', clase: 'bg-azul/10 text-azul' },
  procesando: { texto: 'Leyendo', clase: 'bg-amarillo/20 text-coffee-800' },
  listo: { texto: 'Listo', clase: 'bg-verde/15 text-verde' },
  duplicado: { texto: 'Ya estaba', clase: 'bg-cream-300 text-coffee-700' },
  error: { texto: 'Error', clase: 'bg-rojo/10 text-rojo' },
  omitido: { texto: 'Omitido', clase: 'bg-cream-200 text-coffee-400' },
  cancelado: { texto: 'Cancelado', clase: 'bg-cream-200 text-coffee-400' },
};

const ICONO: Record<string, 'documento' | 'audio' | 'video' | 'imagen' | 'web' | 'pila' | 'hoja' | 'diapositiva' | 'lector'> = {
  pdf: 'documento', pdf_escaneado: 'documento', audio: 'audio', video: 'video', imagen: 'imagen', fotos: 'imagen', web: 'web', hoja: 'hoja', presentacion: 'diapositiva', epub: 'lector', documento: 'lector',
};

type Filtro = 'todos' | 'curso' | 'listos' | 'errores';

function PaginaLote() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [, refrescar] = useReducer((x: number) => x + 1, 0);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [encima, setEncima] = useState(false);
  const selArchivos = useRef<HTMLInputElement>(null);
  const { data: l } = useQuery({
    queryKey: ['lote', id], queryFn: () => api().lotes.obtener(id),
    refetchInterval: (q) => (q.state.data && (q.state.data.estado === 'en_marcha') ? 2500 : false),
  });

  // Si esta pestaña tiene los archivos, el conductor sigue subiendo.
  useEffect(() => {
    if (l?.estado === 'en_marcha' && l.elementos.some((e) => tieneFuente(id, e.n))) {
      conducir(id, { modo: l.modo, ...(l.biblioteca ? { biblioteca: l.biblioteca } : {}), alCambiar: () => { refrescar(); void qc.invalidateQueries({ queryKey: ['lote', id] }); } });
    }
  }, [l?.estado, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const faltan = useMemo(() => (l ? l.elementos.filter((e) => e.clase !== 'url' && e.estado === 'pendiente' && !tieneFuente(id, e.n)) : []), [l, id]);

  async function accion(f: () => Promise<DetalleLote>, ok?: string) {
    try { qc.setQueryData(['lote', id], await f()); if (ok) avisar(ok); } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo.', { tono: 'error' }); }
  }

  function soltar(fs: File[]) {
    if (!l) return;
    const n = reasociar(id, l.elementos, fs);
    if (!n) { avisar('Ninguno de esos archivos es de este lote (se comparan el nombre y el tamaño).', { tono: 'error' }); return; }
    avisar(`${numero(n)} ${n === 1 ? 'archivo vuelve' : 'archivos vuelven'} a la cola.`, { tono: 'exito' });
    if (l.estado !== 'en_marcha') void accion(() => api().lotes.reanudar(id));
    conducir(id, { modo: l.modo, ...(l.biblioteca ? { biblioteca: l.biblioteca } : {}), alCambiar: () => { refrescar(); void qc.invalidateQueries({ queryKey: ['lote', id] }); } });
    refrescar();
  }

  if (!l) return <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 lg:px-10"><Esqueleto className="h-10 w-1/2" /><Esqueleto className="mt-6 h-40" /></div>;

  const c = l.cuentas;
  const hechos = (c.listo ?? 0) + (c.duplicado ?? 0) + (c.omitido ?? 0) + (c.error ?? 0) + (c.cancelado ?? 0);
  const enCurso = (c.subiendo ?? 0) + (c.procesando ?? 0);
  const avance = l.total ? (hechos + l.elementos.filter((e) => e.estado === 'procesando').reduce((s, e) => s + (e.avance ?? 0), 0)) / l.total : 0;
  const visibles = l.elementos.filter((e) => filtro === 'todos' || (filtro === 'curso' && ['pendiente', 'subiendo', 'procesando'].includes(e.estado))
    || (filtro === 'listos' && ['listo', 'duplicado'].includes(e.estado)) || (filtro === 'errores' && e.estado === 'error'));
  const estadoLote = l.estado === 'en_marcha' ? (enCurso ? 'En marcha' : faltan.length ? 'Esperando los archivos' : 'En marcha') : l.estado === 'pausado' ? 'En pausa' : l.estado === 'terminado' ? 'Terminado' : 'Cancelado';

  return (
    <>
      <Cabecera forma="cuarto" titulo={l.nombre} antetitulo={<>Lote · {estadoLote} · {l.modo === 'economico' ? 'modo económico' : 'modo rápido'} · {numero(l.concurrencia)} a la vez{l.biblioteca ? <> · <Link to="/" search={{ col: l.biblioteca }} className="underline decoration-cream-500 underline-offset-2 hover:text-coffee-800">ver la colección</Link></> : null}</>} />
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-5 sm:px-6 lg:px-10">
        <Tarjeta className="p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="min-w-0 flex-1">
              <p className="text-[1.375rem] font-semibold text-coffee-800"><span className="tnum">{numero(hechos)}</span> <span className="text-[1rem] font-normal text-coffee-500">de {numero(l.total)} terminados</span></p>
              <div className="mt-1 flex flex-wrap gap-x-4 text-[0.8125rem] text-coffee-500">
                <span>{numero(c.listo ?? 0)} listos</span>
                {c.duplicado ? <span>{numero(c.duplicado)} ya estaban</span> : null}
                {enCurso ? <span>{numero(enCurso)} en curso</span> : null}
                {c.pendiente ? <span>{numero(c.pendiente)} en cola</span> : null}
                {c.error ? <span className="text-rojo">{numero(c.error)} con error</span> : null}
                {l.estimacion ? <span>Previsto: {tiempoAproximado(l.estimacion.modos[l.modo].segundos)}, {euros(l.estimacion.modos[l.modo].euros)}</span> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {l.estado === 'en_marcha' ? <Boton variante="linea" icono="pausa" onClick={() => void accion(() => api().lotes.pausar(id), 'En pausa: lo que ya se está leyendo termina; lo demás espera.')}>Pausar</Boton> : null}
              {l.estado === 'pausado' ? <Boton variante="tinta" icono="play" onClick={() => void accion(() => api().lotes.reanudar(id), 'Sigue donde iba.')}>Reanudar</Boton> : null}
              {l.estado === 'en_marcha' || l.estado === 'pausado' ? <Boton variante="fantasma" onClick={() => void accion(() => api().lotes.cancelar(id), 'Lote cancelado.')}>Cancelar</Boton> : null}
            </div>
          </div>
          <BarraAvance className="mt-4" valor={avance} etiqueta="Avance del lote" tono={l.estado === 'pausado' ? 'tinta' : 'rojo'} />
          {conduciendo(id) ? <p className="mt-2 text-[0.75rem] text-coffee-400">Esta pestaña está subiendo los archivos: déjala abierta hasta que no quede nada en cola.</p> : null}
        </Tarjeta>

        {faltan.length && l.estado !== 'cancelado' ? (
          <div
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setEncima(true); }}
            onDragLeave={() => setEncima(false)}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setEncima(false); void archivosDeSoltar(e.dataTransfer).then(soltar); }}
            className={cx('mt-5 flex flex-wrap items-center gap-4 rounded-2xl border-2 border-dashed p-5 shadow-[var(--hundido)]', encima ? 'border-rojo bg-cream-100' : 'border-cream-500 bg-cream-200/50')}
          >
            <Icono nombre="subir" tam={22} className="text-coffee-400" />
            <p className="min-w-0 flex-1 text-[0.875rem] text-coffee-700">
              {numero(faltan.length)} {faltan.length === 1 ? 'archivo espera' : 'archivos esperan'} a que los vuelvas a soltar aquí (la pestaña que los subía se cerró). Se reconocen por el nombre y el tamaño.
            </p>
            <Boton variante="linea" tam="p" onClick={() => selArchivos.current?.click()}>Elegir los archivos</Boton>
            <input ref={selArchivos} type="file" multiple hidden onChange={(e) => { soltar([...(e.target.files ?? [])]); e.target.value = ''; }} />
          </div>
        ) : null}

        <div className="mb-3 mt-7 flex flex-wrap items-center gap-2">
          <h2 className="rotulo mr-2 text-[0.75rem] text-coffee-700">Elementos</h2>
          {([['todos', 'Todos', l.total], ['curso', 'En curso', (c.pendiente ?? 0) + enCurso], ['listos', 'Listos', (c.listo ?? 0) + (c.duplicado ?? 0)], ['errores', 'Con error', c.error ?? 0]] as const).map(([k, t, n]) =>
            <Chip key={k} activo={filtro === k} recuento={n} onClick={() => setFiltro(k)}>{t}</Chip>)}
        </div>
        <ul className="overflow-hidden rounded-xl border border-cream-300 bg-cream-50 shadow-[var(--shadow-soft)]">
          {visibles.map((e) => <FilaElemento key={e.n} e={e} lote={id} alCambiar={(d) => qc.setQueryData(['lote', id], d)} />)}
          {!visibles.length ? <li className="px-4 py-6 text-center text-[0.875rem] text-coffee-400">Nada por aquí.</li> : null}
        </ul>
      </div>
    </>
  );
}

function FilaElemento({ e, lote, alCambiar }: { e: ElementoLote; lote: string; alCambiar: (d: DetalleLote) => void }) {
  const est = ESTADO[e.estado];
  async function hacer(f: () => Promise<DetalleLote>) {
    try { alCambiar(await f()); } catch (err) { avisar(err instanceof Error ? err.message : 'No se pudo.', { tono: 'error' }); }
  }
  return (
    <li className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-cream-200 px-4 py-2.5 last:border-b-0">
      <IconoTipo nombre={e.clase === 'spdf' ? 'pila' : e.clase === 'url' ? 'web' : ICONO[e.tipo ?? ''] ?? 'documento'} tam={30} />
      <div className="min-w-0">
        <p className="truncate text-[0.875rem] text-coffee-800">
          {e.documento && (e.estado === 'listo' || e.estado === 'duplicado') ? <Link to="/lector/$id" params={{ id: e.documento }} className="hover:underline">{e.metadatos?.titulo ?? e.nombre}</Link> : (e.metadatos?.titulo ?? e.nombre)}
        </p>
        <p className="truncate text-[0.75rem] text-coffee-400">
          {e.ruta && e.ruta !== e.nombre ? `${e.ruta} · ` : ''}{e.bytes ? bytes(e.bytes) : e.clase === 'url' ? 'enlace' : ''}
          {e.minutos ? ` · ${numero(Math.round(e.minutos))} min` : ''}{e.intentos > 1 ? ` · intento ${e.intentos}` : ''}
          {e.error ? <span className="text-rojo"> · {e.error}</span> : null}
        </p>
        {e.estado === 'procesando' ? <BarraAvance className="mt-1.5 h-1.5" valor={e.avance} etiqueta={`Leyendo ${e.nombre}`} tono="azul" /> : null}
      </div>
      <div className="flex items-center gap-1.5">
        <span className={cx('rounded-full px-2.5 py-0.5 text-[0.75rem] font-medium', est.clase)}>{est.texto}</span>
        {['error', 'cancelado', 'omitido'].includes(e.estado) ? <Boton variante="fantasma" tam="p" icono="deshacer" onClick={() => void hacer(() => api().lotes.reintentar(lote, e.n))}>Reintentar</Boton> : null}
        {['pendiente', 'error'].includes(e.estado) ? <Boton variante="fantasma" tam="p" onClick={() => void hacer(() => api().lotes.omitir(lote, e.n))}>Omitir</Boton> : null}
      </div>
    </li>
  );
}

