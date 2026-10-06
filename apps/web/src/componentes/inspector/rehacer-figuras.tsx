/**
 * «Volver a buscar figuras»: primero se simula (cuántas páginas, cuántas
 * llamadas, cuánto costaría), se elige si mirar todas las páginas o solo las
 * candidatas, y se lanza. En los libros, después, el navegador recorta cada
 * figura de su página y la manda a vectorizar (el servidor no puede recortar).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DetalleDocumento, FigurasRehechas, FiguraVista } from '@scholaris/contrato';
import { avisar, Boton, cx, Dialogo } from '@scholaris/ui';
import { api } from '../../datos/api';
import { numero } from '../../lib/numero';

const dolares = (x: number) => (x < 0.01 ? 'menos de 1 céntimo de dólar' : `unos ${numero(x, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`);
const llamadas = (n: number) => `${numero(n)} ${n === 1 ? 'llamada' : 'llamadas'}`;

/** Recorta una región de una imagen en un canvas y la devuelve en JPEG (base64 sin cabecera). */
async function recortar(url: string, r: NonNullable<FiguraVista['region']>): Promise<string | null> {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    const w = Math.max(1, Math.round(r.w * img.naturalWidth)), h = Math.max(1, Math.round(r.h * img.naturalHeight));
    const escala = Math.min(1, 1024 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * escala); c.height = Math.round(h * escala);
    c.getContext('2d')!.drawImage(img, r.x * img.naturalWidth, r.y * img.naturalHeight, w, h, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88).split(',')[1] ?? null;
  } catch { return null; }
}

