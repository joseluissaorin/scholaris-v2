import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Cuaderno, Sintesis, Tarjeta } from '@scholaris/contrato';
import { AreaTexto, avisar, Boton, Campo, conDeshacer, cx, Dialogo, Esqueleto, EsqueletoTexto, Folio, Icono, Rotulo, Vacio } from '@scholaris/ui';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { haceCuanto } from '../lib/formato';

export const Route = createFileRoute('/escribir/cuadernos')({
  validateSearch: (s: Record<string, unknown>): { c?: string } => ({ c: typeof s.c === 'string' ? s.c : undefined }),
  loader: ({ context }) => context.consultas.ensureQueryData(q.cuadernos()),
  component: Cuadernos,
});

function Cuadernos() {
  const { c } = Route.useSearch();
  const navegar = useNavigate({ from: '/escribir/cuadernos' });
  const { data: cuadernos, isPending } = useQuery(q.cuadernos());
  const [nuevo, setNuevo] = useState(false);
  const activo = cuadernos?.find((x) => x.id === c) ?? cuadernos?.[0];

  return (
    <Lienzo>
      <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label="Cuadernos" className="flex flex-col gap-2">
          <Boton variante="tinta" icono="mas" onClick={() => setNuevo(true)}>Nuevo cuaderno</Boton>
          <ul className="mt-2 flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {isPending ? [0, 1].map((i) => <Esqueleto key={i} className="h-16 w-full" />) : cuadernos?.map((x) => (
              <li key={x.id} className="shrink-0">
                <Link to="/escribir/cuadernos" search={{ c: x.id }} className={cx('block rounded-s border px-3 py-2.5', activo?.id === x.id ? 'border-tinta bg-hoja' : 'border-filete hover:border-filete-fuerte')}>
                  <p className={cx('truncate text-[1rem]', activo?.id === x.id && 'italic')}>{x.titulo}</p>
                  <Rotulo>{x.tarjetas} tarjetas · {haceCuanto(x.actualizado)}</Rotulo>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {activo ? <DetalleCuaderno key={activo.id} cuaderno={activo} /> : !isPending ? (
          <Vacio forma="cuadrado" titulo="Un cuaderno para cada idea." accion={<Boton variante="tinta" icono="mas" onClick={() => setNuevo(true)}>Crear un cuaderno</Boton>}>
            Guarda pasajes desde el lector o desde la búsqueda, añade tus notas y pide una síntesis con citas que se comprueban solas.
          </Vacio>
        ) : null}
      </div>
      <NuevoCuaderno abierto={nuevo} alCambiar={setNuevo} alCrear={(id) => void navegar({ search: { c: id } })} />
    </Lienzo>
  );
}

