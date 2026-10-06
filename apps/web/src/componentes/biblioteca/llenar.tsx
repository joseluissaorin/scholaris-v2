/**
 * «Llenar biblioteca»: soltar una carpeta, muchos archivos, un zip, una lista
 * de enlaces, un BibTeX o RIS con la carpeta de Zotero, o un montón de .spdf.
 * Antes de empezar se ve qué hay, cuánto se tardará y cuánto cuesta (rápido o
 * económico) y qué ya estaba; luego, un solo lote con su vista de avance.
 */
import { useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Biblioteca, EstimacionLote, ModoIngesta } from '@scholaris/contrato';
import { AreaTexto, avisar, BarraAvance, Boton, Campo, cx, Dialogo, Icono, Rotulo, Selector } from '@scholaris/ui';
import { api } from '../../datos/api';
import { archivosDeSoltar, conducir, euros, prepararEntrada, registrarFuentes, tiempoAproximado, type Preparacion } from '../../datos/lotes';
import { numero } from '../../lib/numero';

const NOMBRES_TIPO: Record<string, [string, string]> = {
  pdf: ['PDF', 'PDF'], pdf_escaneado: ['escaneo', 'escaneos'], epub: ['EPUB', 'EPUB'], documento: ['texto', 'textos'], web: ['página web', 'páginas web'],
  audio: ['audio', 'audios'], video: ['vídeo', 'vídeos'], imagen: ['imagen', 'imágenes'], fotos: ['libro fotografiado', 'libros fotografiados'],
  presentacion: ['presentación', 'presentaciones'], hoja: ['hoja de cálculo', 'hojas de cálculo'], spdf: ['.spdf', '.spdf'],
};

