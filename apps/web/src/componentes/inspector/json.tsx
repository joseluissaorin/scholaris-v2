/**
 * «Ver JSON» para quien quiera ver los datos tal cual: el documento, el resumen
 * del contenido y el volcado completo (con los vectores recortados: son miles
 * de números que no se leen).
 */
import { useState } from 'react';
import { Dialog } from 'radix-ui';
import type { ContenidoDocumento, DetalleDocumento } from '@scholaris/contrato';
import { avisar, Boton, cx, Icono } from '@scholaris/ui';
import { api } from '../../datos/api';
import { bytes } from '../../lib/formato';

type Pestana = 'documento' | 'contenido' | 'volcado';

export function VerJson({ abierto, alCambiar, doc, contenido }: { abierto: boolean; alCambiar: (v: boolean) => void; doc: DetalleDocumento; contenido?: ContenidoDocumento }) {
  const [pestana, setPestana] = useState<Pestana>('documento');
  const [volcado, setVolcado] = useState<{ texto: string; bytes: number } | null>(null);
  const [cargando, setCargando] = useState(false);

  async function cargarVolcado() {
    setPestana('volcado');
    if (volcado || cargando) return;
    setCargando(true);
    try {
      const v = await api().documentos.volcado(doc.id);
      const ligero = { ...v, vectores: v.vectores.map((x) => ({ ...x, base64: `${x.base64.slice(0, 24)}… (${Math.round((x.base64.length * 3) / 4)} bytes)` })) };
      const texto = JSON.stringify(ligero, null, 2);
      setVolcado({ texto, bytes: JSON.stringify(v).length });
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo leer el volcado.', { tono: 'error' });
      setPestana('documento');
    } finally { setCargando(false); }
  }

  const texto = pestana === 'documento' ? JSON.stringify(doc, null, 2) : pestana === 'contenido' ? JSON.stringify(contenido ?? null, null, 2) : volcado?.texto ?? '';
  const descargar = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
    a.download = `${doc.id}-${pestana}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return (
    <Dialog.Root open={abierto} onOpenChange={alCambiar}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgb(26_15_10/0.55)] backdrop-blur-sm anim-aparece" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-3 z-50 flex flex-col overflow-hidden rounded-2xl border border-cream-400 bg-cream-50 shadow-[var(--levantado-alto)] anim-dialogo focus:outline-none sm:inset-x-[max(1rem,calc(50vw-36rem))] sm:inset-y-10">
          <div className="flex flex-wrap items-center gap-3 border-b border-cream-300 px-5 py-3">
            <Dialog.Title className="text-[1rem] font-semibold text-coffee-800">Los datos en JSON</Dialog.Title>
            <div role="tablist" className="flex gap-1 rounded-xl border border-cream-400 bg-cream-200/70 p-1 shadow-[var(--hundido)]">
              {([['documento', 'Documento'], ['contenido', 'Resumen del contenido'], ['volcado', 'Volcado completo']] as Array<[Pestana, string]>).map(([p, n]) => (
                <button key={p} type="button" role="tab" aria-selected={pestana === p} onClick={() => (p === 'volcado' ? void cargarVolcado() : setPestana(p))}
                  className={cx('h-8 rounded-lg px-3 text-[0.8125rem] font-medium', pestana === p ? 'bg-cream-50 text-coffee-800 shadow-[var(--relieve)]' : 'text-coffee-600 hover:text-coffee-800')}>{n}</button>
              ))}
            </div>
            <div className="ml-auto flex gap-2">
              <Boton variante="linea" tam="p" icono="copiar" disabled={!texto} onClick={() => { void navigator.clipboard.writeText(texto).then(() => avisar('JSON copiado.', { tono: 'exito' })); }}>Copiar</Boton>
              <Boton variante="linea" tam="p" icono="descargar" disabled={!texto} onClick={descargar}>Descargar</Boton>
              <Dialog.Close className="grid h-9 w-9 place-items-center rounded-lg text-coffee-400 hover:bg-cream-200 hover:text-coffee-800" aria-label="Cerrar"><Icono nombre="cerrar" tam={16} /></Dialog.Close>
            </div>
          </div>
          {pestana === 'volcado' ? <p className="border-b border-cream-300 bg-cream-100 px-5 py-2 text-[0.75rem] text-coffee-600">{cargando ? 'Leyendo el volcado…' : volcado ? `Todo lo que va en el .spdf (${bytes(volcado.bytes)} en JSON). Los vectores van recortados y los binarios, como enlaces firmados.` : ''}</p> : null}
          <pre className="min-h-0 flex-1 overflow-auto bg-coffee-900 p-4 font-mono text-[0.75rem] leading-relaxed text-cream-100">{texto || (cargando ? '…' : '')}</pre>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Descarga el .spdf del documento (lo arma el servidor). */
export async function descargarSpdf(doc: Pick<DetalleDocumento, 'id' | 'metadatos'>) {
  avisar(`Preparando «${doc.metadatos.titulo}.spdf»…`);
  try {
    const datos = await api().documentos.spdf(doc.id);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([datos as BlobPart], { type: 'application/x-spdf' }));
    a.download = `${doc.metadatos.titulo.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'documento'}.spdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo exportar.', { tono: 'error' }); }
}
