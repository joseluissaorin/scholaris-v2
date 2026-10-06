/**
 * Compartir una colección: personas con su papel (lector, editor,
 * administrador), invitaciones que hay que aceptar, enlaces de solo lectura sin
 * cuenta (con contraseña y caducidad) y los derechos de lo que hay dentro.
 * Para seminarios, grupos de investigación y quien quiera pasarte su biblioteca.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DERECHOS, ErrorApi, type Biblioteca, type Derechos, type Enlace, type Miembro, type PermisoInvitado } from '@scholaris/contrato';
import { AreaTexto, avisar, Boton, Campo, cx, Dialogo, Icono, Rotulo, Selector } from '@scholaris/ui';
import { api } from '../../datos/api';
import { fecha } from '../../lib/formato';

const PAPEL: Record<Miembro['permiso'], string> = { propietario: 'Propietario', administrador: 'Administra', edicion: 'Edita', lectura: 'Lee' };
const PAPELES: Array<[PermisoInvitado, string, string]> = [
  ['lectura', 'Lector', 'Lee, busca y cita'],
  ['edicion', 'Editor', 'Además añade documentos y corrige fichas'],
  ['administrador', 'Administrador', 'Además invita y gestiona a los demás'],
];
const CADUCIDAD: Array<[string, string]> = [['', 'No caduca'], ['7', 'Una semana'], ['30', 'Un mes'], ['90', 'Tres meses'], ['365', 'Un año']];

type Pestana = 'personas' | 'enlace' | 'derechos';

async function copiar(texto: string, aviso: string) {
  try { await navigator.clipboard.writeText(texto); avisar(aviso, { tono: 'exito' }); } catch { avisar(texto); }
}

export default function Compartir({ biblioteca, alCerrar, inicial = 'personas' }: { biblioteca: Biblioteca; alCerrar: () => void; inicial?: Pestana }) {
  const [pestana, setPestana] = useState<Pestana>(inicial);
  const propia = biblioteca.permiso === 'propietario';
  return (
    <Dialogo abierto alCambiar={(v) => !v && alCerrar()} ancho="g" titulo={`Compartir «${biblioteca.nombre}»`}
      descripcion="Quien entre podrá seguirla (la verá cambiar a la vez que tú) o copiarla a su Scholaris al instante, sin volver a leer nada."
      pie={<Boton variante="tinta" onClick={alCerrar}>Hecho</Boton>}>
      <div role="tablist" aria-label="Cómo compartir" className="mb-5 inline-flex rounded-xl border border-cream-400 bg-cream-200/70 p-1 shadow-[var(--hundido)]">
        {([['personas', 'Personas'], ['enlace', 'Enlace'], ...(propia ? [['derechos', 'Derechos']] : [])] as Array<[Pestana, string]>).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={pestana === k} onClick={() => setPestana(k)}
            className={cx('rounded-lg px-4 py-1.5 text-[0.8125rem] font-medium transition-colors', pestana === k ? 'bg-cream-50 text-coffee-800 shadow-[var(--relieve)]' : 'text-coffee-500 hover:text-coffee-800')}>{t}</button>
        ))}
      </div>
      {pestana === 'personas' ? <Personas biblioteca={biblioteca} /> : pestana === 'enlace' ? <Enlaces biblioteca={biblioteca} irADerechos={() => setPestana('derechos')} /> : <DerechosBiblioteca biblioteca={biblioteca} />}
    </Dialogo>
  );
}

function Personas({ biblioteca }: { biblioteca: Biblioteca }) {
  const qc = useQueryClient();
  const { data: miembros, isPending } = useQuery({ queryKey: ['miembros', biblioteca.id], queryFn: () => api().bibliotecas.miembros(biblioteca.id) });
  const [correo, setCorreo] = useState('');
  const [permiso, setPermiso] = useState<PermisoInvitado>('lectura');
  const [mensaje, setMensaje] = useState('');
  const [caduca, setCaduca] = useState('');
  const [masOpciones, setMasOpciones] = useState(false);
  const valido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim());
  const refrescar = () => { void qc.invalidateQueries({ queryKey: ['miembros', biblioteca.id] }); void qc.invalidateQueries({ queryKey: ['bibliotecas'] }); };

  async function invitar() {
    try {
      const inv = await api().bibliotecas.compartir(biblioteca.id, { correo: correo.trim(), permiso, ...(mensaje.trim() ? { mensaje: mensaje.trim() } : {}), ...(caduca ? { caducaDias: Number(caduca) } : {}) });
      setCorreo(''); setMensaje('');
      refrescar();
      if (inv.estado === 'aceptada') avisar(`${inv.correo} ya tenía acceso: su papel ha cambiado.`, { tono: 'exito' });
      else if (inv.correoEnviado) avisar(`Invitación enviada a ${inv.correo}.`, { tono: 'exito' });
      else void copiar(inv.enlace, `Invitación creada. Hemos copiado el enlace para que se lo mandes a ${inv.correo}.`);
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo invitar.', { tono: 'error' }); }
  }
  async function cambiar(m: Miembro, p: PermisoInvitado) {
    try { await api().bibliotecas.cambiarPermiso(biblioteca.id, m.usuario ?? m.correo, p); refrescar(); } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo cambiar.', { tono: 'error' }); }
  }
  async function quitar(m: Miembro) {
    try { await api().bibliotecas.dejarDeCompartir(biblioteca.id, m.usuario ?? m.correo); refrescar(); avisar(m.pendiente ? 'Invitación retirada.' : `${m.nombre || m.correo} ya no tiene acceso.`); }
    catch { avisar('No se pudo quitar.', { tono: 'error' }); }
  }

  return (
    <>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (valido) void invitar(); }}>
        <div className="flex flex-wrap gap-2">
          <Campo autoFocus type="email" placeholder="correo@universidad.es" value={correo} onChange={(e) => setCorreo(e.target.value)} aria-label="Correo de la persona" className="min-w-56 flex-1" />
          <Selector value={permiso} onChange={(e) => setPermiso(e.target.value as PermisoInvitado)} aria-label="Papel" className="w-40">
            {PAPELES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </Selector>
          <Boton type="submit" variante="tinta" disabled={!valido}>Invitar</Boton>
        </div>
        <p className="text-[0.75rem] text-coffee-400">{PAPELES.find((x) => x[0] === permiso)?.[2]}. La invitación hay que aceptarla; hasta entonces no ve nada.{' '}
          <button type="button" className="underline underline-offset-2 hover:text-coffee-700" onClick={() => setMasOpciones((v) => !v)}>{masOpciones ? 'Menos opciones' : 'Mensaje y caducidad'}</button>
        </p>
        {masOpciones ? (
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <AreaTexto rows={2} placeholder="Unas líneas para quien la recibe (opcional)" value={mensaje} onChange={(e) => setMensaje(e.target.value)} aria-label="Mensaje" />
            <Selector value={caduca} onChange={(e) => setCaduca(e.target.value)} aria-label="El acceso caduca">
              {CADUCIDAD.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </Selector>
          </div>
        ) : null}
      </form>
      <ul className="mt-5 border-t border-filete">
        {isPending ? <li className="py-3 text-apagado">Cargando…</li> : miembros?.map((m) => (
          <li key={m.correo || m.usuario} className="flex items-center gap-3 border-b border-filete py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-hondo text-[0.875rem] uppercase">{(m.nombre || m.correo).charAt(0)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate">{m.nombre || m.correo}{m.nombre ? <span className="text-coffee-400"> · {m.correo}</span> : null}</p>
              {m.pendiente ? <Rotulo>Invitación pendiente{m.caduca ? ` · caduca el ${fecha(m.caduca)}` : ''}</Rotulo> : m.caduca ? <Rotulo>Hasta el {fecha(m.caduca)}</Rotulo> : null}
            </div>
            {m.permiso === 'propietario' ? <span className="text-[0.875rem] text-tinta-2">{PAPEL.propietario}</span> : (
              <>
                <Selector value={m.permiso} onChange={(e) => void cambiar(m, e.target.value as PermisoInvitado)} aria-label={`Papel de ${m.correo}`} className="w-36">
                  {PAPELES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </Selector>
                {m.pendiente && m.enlace ? <Boton variante="fantasma" tam="p" icono="copiar" aria-label="Copiar el enlace de la invitación" onClick={() => void copiar(m.enlace!, 'Enlace de la invitación copiado.')} /> : null}
                <Boton variante="fantasma" tam="p" onClick={() => void quitar(m)}>{m.pendiente ? 'Retirar' : 'Quitar'}</Boton>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Enlaces({ biblioteca, irADerechos }: { biblioteca: Biblioteca; irADerechos: () => void }) {
  const qc = useQueryClient();
  const { data: enlaces = [], isPending } = useQuery({ queryKey: ['enlaces', biblioteca.id], queryFn: () => api().bibliotecas.enlaces(biblioteca.id) });
  const [clave, setClave] = useState('');
  const [caduca, setCaduca] = useState('30');
  const [confirmado, setConfirmado] = useState(false);
  const abierto = DERECHOS[biblioteca.derechos ?? 'sin_indicar']?.abierto ?? false;

  async function crear() {
    try {
      const e = await api().enlaces.crear({ biblioteca: biblioteca.id, ...(clave ? { clave } : {}), ...(caduca ? { caducaDias: Number(caduca) } : {}), ...(confirmado ? { confirmarDerechos: true } : {}) });
      setClave('');
      qc.setQueryData<Enlace[]>(['enlaces', biblioteca.id], (l) => [e, ...(l ?? [])]);
      void copiar(e.url, 'Enlace creado y copiado.');
    } catch (err) {
      avisar(err instanceof ErrorApi && err.codigo === 'conflicto' ? 'Marca antes la casilla del uso privado.' : err instanceof Error ? err.message : 'No se pudo crear el enlace.', { tono: 'error' });
    }
  }
  async function revocar(e: Enlace) {
    try { await api().enlaces.revocar(e.id); qc.setQueryData<Enlace[]>(['enlaces', biblioteca.id], (l) => (l ?? []).filter((x) => x.id !== e.id)); avisar('El enlace ya no funciona.'); }
    catch { avisar('No se pudo retirar.', { tono: 'error' }); }
  }

  return (
    <>
      <p className="text-[0.875rem] text-coffee-600">Un enlace abre la colección en solo lectura, sin cuenta: se puede buscar dentro y leer con el folio exacto. No aparece en ningún listado ni en los buscadores; solo la ve quien lo recibe.</p>
      {!abierto ? (
        <div className="mt-4 flex gap-3 rounded-xl border border-ocre/40 bg-amarillo/10 p-3.5">
          <Icono nombre="aviso" tam={18} className="mt-0.5 shrink-0 text-ocre" />
          <div className="text-[0.8125rem] text-coffee-700">
            <p>Los derechos de esta colección son <strong>{DERECHOS[biblioteca.derechos ?? 'sin_indicar'].nombre.toLowerCase()}</strong>. Si contiene obras con derechos de autor, compártela solo para uso privado con personas concretas, nunca en abierto.</p>
            <label className="mt-2 flex items-start gap-2">
              <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} className="mt-0.5 accent-[#2c1810]" />
              <span>Lo comparto para uso privado de quien reciba el enlace.</span>
            </label>
            {biblioteca.permiso === 'propietario' ? <button type="button" onClick={irADerechos} className="mt-1.5 text-[0.75rem] underline underline-offset-2">Indicar los derechos</button> : null}
          </div>
        </div>
      ) : null}
      <form className="mt-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void crear(); }}>
        <Campo type="text" placeholder="Contraseña (opcional)" value={clave} onChange={(e) => setClave(e.target.value)} aria-label="Contraseña del enlace" className="min-w-48 flex-1" autoComplete="off" />
        <Selector value={caduca} onChange={(e) => setCaduca(e.target.value)} aria-label="El enlace caduca" className="w-40">
          {CADUCIDAD.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </Selector>
        <Boton type="submit" variante="tinta" icono="enlace" disabled={!abierto && !confirmado}>Crear enlace</Boton>
      </form>
      <ul className="mt-5 border-t border-filete">
        {isPending ? <li className="py-3 text-apagado">Cargando…</li> : null}
        {!isPending && !enlaces.length ? <li className="py-3 text-[0.875rem] text-coffee-400">Todavía no hay enlaces.</li> : null}
        {enlaces.map((e) => (
          <li key={e.id} className="flex items-center gap-3 border-b border-filete py-3">
            <Icono nombre={e.conClave ? 'llave' : 'enlace'} tam={16} className="text-coffee-400" />
            <div className="min-w-0 flex-1">
              <p className="dato truncate text-[0.8125rem]">{e.url}</p>
              <Rotulo>{e.conClave ? 'Con contraseña · ' : ''}{e.caduca ? `Caduca el ${fecha(e.caduca)}` : 'No caduca'} · {e.visitas} {e.visitas === 1 ? 'visita' : 'visitas'}</Rotulo>
            </div>
            <Boton variante="fantasma" tam="p" icono="copiar" onClick={() => void copiar(e.url, 'Enlace copiado.')}>Copiar</Boton>
            <Boton variante="fantasma" tam="p" onClick={() => void revocar(e)}>Retirar</Boton>
          </li>
        ))}
      </ul>
    </>
  );
}

function DerechosBiblioteca({ biblioteca }: { biblioteca: Biblioteca }) {
  const qc = useQueryClient();
  const [derechos, setDerechos] = useState<Derechos>(biblioteca.derechos ?? 'sin_indicar');
  const [nota, setNota] = useState(biblioteca.notaDerechos ?? '');
  const [descripcion, setDescripcion] = useState(biblioteca.descripcion ?? '');
  async function guardar() {
    try {
      const b = await api().bibliotecas.editar(biblioteca.id, { derechos, notaDerechos: nota.trim(), descripcion: descripcion.trim() });
      qc.setQueryData<Biblioteca[]>(['bibliotecas'], (l) => (l ?? []).map((x) => (x.id === b.id ? { ...x, ...b } : x)));
      avisar('Guardado.', { tono: 'exito' });
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo guardar.', { tono: 'error' }); }
  }
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <Rotulo>Descripción (la ve quien la recibe)</Rotulo>
        <AreaTexto rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Lecturas del seminario de los jueves…" />
      </label>
      <label className="flex flex-col gap-1.5">
        <Rotulo>Derechos de lo que hay dentro</Rotulo>
        <Selector value={derechos} onChange={(e) => setDerechos(e.target.value as Derechos)} aria-label="Derechos">
          {(Object.keys(DERECHOS) as Derechos[]).map((d) => <option key={d} value={d}>{DERECHOS[d].nombre}</option>)}
        </Selector>
      </label>
      <label className="flex flex-col gap-1.5">
        <Rotulo>Aclaración (opcional)</Rotulo>
        <Campo value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Con permiso de la editorial para el seminario" />
      </label>
      <p className="text-[0.8125rem] text-coffee-500">Los derechos viajan con la colección: aparecen en los enlaces, en las copias y en el LEEME del paquete. Con obras protegidas, compartir es siempre para uso privado.</p>
      <div><Boton variante="tinta" onClick={() => void guardar()}>Guardar</Boton></div>
    </div>
  );
}