export default function LlenarBiblioteca({ bibliotecas, inicial, alCerrar }: { bibliotecas: Biblioteca[]; inicial?: string; alCerrar: () => void }) {
  const navegar = useNavigate();
  const qc = useQueryClient();
  const propias = bibliotecas.filter((b) => b.permiso === 'propietario');
  const [destino, setDestino] = useState<string>(inicial ?? propias[0]?.id ?? '');
  const [nombreNueva, setNombreNueva] = useState('');
  const [archivos, setArchivos] = useState<File[]>([]);
  const [enlaces, setEnlaces] = useState('');
  const [prep, setPrep] = useState<Preparacion | null>(null);
  const [est, setEst] = useState<EstimacionLote | null>(null);
  const [modo, setModo] = useState<ModoIngesta>('economico');
  const [midiendo, setMidiendo] = useState<{ hechos: number; total: number; que: string } | null>(null);
  const [encima, setEncima] = useState(false);
  const [creando, setCreando] = useState(false);
  const selArchivos = useRef<HTMLInputElement>(null);
  const selCarpeta = useRef<HTMLInputElement>(null);

  async function analizar(nuevos: File[], textoEnlaces = enlaces) {
    const todos = [...archivos, ...nuevos];
    setArchivos(todos);
    const urls = textoEnlaces.split(/\s+/).filter(Boolean);
    if (!todos.length && !urls.length) { setPrep(null); setEst(null); return; }
    setMidiendo({ hechos: 0, total: todos.length, que: '' });
    try {
      const p = await prepararEntrada(todos, urls, (hechos, total, que) => setMidiendo({ hechos, total, que }));
      setPrep(p);
      if (!p.elementos.length) { setEst(null); return; }
      const e = await api().lotes.estimar({ elementos: p.elementos });
      setEst(e);
      setModo(e.recomendado);
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo preparar el lote.', { tono: 'error' });
    } finally { setMidiendo(null); }
  }

  async function empezar() {
    if (!prep || !est) return;
    setCreando(true);
    try {
      let biblioteca = destino || undefined;
      if (destino === '__nueva') {
        const b = await api().bibliotecas.crear({ nombre: nombreNueva.trim() || 'Biblioteca nueva', color: 'azul' });
        biblioteca = b.id;
        void qc.invalidateQueries({ queryKey: ['bibliotecas'] });
      }
      const nombreLote = prep.elementos.length === 1 ? prep.elementos[0]!.nombre : `${numero(prep.elementos.length)} documentos${biblioteca ? ` para «${bibliotecas.find((b) => b.id === biblioteca)?.nombre ?? nombreNueva}»` : ''}`;
      const l = await api().lotes.crear({ elementos: prep.elementos, modo, nombre: nombreLote, ...(biblioteca ? { biblioteca } : {}) });
      // Elemento n = posición + 1: el conductor de esta pestaña sube los archivos.
      registrarFuentes(l.id, new Map([...prep.fuentes].map(([i, f]) => [i + 1, f])));
      conducir(l.id, { modo, ...(biblioteca ? { biblioteca } : {}) });
      alCerrar();
      void navegar({ to: '/lotes/$id', params: { id: l.id } });
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo crear el lote.', { tono: 'error' });
    } finally { setCreando(false); }
  }

  const tipos = est ? Object.entries(est.porTipo).filter(([, n]) => n) : [];
  const cifras = est?.modos[modo];

  return (
    <Dialogo abierto alCambiar={(v) => !v && alCerrar()} ancho="g" titulo="Llenar biblioteca"
      descripcion="Suelta una carpeta, muchos archivos, un zip, un BibTeX o RIS con su carpeta de Zotero, .spdf o una lista de enlaces. Antes de empezar verás cuánto es, cuánto tardará y qué ya tenías."
      pie={<>
        <Boton variante="fantasma" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="tinta" icono="rayo" disabled={!est || !prep?.elementos.length || creando || (destino === '__nueva' && !nombreNueva.trim())} cargando={creando} onClick={() => void empezar()}>
          {est ? `Empezar con ${numero(est.elementos)} ${est.elementos === 1 ? 'elemento' : 'elementos'}` : 'Empezar'}
        </Boton>
      </>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-56 flex-1 flex-col gap-1.5">
            <Rotulo>Adónde va</Rotulo>
            <Selector value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="Colección de destino">
              {propias.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              <option value="__nueva">Una colección nueva…</option>
              <option value="">Sin colección</option>
            </Selector>
          </label>
          {destino === '__nueva' ? <Campo autoFocus placeholder="Nombre de la colección" value={nombreNueva} onChange={(e) => setNombreNueva(e.target.value)} aria-label="Nombre de la colección nueva" className="min-w-56 flex-1" /> : null}
        </div>

        {/* La zona de soltar: hundida, con borde discontinuo */}
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setEncima(true); }}
          onDragLeave={() => setEncima(false)}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setEncima(false); void archivosDeSoltar(e.dataTransfer).then((fs) => analizar(fs)); }}
          className={cx('flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-7 text-center shadow-[var(--hundido)] transition-colors', encima ? 'border-rojo bg-cream-100' : 'border-cream-500 bg-cream-200/50')}
        >
          <Icono nombre="pila" tam={28} className="text-coffee-400" />
          <p className="text-[0.9375rem] text-coffee-700">Suelta aquí carpetas, archivos o un zip</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Boton variante="linea" tam="p" icono="subir" onClick={() => selArchivos.current?.click()}>Elegir archivos</Boton>
            <Boton variante="linea" tam="p" icono="pila" onClick={() => selCarpeta.current?.click()}>Elegir una carpeta</Boton>
          </div>
          <input ref={selArchivos} type="file" multiple hidden onChange={(e) => { void analizar([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <input ref={selCarpeta} type="file" multiple hidden {...({ webkitdirectory: '' } as object)} onChange={(e) => { void analizar([...(e.target.files ?? [])]); e.target.value = ''; }} />
        </div>

        <label className="flex flex-col gap-1.5">
          <Rotulo>Enlaces, uno por línea (páginas, PDF, YouTube, pódcast)</Rotulo>
          <AreaTexto rows={3} value={enlaces} onChange={(e) => setEnlaces(e.target.value)} onBlur={() => void analizar([], enlaces)} placeholder="https://…" aria-label="Enlaces" />
        </label>

        {midiendo ? (
          <div className="rounded-xl bg-cream-100 p-4">
            <p className="mb-2 text-[0.8125rem] text-coffee-600">Midiendo {numero(midiendo.hechos)} de {numero(midiendo.total)}{midiendo.que ? ` · ${midiendo.que}` : ''}</p>
            <BarraAvance valor={midiendo.total ? midiendo.hechos / midiendo.total : undefined} etiqueta="Midiendo los archivos" tono="azul" />
          </div>
        ) : null}

        {est && prep && !midiendo ? (
          <div className="grid gap-4 rounded-2xl border border-cream-300 bg-cream-50 p-4 shadow-[var(--levantado)] sm:grid-cols-[1.1fr_1fr]">
            <div className="space-y-2">
              <Rotulo>Qué hay</Rotulo>
              <p className="text-[1.125rem] font-semibold text-coffee-800">
                {numero(est.elementos)} {est.elementos === 1 ? 'elemento' : 'elementos'}
                {est.paginas ? <span className="font-normal text-coffee-600"> · {numero(est.paginas)} páginas</span> : null}
                {est.minutos ? <span className="font-normal text-coffee-600"> · {numero(Math.round(est.minutos))} min de audio y vídeo</span> : null}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {tipos.map(([t, n]) => <span key={t} className="rounded-full bg-cream-200 px-2.5 py-0.5 text-[0.75rem] text-coffee-700">{numero(n!)} {(NOMBRES_TIPO[t] ?? [t, t])[n === 1 ? 0 : 1]}</span>)}
              </div>
              {est.duplicados.length ? (
                <details className="text-[0.8125rem] text-coffee-600">
                  <summary className="cursor-pointer"><strong className="text-coffee-800">{numero(est.duplicados.length)}</strong> ya {est.duplicados.length === 1 ? 'estaba' : 'estaban'} en tu Scholaris: no se vuelve{est.duplicados.length === 1 ? '' : 'n'} a leer</summary>
                  <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-auto pl-4">
                    {est.duplicados.map((d) => <li key={d.indice} className="truncate">— {prep.elementos[d.indice]?.nombre} <span className="text-coffee-400">({d.titulo})</span></li>)}
                  </ul>
                </details>
              ) : null}
              {prep.descartados.length ? <p className="text-[0.8125rem] text-ocre">{prep.descartados.map((d) => `${d.nombre}: ${d.motivo}`).join(' ')}</p> : null}
              {prep.sinAdjunto ? <p className="text-[0.8125rem] text-coffee-500">{numero(prep.sinAdjunto)} {prep.sinAdjunto === 1 ? 'referencia no trae' : 'referencias no traen'} ni archivo ni enlace: se quedan fuera.</p> : null}
              {est.avisos.map((a) => <p key={a} className="text-[0.75rem] text-coffee-400">{a}</p>)}
            </div>
            <div className="space-y-2">
              <Rotulo>Cómo leerlo</Rotulo>
              <div role="radiogroup" aria-label="Modo de lectura" className="grid grid-cols-2 gap-2">
                {(['rapido', 'economico'] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={modo === m} onClick={() => setModo(m)}
                    className={cx('rounded-xl border px-3 py-2.5 text-left transition-colors', modo === m ? 'border-coffee-700 bg-cream-50 shadow-[var(--relieve)]' : 'border-cream-400 bg-cream-200/60 text-coffee-600 hover:bg-cream-100')}>
                    <span className="block text-[0.875rem] font-semibold text-coffee-800">{m === 'rapido' ? 'Rápido' : 'Económico'}</span>
                    <span className="block text-[0.75rem]">{tiempoAproximado(est.modos[m].segundos)}</span>
                    <span className="tnum block text-[0.75rem]">{euros(est.modos[m].euros)}</span>
                  </button>
                ))}
              </div>
              <p className="text-[0.75rem] text-coffee-500">
                {modo === 'economico'
                  ? 'Por lotes, a mitad de precio: lo que ya tiene texto se puede buscar enseguida y lo demás llega en unas horas.'
                  : 'Todo en línea, cuanto antes.'}
                {cifras ? ` Cifras aproximadas: ${numero(est.nuevos)} por leer.` : null}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </Dialogo>
  );
}
