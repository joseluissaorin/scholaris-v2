/**
 * Paquetes .scholaris: una colección entera en un fichero. Exportar (con o sin
 * originales y vectores, para que pese poco) e importar (sin volver a leer
 * nada: solo se calculan los vectores que falten).
 */
import { useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { DERECHOS, EXTENSION_PAQUETE, importarPaquete, leerManifiesto, type Biblioteca, type ManifiestoPaquete } from '@scholaris/contrato';
import { avisar, BarraAvance, Boton, Campo, Dialogo, Icono, Interruptor, Rotulo } from '@scholaris/ui';
import { api } from '../../datos/api';
import { recuperarTareas } from '../../datos/ingesta';
import { numero } from '../../lib/numero';
import { bytes } from '../../lib/formato';

export function ExportarPaquete({ biblioteca, alCerrar }: { biblioteca: Biblioteca; alCerrar: () => void }) {
  const [originales, setOriginales] = useState(true);
  const [vectores, setVectores] = useState(true);
  const [bajando, setBajando] = useState<number | null>(null);
  const abierto = DERECHOS[biblioteca.derechos ?? 'sin_indicar']?.abierto ?? false;

  async function exportar() {
    setBajando(0);
    try {
      const r = await api().bibliotecas.paquete(biblioteca.id, { originales, vectores });
      const nombre = `${biblioteca.nombre.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'biblioteca'}${EXTENSION_PAQUETE}`;
      // Con el selector de ficheros del navegador, en flujo al disco; si no, en memoria y descarga.
      const guardar = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }> }).showSaveFilePicker;
      let recibidos = 0;
      const contador = new TransformStream<Uint8Array, Uint8Array>({ transform(t, c) { recibidos += t.length; setBajando(recibidos); c.enqueue(t); } });
      const flujo = r.body!.pipeThrough(contador);
      if (guardar) {
        const h = await guardar({ suggestedName: nombre, types: [{ description: 'Paquete de Scholaris', accept: { 'application/x-scholaris': [EXTENSION_PAQUETE] } }] });
        await flujo.pipeTo(await h.createWritable());
      } else {
        const blob = await new Response(flujo).blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = nombre;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      }
      avisar(`«${biblioteca.nombre}» exportada (${bytes(recibidos)}).`, { tono: 'exito' });
      alCerrar();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') avisar(e instanceof Error ? e.message : 'No se pudo exportar.', { tono: 'error' });
    } finally { setBajando(null); }
  }

  return (
    <Dialogo abierto alCambiar={(v) => !v && alCerrar()} titulo={`Exportar «${biblioteca.nombre}»`}
      descripcion="Un solo fichero .scholaris con la colección: sus documentos en SPDF, la descripción y los derechos. Se abre en cualquier Scholaris (en la nube, en casa o con el SDK de Python)."
      pie={<><Boton variante="fantasma" onClick={alCerrar}>Cancelar</Boton><Boton variante="tinta" icono="descargar" cargando={bajando !== null} disabled={bajando !== null} onClick={() => void exportar()}>Exportar paquete</Boton></>}>
      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-4 rounded-xl bg-cream-100 px-4 py-3">
          <span><span className="block text-[0.875rem] text-coffee-800">Con los originales</span><span className="block text-[0.75rem] text-coffee-500">PDF, audio y vídeo. Sin ellos pesa mucho menos; el texto, las páginas y las citas se quedan.</span></span>
          <Interruptor activo={originales} alCambiar={setOriginales} etiqueta="Con los originales" />
        </label>
        <label className="flex items-center justify-between gap-4 rounded-xl bg-cream-100 px-4 py-3">
          <span><span className="block text-[0.875rem] text-coffee-800">Con los vectores</span><span className="block text-[0.75rem] text-coffee-500">Sin ellos, quien lo importe los recalcula (cuesta poco: no se vuelve a leer).</span></span>
          <Interruptor activo={vectores} alCambiar={setVectores} etiqueta="Con los vectores" />
        </label>
        {!abierto ? <p className="flex gap-2 text-[0.8125rem] text-coffee-600"><Icono nombre="aviso" tam={16} className="mt-0.5 shrink-0 text-ocre" />Derechos: {DERECHOS[biblioteca.derechos ?? 'sin_indicar'].nombre.toLowerCase()}. El paquete lo dirá en su LEEME: es para uso privado de quien lo reciba.</p> : null}
        {bajando !== null ? <div><p className="mb-1.5 text-[0.8125rem] text-coffee-500">Empaquetando… {bytes(bajando)}</p><BarraAvance etiqueta="Exportando" tono="azul" /></div> : null}
      </div>
    </Dialogo>
  );
}

