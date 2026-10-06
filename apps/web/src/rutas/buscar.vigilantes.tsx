import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Alerta, ModoVigilante, ResumenDocumento, Vigilante } from '@scholaris/contrato';
import { avisar, Boton, Campo, conDeshacer, cx, Dialogo, Esqueleto, Etiquetado, Icono, Interruptor, Rotulo, Selector, Tarjeta, Vacio } from '@scholaris/ui';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { haceCuanto } from '../lib/formato';

const MODOS: Record<ModoVigilante, string> = { al_ingerir: 'Cada vez que añado algo', diario: 'Una vez al día', semanal: 'Una vez a la semana', manual: 'Solo cuando lo pida' };

export const Route = createFileRoute('/buscar/vigilantes')({
  loader: ({ context }) => Promise.all([context.consultas.ensureQueryData(q.vigilantes()), context.consultas.ensureQueryData(q.alertas())]),
  component: Vigilantes,
});

function Vigilantes() {
  const qc = useQueryClient();
  const { data: vigilantes, isPending } = useQuery(q.vigilantes());
  const { data: alertas = [] } = useQuery(q.alertas());
  const { data: docs } = useQuery(q.documentos());
  const [editar, setEditar] = useState<Partial<Vigilante> | null>(null);
  const pendientes = alertas.filter((a) => !a.vista);
  const titulo = (id: string) => docs?.elementos.find((d: ResumenDocumento) => d.id === id)?.titulo ?? 'Documento';

  async function cambiar(v: Vigilante, c: Partial<Vigilante>) {
    qc.setQueryData<Vigilante[]>(['vigilantes'], (l) => l?.map((x) => (x.id === v.id ? { ...x, ...c } : x)));
    try { await api().vigilantes.editar(v.id, c); } catch { avisar('No se pudo guardar.', { tono: 'error' }); void qc.invalidateQueries({ queryKey: ['vigilantes'] }); }
  }

  function borrar(v: Vigilante) {
    const previo = qc.getQueryData<Vigilante[]>(['vigilantes']);
    qc.setQueryData<Vigilante[]>(['vigilantes'], (l) => l?.filter((x) => x.id !== v.id));
    conDeshacer(`Vigilante «${v.nombre}» borrado.`, () => qc.setQueryData(['vigilantes'], previo), () => void api().vigilantes.borrar(v.id));
  }

  async function ejecutar(v: Vigilante) {
    avisar(`Buscando novedades para «${v.nombre}»…`);
    try {
      const r = await api().vigilantes.ejecutar(v.id);
      if ('nada' in r) avisar('Nada nuevo desde la última vez.');
      else avisar('Hay novedades.', { tono: 'exito' });
      void qc.invalidateQueries({ queryKey: ['vigilantes'] });
      void qc.invalidateQueries({ queryKey: ['alertas'] });
    } catch { avisar('No se pudo ejecutar.', { tono: 'error' }); }
  }

  async function visto(a: Alerta) {
    qc.setQueryData<Alerta[]>(['alertas'], (l) => l?.map((x) => (x.id === a.id ? { ...x, vista: new Date().toISOString() } : x)));
    try { await api().alertas.visto(a.id); void qc.invalidateQueries({ queryKey: ['vigilantes'] }); } catch { /* se reintentará */ }
  }

  return (
    <Lienzo>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <section>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-[1.125rem] font-semibold text-coffee-800">Vigilantes</h2>
              <p className="mt-1 max-w-lg text-[0.9375rem] text-tinta-2">Preguntas que se quedan haciendo guardia. Cuando entra algo en tu biblioteca que las responde, te avisan.</p>
            </div>
            <Boton variante="tinta" icono="mas" onClick={() => setEditar({ modo: 'al_ingerir', alertas: true })}>Nuevo</Boton>
          </div>
          <ul className="mt-6 flex flex-col gap-3">
            {isPending ? [0, 1, 2].map((i) => <Esqueleto key={i} className="h-28" />) : !vigilantes?.length ? (
              <Vacio forma="circulo" titulo="Ninguna pregunta de guardia." accion={<Boton variante="tinta" icono="mas" onClick={() => setEditar({ modo: 'al_ingerir', alertas: true })}>Crear el primero</Boton>}>
                Por ejemplo: «abyección en cartas y archivos personales». Cada libro nuevo se mira con esa pregunta.
              </Vacio>
            ) : vigilantes.map((v) => (
              <li key={v.id}>
                <Tarjeta className="p-4 md:p-5">
                  <div className="flex items-start gap-4">
                    <span className={cx('mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full', v.pendientes ? 'bg-amarillo text-tinta' : 'bg-hondo text-tinta-2')}><Icono nombre="vigilante" tam={17} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-[1.125rem]">{v.nombre}</h3>
                        {v.pendientes ? <span className="rotulo rounded-full bg-amarillo px-2 py-0.5 text-tinta">{v.pendientes} sin ver</span> : null}
                      </div>
                      <p className="mt-0.5 truncate text-tinta-2">«{v.consulta}»</p>
                      <Rotulo className="mt-2 block">{MODOS[v.modo]}{v.ultimaEjecucion ? ` · mirado ${haceCuanto(v.ultimaEjecucion)}` : ''}</Rotulo>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <label className="flex items-center gap-2 text-[0.8125rem] text-tinta-2">Avisos<Interruptor activo={v.alertas} alCambiar={(a) => void cambiar(v, { alertas: a })} etiqueta={`Avisos de «${v.nombre}»`} /></label>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1 border-t border-filete pt-3">
                    <Boton variante="fantasma" tam="p" icono="rayo" onClick={() => void ejecutar(v)}>Mirar ahora</Boton>
                    <Boton variante="fantasma" tam="p" icono="buscar" comoHijo><Link to="/buscar" search={{ q: v.consulta }}><Icono nombre="buscar" tam={15} />Buscar</Link></Boton>
                    <Boton variante="fantasma" tam="p" icono="editar" onClick={() => setEditar(v)}>Editar</Boton>
                    <Boton variante="fantasma" tam="p" icono="papelera" className="ml-auto !text-rojo" onClick={() => borrar(v)}>Borrar</Boton>
                  </div>
                </Tarjeta>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Alertas">
          <h2 className="text-[1.125rem] font-semibold text-coffee-800">Alertas</h2>
          <p className="mt-1 text-[0.9375rem] text-tinta-2">{pendientes.length ? `${pendientes.length} sin ver.` : 'Estás al día.'}</p>
          <ol className="mt-6 flex flex-col gap-3">
            {alertas.map((a) => (
              <li key={a.id} className={cx('relative rounded-m border p-4', a.vista ? 'border-cream-300 bg-cream-100/70' : 'border-cream-400 bg-cream-50 shadow-[var(--levantado)]')}>
                {!a.vista ? <span className="absolute -left-[5px] top-5 h-2.5 w-2.5 rounded-full bg-amarillo ring-2 ring-papel" /> : null}
                <Rotulo>{a.nombreVigilante} · {haceCuanto(a.creada)}{a.disparadaPor === 'ingesta' ? ' · al añadir' : ''}</Rotulo>
                {a.cambio ? <p className="mt-2 text-[0.9375rem]">{a.cambio}</p> : null}
                <ul className="mt-2 flex flex-col gap-1">
                  {a.documentosNuevos.map((d) => (
                    <li key={d}><Link to="/lector/$id" params={{ id: d }} onClick={() => void visto(a)} className="flex items-center gap-2 text-[0.875rem] underline decoration-filete-fuerte underline-offset-4 hover:decoration-tinta"><Icono nombre="lector" tam={14} className="not-" />{titulo(d)}</Link></li>
                  ))}
                </ul>
                {!a.vista ? <button type="button" onClick={() => void visto(a)} className="mt-3 text-[0.8125rem] text-tinta-2 underline underline-offset-4">Marcar como vista</button> : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
      {editar ? <EditorVigilante inicial={editar} alCerrar={() => setEditar(null)} /> : null}
    </Lienzo>
  );
}

function EditorVigilante({ inicial, alCerrar }: { inicial: Partial<Vigilante>; alCerrar: () => void }) {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState(inicial.nombre ?? '');
  const [consulta, setConsulta] = useState(inicial.consulta ?? '');
  const [modo, setModo] = useState<ModoVigilante>(inicial.modo ?? 'al_ingerir');
  const valido = consulta.trim().length > 2;
  async function guardar() {
    alCerrar();
    // Sin nombre, la propia pregunta (cortada en palabra entera).
    const corto = consulta.trim().length > 60 ? `${consulta.trim().slice(0, 60).replace(/\s+\S*$/, '')}…` : consulta.trim();
    const datos = { nombre: nombre.trim() || corto.charAt(0).toUpperCase() + corto.slice(1), consulta: consulta.trim(), modo, alertas: inicial.alertas ?? true };
    try {
      if (inicial.id) await api().vigilantes.editar(inicial.id, datos);
      else await api().vigilantes.crear(datos);
      void qc.invalidateQueries({ queryKey: ['vigilantes'] });
      avisar(inicial.id ? 'Vigilante guardado.' : 'Vigilante de guardia.', { tono: 'exito' });
    } catch { avisar('No se pudo guardar.', { tono: 'error' }); }
  }
  return (
    <Dialogo abierto alCambiar={(v) => !v && alCerrar()} titulo={inicial.id ? 'Editar vigilante' : 'Nuevo vigilante'}
      pie={<><Boton variante="fantasma" onClick={alCerrar}>Cancelar</Boton><Boton variante="tinta" disabled={!valido} onClick={() => void guardar()}>Guardar</Boton></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (valido) void guardar(); }}>
        <Etiquetado etiqueta="Pregunta" ayuda="Escrita como la buscarías.">{(id, d) => <Campo id={id} aria-describedby={d} autoFocus value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="abyección en cartas y archivos personales" />}</Etiquetado>
        <Etiquetado etiqueta="Nombre (opcional)">{(id) => <Campo id={id} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Abyección y archivo" />}</Etiquetado>
        <Etiquetado etiqueta="Cuándo mirar">{(id) => <Selector id={id} value={modo} onChange={(e) => setModo(e.target.value as ModoVigilante)}>{(Object.keys(MODOS) as ModoVigilante[]).map((m) => <option key={m} value={m}>{MODOS[m]}</option>)}</Selector>}</Etiquetado>
      </form>
    </Dialogo>
  );
}
