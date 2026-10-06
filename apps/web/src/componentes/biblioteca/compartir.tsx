/**
 * Compartir una colección: quién la ve, quién la edita, e invitar por correo.
 * Para seminarios y grupos de investigación.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Biblioteca, Miembro } from '@scholaris/contrato';
import { avisar, Boton, Campo, Dialogo, Rotulo, Selector } from '@scholaris/ui';
import { api } from '../../datos/api';

const PERMISO: Record<Miembro['permiso'], string> = { propietario: 'Propietario', administrador: 'Administra', edicion: 'Puede editar', lectura: 'Puede leer' };

export default function Compartir({ biblioteca, alCerrar }: { biblioteca: Biblioteca; alCerrar: () => void }) {
  const qc = useQueryClient();
  const { data: miembros, isPending } = useQuery({ queryKey: ['miembros', biblioteca.id], queryFn: () => api().bibliotecas.miembros(biblioteca.id) });
  const [correo, setCorreo] = useState('');
  const [permiso, setPermiso] = useState<'lectura' | 'edicion'>('lectura');
  const valido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim());

  async function invitar() {
    try {
      await api().bibliotecas.compartir(biblioteca.id, { correo: correo.trim(), permiso });
      setCorreo('');
      void qc.invalidateQueries({ queryKey: ['miembros', biblioteca.id] });
      void qc.invalidateQueries({ queryKey: ['bibliotecas'] });
      avisar('Invitación enviada.', { tono: 'exito' });
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo invitar.', { tono: 'error' }); }
  }
  async function quitar(m: Miembro) {
    if (!m.usuario) return;
    try { await api().bibliotecas.dejarDeCompartir(biblioteca.id, m.usuario); void qc.invalidateQueries({ queryKey: ['miembros', biblioteca.id] }); avisar(`${m.correo} ya no tiene acceso.`); }
    catch { avisar('No se pudo quitar.', { tono: 'error' }); }
  }

  return (
    <Dialogo abierto alCambiar={(v) => !v && alCerrar()} titulo={`Compartir «${biblioteca.nombre}»`} descripcion="Quien entre verá los documentos de la colección y podrá buscar y citar en ellos." ancho="g"
      pie={<Boton variante="tinta" onClick={alCerrar}>Hecho</Boton>}>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (valido) void invitar(); }}>
        <Campo autoFocus type="email" placeholder="correo@universidad.es" value={correo} onChange={(e) => setCorreo(e.target.value)} aria-label="Correo de la persona" className="min-w-56 flex-1" />
        <Selector value={permiso} onChange={(e) => setPermiso(e.target.value as 'lectura' | 'edicion')} aria-label="Permiso" className="w-40">
          <option value="lectura">Puede leer</option>
          <option value="edicion">Puede editar</option>
        </Selector>
        <Boton type="submit" variante="tinta" disabled={!valido}>Invitar</Boton>
      </form>
      <ul className="mt-5 border-t border-filete">
        {isPending ? <li className="py-3 text-apagado">Cargando…</li> : miembros?.map((m) => (
          <li key={m.correo} className="flex items-center gap-3 border-b border-filete py-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-hondo text-[0.875rem]">{m.correo.charAt(0)}</span>
            <div className="min-w-0 flex-1"><p className="truncate">{m.correo}</p>{m.pendiente ? <Rotulo>invitación pendiente</Rotulo> : null}</div>
            <span className="text-[0.875rem] text-tinta-2">{PERMISO[m.permiso]}</span>
            {m.permiso !== 'propietario' && m.usuario ? <Boton variante="fantasma" tam="p" onClick={() => void quitar(m)}>Quitar</Boton> : null}
          </li>
        ))}
      </ul>
    </Dialogo>
  );
}