function DetalleCuaderno({ cuaderno }: { cuaderno: Cuaderno }) {
  const qc = useQueryClient();
  const { data: tarjetas, isPending } = useQuery(q.tarjetas(cuaderno.id));
  const [nota, setNota] = useState('');
  const [instruccion, setInstruccion] = useState('Relaciona los pasajes y señala dónde discrepan.');
  const [sintesis, setSintesis] = useState<Sintesis | null>(null);
  const [sintetizando, setSintetizando] = useState(false);

  async function anadirNota() {
    const t = nota.trim();
    if (!t) return;
    setNota('');
    const temporal: Tarjeta = { id: `tmp-${Date.now()}`, tipo: 'nota', contenido: { texto: t }, posicion: 999, huerfana: false, creada: new Date().toISOString() };
    qc.setQueryData<Tarjeta[]>(['tarjetas', cuaderno.id], (l) => [...(l ?? []), temporal]);
    try { await api().cuadernos.crearTarjeta(cuaderno.id, { tipo: 'nota', contenido: { texto: t } }); void qc.invalidateQueries({ queryKey: ['tarjetas', cuaderno.id] }); void qc.invalidateQueries({ queryKey: ['cuadernos'] }); }
    catch { avisar('No se pudo guardar la nota.', { tono: 'error' }); }
  }

  function quitar(t: Tarjeta) {
    const previo = qc.getQueryData<Tarjeta[]>(['tarjetas', cuaderno.id]);
    qc.setQueryData<Tarjeta[]>(['tarjetas', cuaderno.id], (l) => l?.filter((x) => x.id !== t.id));
    conDeshacer('Tarjeta quitada.', () => qc.setQueryData(['tarjetas', cuaderno.id], previo), () => void api().cuadernos.borrarTarjeta(cuaderno.id, t.id).then(() => qc.invalidateQueries({ queryKey: ['cuadernos'] })));
  }

  async function sintetizar() {
    setSintetizando(true); setSintesis(null);
    try { setSintesis(await api().cuadernos.sintetizar(cuaderno.id, instruccion)); }
    catch { avisar('No se pudo sintetizar.', { tono: 'error' }); }
    setSintetizando(false);
  }

  return (
    <section aria-label={cuaderno.titulo} className="min-w-0">
      <h2 className="titular text-[clamp(2rem,4vw,3rem)]">{cuaderno.titulo}</h2>
      <Rotulo className="mt-2 block">{tarjetas?.length ?? cuaderno.tarjetas} tarjetas · actualizado {haceCuanto(cuaderno.actualizado)}</Rotulo>

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ol className="flex flex-col gap-3">
          {isPending ? [0, 1, 2].map((i) => <Esqueleto key={i} className="h-28" />) : tarjetas?.map((t) => (
            <li key={t.id} className="group relative anim-entra">
              {t.tipo === 'nota' ? (
                <div className="rounded-s border-l-[3px] border-amarillo bg-amarillo-suave/50 px-4 py-3">
                  <Rotulo>Nota</Rotulo>
                  <p className="mt-1">{String(t.contenido.texto ?? '')}</p>
                </div>
              ) : (
                <div className={cx('rounded-s border bg-hoja px-4 py-3', t.huerfana ? 'border-rojo' : 'border-filete')}>
                  <p className="lectura text-[1rem]">«{t.cita?.texto ?? String(t.contenido.texto ?? '')}»</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.8125rem] text-tinta-2">
                    {t.cita ? <Folio>{t.cita.etiqueta}</Folio> : null}
                    <span className="font-mono">{t.cita?.citaCorta}</span>
                    {t.documento ? <Link to="/lector/$id" params={{ id: t.documento }} search={{ u: Number(t.objetivo?.split('-').at(-2)) || undefined }} className="ml-auto underline underline-offset-4">Abrir</Link> : null}
                  </div>
                  {t.huerfana ? <p className="mt-2 text-[0.8125rem] text-rojo">El pasaje ya no está en tu biblioteca.</p> : null}
                </div>
              )}
              <button type="button" onClick={() => quitar(t)} aria-label="Quitar la tarjeta" className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-s text-apagado hover:bg-hondo hover:text-rojo md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"><Icono nombre="cerrar" tam={14} /></button>
            </li>
          ))}
          <li>
            <form onSubmit={(e) => { e.preventDefault(); void anadirNota(); }} className="flex gap-2">
              <Campo value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Añadir una nota…" aria-label="Nueva nota" className="flex-1" />
              <Boton type="submit" variante="linea" disabled={!nota.trim()}>Añadir</Boton>
            </form>
            <p className="mt-2 text-[0.8125rem] text-apagado">Los pasajes se guardan desde el lector (selecciona texto) o desde los resultados de búsqueda.</p>
          </li>
        </ol>

        <aside className="flex flex-col gap-3 xl:sticky xl:top-28 xl:self-start">
          <Rotulo>Síntesis con citas</Rotulo>
          <AreaTexto value={instruccion} onChange={(e) => setInstruccion(e.target.value)} className="min-h-20" aria-label="Instrucciones para la síntesis" />
          <Boton variante="rojo" icono="chispa" cargando={sintetizando} onClick={() => void sintetizar()} disabled={!tarjetas?.length}>Sintetizar</Boton>
          {sintetizando ? <EsqueletoTexto lineas={5} className="mt-2" /> : sintesis ? (
            <div className="mt-2 rounded-s border border-tinta bg-hoja p-4 anim-entra">
              <p className="lectura text-[0.9875rem]">
                {sintesis.texto.split(/(\[\d+\])/g).map((p, i) => {
                  const m = /^\[(\d+)\]$/.exec(p);
                  const c = m ? sintesis.citas.find((x) => x.n === Number(m[1])) : undefined;
                  return c ? <span key={i} className="mx-0.5 rounded-[3px] border border-filete-fuerte px-1 font-mono text-[0.72em]"><span className="text-rojo">{c.n}</span> {c.etiqueta}</span> : <span key={i}>{p}</span>;
                })}
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function NuevoCuaderno({ abierto, alCambiar, alCrear }: { abierto: boolean; alCambiar: (v: boolean) => void; alCrear: (id: string) => void }) {
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState('');
  async function crear() {
    if (!titulo.trim()) return;
    alCambiar(false);
    try { const c = await api().cuadernos.crear({ titulo: titulo.trim() }); qc.setQueryData<Cuaderno[]>(['cuadernos'], (l) => [c, ...(l ?? [])]); alCrear(c.id); }
    catch { avisar('No se pudo crear el cuaderno.', { tono: 'error' }); }
    setTitulo('');
  }
  return (
    <Dialogo abierto={abierto} alCambiar={alCambiar} titulo="Nuevo cuaderno" pie={<><Boton variante="fantasma" onClick={() => alCambiar(false)}>Cancelar</Boton><Boton variante="tinta" disabled={!titulo.trim()} onClick={() => void crear()}>Crear</Boton></>}>
      <form onSubmit={(e) => { e.preventDefault(); void crear(); }}><Campo autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Panóptico y plataformas" aria-label="Título" /></form>
    </Dialogo>
  );
}