export function ImportarPaquete({ alCerrar }: { alCerrar: () => void }) {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const sel = useRef<HTMLInputElement>(null);
  const [fichero, setFichero] = useState<File | null>(null);
  const [m, setM] = useState<ManifiestoPaquete | null>(null);
  const [nombre, setNombre] = useState('');
  const [avance, setAvance] = useState<{ hechos: number; total: number; titulo: string } | null>(null);

  async function elegir(f: File) {
    try {
      const { manifiesto } = await leerManifiesto(f);
      setFichero(f); setM(manifiesto); setNombre(manifiesto.biblioteca.nombre);
    } catch (e) { avisar(e instanceof Error ? e.message : 'No es un paquete válido.', { tono: 'error' }); }
  }

  async function importar() {
    if (!fichero || !m) return;
    setAvance({ hechos: 0, total: m.documentos.length, titulo: '' });
    try {
      const r = await importarPaquete(api(), fichero, { nombre: nombre.trim() || m.biblioteca.nombre, alAvance: (hechos, total, titulo) => setAvance({ hechos, total, titulo }) });
      void qc.invalidateQueries({ queryKey: ['bibliotecas'] });
      void qc.invalidateQueries({ queryKey: ['documentos'] });
      void recuperarTareas(true);
      const partes = [`${numero(r.importados.length)} importados`, r.repetidos.length ? `${numero(r.repetidos.length)} ya estaban` : '', r.fallidos.length ? `${numero(r.fallidos.length)} con error` : ''].filter(Boolean);
      avisar(`Paquete importado: ${partes.join(', ')}.`, { tono: r.fallidos.length ? 'error' : 'exito' });
      alCerrar();
      void navegar({ to: '/', search: { col: r.biblioteca } });
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo importar.', { tono: 'error' }); setAvance(null); }
  }

  return (
    <Dialogo abierto alCambiar={(v) => !v && !avance && alCerrar()} titulo="Importar un paquete"
      descripcion="Abre un fichero .scholaris: la colección entra en tu Scholaris sin volver a leer nada. Lo que ya tenías no se duplica."
      pie={<><Boton variante="fantasma" disabled={!!avance} onClick={alCerrar}>Cancelar</Boton><Boton variante="tinta" icono="subir" disabled={!m || !!avance} cargando={!!avance} onClick={() => void importar()}>Importar</Boton></>}>
      {!m ? (
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) void elegir(f); }}
          className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-cream-500 bg-cream-200/50 px-6 py-8 text-center shadow-[var(--hundido)]">
          <Icono nombre="pila" tam={28} className="text-coffee-400" />
          <p className="text-[0.9375rem] text-coffee-700">Suelta aquí el paquete</p>
          <Boton variante="linea" tam="p" onClick={() => sel.current?.click()}>Elegir el fichero</Boton>
          <input ref={sel} type="file" accept={`${EXTENSION_PAQUETE},application/zip`} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void elegir(f); e.target.value = ''; }} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-cream-100 p-4">
            <p className="text-[1.0625rem] font-semibold text-coffee-800">{m.biblioteca.nombre}</p>
            {m.biblioteca.descripcion ? <p className="mt-1 text-[0.875rem] text-coffee-600">{m.biblioteca.descripcion}</p> : null}
            <p className="mt-2 text-[0.8125rem] text-coffee-500">{numero(m.documentos.length)} documentos · {bytes(fichero?.size ?? 0)} · {DERECHOS[m.biblioteca.derechos]?.nombre ?? 'Derechos sin indicar'}{m.opciones.originales ? '' : ' · sin originales'}{m.opciones.vectores ? '' : ' · sin vectores (se calcularán)'}</p>
            {m.biblioteca.notaDerechos ? <p className="mt-1 text-[0.8125rem] text-coffee-500">{m.biblioteca.notaDerechos}</p> : null}
          </div>
          <label className="flex flex-col gap-1.5"><Rotulo>Nombre de la colección</Rotulo><Campo value={nombre} onChange={(e) => setNombre(e.target.value)} aria-label="Nombre de la colección" /></label>
          {avance ? <div><p className="mb-1.5 text-[0.8125rem] text-coffee-500">{numero(avance.hechos)} de {numero(avance.total)}{avance.titulo ? ` · ${avance.titulo}` : ''}</p><BarraAvance valor={avance.total ? avance.hechos / avance.total : 0} etiqueta="Importando" /></div> : null}
        </div>
      )}
    </Dialogo>
  );
}