export function RehacerFiguras({ doc }: { doc: DetalleDocumento }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [sim, setSim] = useState<FigurasRehechas | null>(null);
  const [modo, setModo] = useState<'todas' | 'candidatas'>('todas');
  const [fase, setFase] = useState<'simulando' | 'listo' | 'trabajando' | 'vectores' | 'hecho'>('simulando');
  const [hecho, setHecho] = useState<(FigurasRehechas & { recortes?: number }) | null>(null);

  async function abrir() {
    setAbierto(true); setFase('simulando'); setSim(null); setHecho(null);
    try {
      const s = await api().documentos.rehacerFiguras(doc.id, { simular: true });
      setSim(s);
      setModo(s.clase === 'paginas' && s.paginas.todas > 120 && s.paginas.candidatas < s.paginas.todas ? 'candidatas' : 'todas');
      setFase('listo');
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo calcular.', { tono: 'error' }); setAbierto(false); }
  }

  async function lanzar() {
    setFase('trabajando');
    try {
      const r: FigurasRehechas & { recortes?: number } = await api().documentos.rehacerFiguras(doc.id, { paginas: modo });
      // Libros: los recortes de las figuras, vectorizados desde aquí.
      if (r.clase === 'paginas' && r.figuras.sinVector > 0) {
        setFase('vectores');
        const figuras = (await api().documentos.figuras(doc.id)).filter((f) => f.region && f.imagenUrl);
        let n = 0;
        for (let i = 0; i < figuras.length; i += 8) {
          const lote = (await Promise.all(figuras.slice(i, i + 8).map(async (f) => ({ id: f.id, mime: 'image/jpeg', base64: await recortar(f.imagenUrl, f.region!) }))))
            .filter((x): x is { id: string; mime: string; base64: string } => !!x.base64);
          if (lote.length) n += (await api().documentos.vectoresFiguras(doc.id, lote)).vectores;
        }
        r.recortes = n;
      }
      setHecho(r);
      setFase('hecho');
      void qc.invalidateQueries({ queryKey: ['figuras', doc.id] });
      void qc.invalidateQueries({ queryKey: ['inspector', doc.id] });
      void qc.invalidateQueries({ queryKey: ['documento', doc.id] });
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudieron rehacer las figuras.', { tono: 'error' }); setFase('listo'); }
  }

  const est = sim ? (modo === 'todas' ? sim.estimacion.todas : sim.estimacion.candidatas) : null;
  const video = sim?.clase === 'fotogramas';

  return (
    <>
      <Boton variante="linea" tam="p" icono="rayo" onClick={() => void abrir()}>Volver a buscar figuras</Boton>
      <Dialogo abierto={abierto} alCambiar={(v) => { if (fase !== 'trabajando' && fase !== 'vectores') setAbierto(v); }} ancho="g"
        titulo={video ? 'Volver a mirar los fotogramas' : 'Volver a buscar figuras'}
        descripcion={video
          ? 'Se describen los fotogramas que no tienen descripción, se calculan los vectores que falten y se marcan los cambios de escena. El texto no se vuelve a leer.'
          : 'Se mira cada página guardada para encontrar sus figuras, con su región, su pie y lo que se ve. Las figuras que ya estaban conservan su identificador. El texto no se vuelve a leer.'}
        pie={fase === 'hecho' ? <Boton variante="tinta" onClick={() => setAbierto(false)}>Cerrar</Boton> : (
          <>
            <Boton variante="fantasma" disabled={fase === 'trabajando' || fase === 'vectores'} onClick={() => setAbierto(false)}>Cancelar</Boton>
            <Boton variante="rojo" disabled={fase !== 'listo' || !sim || sim.clase === 'ninguna'} onClick={() => void lanzar()}>
              {fase === 'trabajando' ? 'Buscando…' : fase === 'vectores' ? 'Vectorizando los recortes…' : 'Buscar ahora'}
            </Boton>
          </>
        )}>
        {fase === 'simulando' || !sim ? <p className="text-[0.875rem] text-apagado">Calculando cuánto supone…</p>
          : fase === 'hecho' && hecho ? (
            <div className="flex flex-col gap-2 text-[0.875rem] text-coffee-700">
              <p className="font-semibold text-coffee-800">Hecho en {numero(Math.round(hecho.ms / 1000))} s · {llamadas(hecho.llamadas.total)} · {dolares(hecho.costeUsd)}</p>
              {hecho.clase === 'paginas' ? (
                <p>{numero(hecho.paginas.examinadas)} páginas miradas. Antes había {numero(hecho.figuras.antes)} figuras; ahora hay {numero(hecho.figuras.despues)} ({numero(hecho.figuras.conservadas)} conservadas, {numero(hecho.figuras.nuevas)} nuevas, {numero(hecho.figuras.borradas)} quitadas), {numero(hecho.figuras.conRegion)} con su región en la página.{hecho.recortes ? ` ${numero(hecho.recortes)} recortes vectorizados para «Buscar parecidas».` : ''}</p>
              ) : (
                <p>{numero(hecho.figuras.descritas)} fotogramas descritos, {numero(hecho.figuras.conVector)} con vector y {numero(hecho.escenas ?? 0)} marcados como cambio de escena.</p>
              )}
              {hecho.avisos.filter((a) => !/vector propio/.test(a) || !hecho.recortes).map((a) => <p key={a} className="text-[0.8125rem] text-apagado">{a}</p>)}
            </div>
          ) : sim.clase === 'ninguna' ? <p className="text-[0.875rem] text-apagado">{sim.avisos[0] ?? 'No hay dónde buscar figuras en este documento.'}</p>
          : video ? (
            <p className="text-[0.875rem] text-coffee-700">{numero(sim.figuras.antes)} fotogramas: {numero(sim.figuras.antes - sim.figuras.descritas)} sin descripción y {numero(sim.figuras.antes - sim.figuras.conVector)} sin vector. Supone {llamadas(sim.llamadas.total)}, {dolares(sim.costeUsd)}.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {(['todas', 'candidatas'] as const).map((m) => (
                <label key={m} className={cx('flex cursor-pointer items-start gap-3 rounded-xl border p-3', modo === m ? 'border-coffee-600 bg-cream-50 shadow-[var(--relieve)]' : 'border-cream-400 bg-cream-100/60')}>
                  <input type="radio" name="modo" className="mt-1 accent-[var(--s-rojo)]" checked={modo === m} onChange={() => setModo(m)} />
                  <span className="text-[0.875rem] text-coffee-700">
                    <span className="block font-semibold text-coffee-800">{m === 'todas' ? `Todas las páginas (${numero(sim.paginas.todas)})` : `Solo las candidatas (${numero(sim.paginas.candidatas)})`}</span>
                    {m === 'candidatas' ? 'Las que tienen un pie de figura en el texto, figuras ya conocidas o poco texto (láminas, diagramas). ' : 'Lo más fiable: no se escapa ninguna. '}
                    {llamadas(sim.estimacion[m].llamadas)} al modelo de visión, {dolares(sim.estimacion[m].usd)}.
                  </span>
                </label>
              ))}
              {est ? <p className="text-[0.75rem] text-apagado">El coste es una estimación con los precios públicos de Gemini; se cobra de tus claves o de las de la instancia, no de las páginas de tu plan.</p> : null}
            </div>
          )}
      </Dialogo>
    </>
  );
}
