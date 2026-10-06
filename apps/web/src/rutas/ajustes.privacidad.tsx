import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { avisar, Boton, Campo, Dialogo, Filete, Interruptor } from '@scholaris/ui';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { numero } from '../lib/numero';

export const Route = createFileRoute('/ajustes/privacidad')({
  loader: ({ context }) => context.consultas.ensureQueryData(q.grabacion()),
  component: Privacidad,
});

function Fila({ titulo, children, accion }: { titulo: string; children: React.ReactNode; accion: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-filete py-5 sm:flex-row sm:items-center sm:gap-8">
      <div className="min-w-0 flex-1"><h3 className="text-[1.125rem]">{titulo}</h3><p className="mt-1 text-[0.9375rem] text-tinta-2">{children}</p></div>
      <div className="shrink-0">{accion}</div>
    </div>
  );
}

function Privacidad() {
  const qc = useQueryClient();
  const { data: grabacion } = useQuery(q.grabacion());
  const [exportando, setExportando] = useState(false);
  const [dialogo, setDialogo] = useState<'historial' | 'todo' | null>(null);
  const [confirmacion, setConfirmacion] = useState('');

  async function grabar(v: boolean) {
    qc.setQueryData(['grabacion'], { activa: v });
    try { qc.setQueryData(['grabacion'], await api().privacidad.cambiarGrabacion(v)); avisar(v ? 'El historial vuelve a guardarse.' : 'Historial en pausa: lo que busques no se guardará.'); }
    catch { avisar('No se pudo cambiar.', { tono: 'error' }); }
  }
  async function exportar() {
    setExportando(true);
    try {
      const b = await api().privacidad.exportar();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = `scholaris-mis-datos-${new Date().toISOString().slice(0, 10)}.${b.type.includes('zip') ? 'zip' : 'json'}`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch { avisar('No se pudo exportar.', { tono: 'error' }); }
    setExportando(false);
  }
  async function borrar() {
    const que = dialogo; setDialogo(null); setConfirmacion('');
    try {
      const r = que === 'todo' ? await api().privacidad.purgar() : await api().privacidad.borrarHistorial();
      const n = Object.values(r.borrados).reduce((a, b) => a + b, 0);
      avisar(`Borrados ${numero(n)} elementos.`);
      await qc.invalidateQueries();
    } catch { avisar('No se pudo borrar.', { tono: 'error' }); }
  }

  return (
    <Lienzo ancho="estrecho">
      <p className="max-w-2xl text-[1.0625rem] text-tinta-2">Tus documentos son tuyos. No entrenamos modelos con ellos y los proveedores que leen tus páginas lo hacen sin retenerlas. Si trabajas con material sensible, la versión local procesa todo en tu ordenador.</p>
      <div className="mt-6 border-t border-tinta">
        <Fila titulo="Guardar el historial de búsquedas" accion={<Interruptor activo={!!grabacion?.activa} alCambiar={(v) => void grabar(v)} etiqueta="Guardar el historial" />}>
          Sirve para repetir búsquedas, fijarlas y para que las perspectivas sepan qué te falta. Puedes pausarlo cuando quieras.
        </Fila>
        <Fila titulo="Descargar todos mis datos" accion={<Boton variante="linea" icono="descargar" cargando={exportando} onClick={() => void exportar()}>Descargar</Boton>}>
          Un archivo con tus documentos en SPDF, tu historial, tus cuadernos y tus ajustes. Los SPDF se abren sin Scholaris.
        </Fila>
      </div>
      <Filete className="mt-12">Zona de borrado</Filete>
      <div className="mt-2">
        <Fila titulo="Borrar el historial" accion={<Boton variante="linea" onClick={() => setDialogo('historial')}>Borrar historial…</Boton>}>Todas las búsquedas y preguntas guardadas.</Fila>
        <Fila titulo="Borrar todo" accion={<Boton variante="rojo" onClick={() => setDialogo('todo')}>Borrar todo…</Boton>}>Documentos, historial, cuadernos, vigilantes. La cuenta sigue abierta.</Fila>
      </div>
      <Dialogo abierto={!!dialogo} alCambiar={(v) => !v && setDialogo(null)} titulo={dialogo === 'todo' ? '¿Borrar todo?' : '¿Borrar el historial?'}
        descripcion={dialogo === 'todo' ? 'No se puede deshacer. Escribe BORRAR para confirmarlo.' : 'No se puede deshacer.'}
        pie={<><Boton variante="fantasma" onClick={() => setDialogo(null)}>Cancelar</Boton><Boton variante="rojo" disabled={dialogo === 'todo' && confirmacion !== 'BORRAR'} onClick={() => void borrar()}>Borrar</Boton></>}>
        {dialogo === 'todo' ? <Campo autoFocus value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} aria-label="Escribe BORRAR" /> : null}
      </Dialogo>
    </Lienzo>
  );
}
