import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Biblioteca, Pagina, ResumenDocumento } from '@scholaris/contrato';
import { avisar, conDeshacer, cx, Icono, MenuContenido, MenuDisparador, MenuElemento, MenuRaiz, MenuRotulo, MenuSeparador, Rotulo } from '@scholaris/ui';
import { api } from '../../datos/api';
import { duracion, haceCuanto, ICONO_TIPO, NOMBRE_TIPO, nombreUnidad, esMedio } from '../../lib/formato';
import { preferencia } from '../../lib/acciones';
import { Portada } from '../comunes/portada';

const COLOR_COL: Record<string, string> = { rojo: 'bg-rojo', azul: 'bg-azul', amarillo: 'bg-amarillo', tinta: 'bg-tinta' };
export const puntoColeccion = (c?: string) => COLOR_COL[c ?? 'tinta'] ?? 'bg-tinta';

/** Acciones de un documento: las mismas en la rejilla, en la lista y en el lector. */
export function MenuDocumento({ doc, bibliotecas, children }: { doc: ResumenDocumento; bibliotecas: Biblioteca[]; children: React.ReactNode }) {
  const qc = useQueryClient();

  async function copiarCita() {
    try {
      const estilo = preferencia('estilo', 'apa');
      const c = await api().documentos.cita(doc.id, { estilo });
      await navigator.clipboard.writeText(c.texto);
      avisar('Referencia copiada.', { tono: 'exito' });
    } catch { avisar('No se pudo copiar la referencia.', { tono: 'error' }); }
  }

  async function alternarColeccion(b: Biblioteca) {
    const dentro = doc.bibliotecas.includes(b.id);
    const cambiar = (d: ResumenDocumento): ResumenDocumento => d.id !== doc.id ? d : { ...d, bibliotecas: dentro ? d.bibliotecas.filter((x) => x !== b.id) : [...d.bibliotecas, b.id] };
    qc.setQueriesData<Pagina<ResumenDocumento>>({ queryKey: ['documentos'] }, (p) => p && { ...p, elementos: p.elementos.map(cambiar) });
    try {
      if (dentro) await api().bibliotecas.quitar(b.id, doc.id);
      else await api().bibliotecas.anadir(b.id, { documentos: [doc.id] });
      avisar(dentro ? `Fuera de «${b.nombre}».` : `Añadido a «${b.nombre}».`);
    } catch { avisar('No se pudo cambiar la colección.', { tono: 'error' }); }
    void qc.invalidateQueries({ queryKey: ['documentos'] });
    void qc.invalidateQueries({ queryKey: ['bibliotecas'] });
  }

  function borrar() {
    const previas = qc.getQueriesData<Pagina<ResumenDocumento>>({ queryKey: ['documentos'] });
    qc.setQueriesData<Pagina<ResumenDocumento>>({ queryKey: ['documentos'] }, (p) => p && { ...p, elementos: p.elementos.filter((d) => d.id !== doc.id) });
    // Borrado diferido: se ejecuta solo si nadie pulsa «Deshacer».
    conDeshacer(
      `«${doc.titulo}» va a la papelera.`,
      () => previas.forEach(([k, v]) => qc.setQueryData(k, v)),
      () => void api().documentos.borrar(doc.id).then(() => qc.invalidateQueries({ queryKey: ['bibliotecas'] })).catch(() => {
        previas.forEach(([k, v]) => qc.setQueryData(k, v));
        avisar('No se pudo borrar.', { tono: 'error' });
      }),
    );
  }

  async function reprocesar() {
    try { await api().documentos.reprocesar(doc.id, { fases: ['lectura', 'folios', 'metadatos', 'estructura', 'contexto', 'vectores', 'figuras'] }); avisar('Vuelve a la imprenta.'); void qc.invalidateQueries({ queryKey: ['documentos'] }); }
    catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo volver a leer.', { tono: 'error' }); }
  }

  async function exportarSpdf() {
    avisar(`Preparando «${doc.titulo}.spdf»…`);
    try {
      const bytes = await api().documentos.spdf(doc.id);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/x-spdf' }));
      a.download = `${doc.titulo.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'documento'}.spdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo exportar.', { tono: 'error' }); }
  }

  async function descargar() {
    try { const { url } = await api().documentos.original(doc.id); if (url) window.open(url, '_blank', 'noopener'); else avisar('En la demostración no hay original que descargar.'); }
    catch { avisar('No se pudo obtener el original.', { tono: 'error' }); }
  }

  return (
    <MenuRaiz>
      <MenuDisparador asChild>{children}</MenuDisparador>
      <MenuContenido className="w-64">
        <MenuElemento icono="citar" alElegir={() => void copiarCita()}>Copiar la referencia</MenuElemento>
        <MenuElemento icono="descargar" alElegir={() => void descargar()}>Descargar el original</MenuElemento>
        <MenuElemento icono="pila" alElegir={() => void exportarSpdf()}>Exportar como .spdf</MenuElemento>
        {doc.estado !== 'listo' && doc.estado !== 'procesando' ? <MenuElemento icono="rayo" alElegir={() => void reprocesar()}>Volver a leer</MenuElemento> : null}
        {bibliotecas.length ? (
          <>
            <MenuSeparador />
            <MenuRotulo>Colecciones</MenuRotulo>
            {bibliotecas.map((b) => (
              <MenuElemento key={b.id} icono={doc.bibliotecas.includes(b.id) ? 'hecho' : undefined} alElegir={() => void alternarColeccion(b)}>
                <span className="flex items-center gap-2"><span className={cx('h-2 w-2 rounded-full', puntoColeccion(b.color))} />{b.nombre}</span>
              </MenuElemento>
            ))}
          </>
        ) : null}
        <MenuSeparador />
        <MenuElemento icono="papelera" peligro alElegir={borrar}>Borrar</MenuElemento>
      </MenuContenido>
    </MenuRaiz>
  );
}

function lineaMeta(d: ResumenDocumento) {
  return [NOMBRE_TIPO[d.tipo], esMedio(d.tipo) && d.duracion ? duracion(d.duracion) : nombreUnidad(d.tipo, d.unidades)].join(' · ');
}

/** Ficha en rejilla: portada, título, autor. */
export const FichaDocumento = memo(function FichaDocumento({ doc, bibliotecas, indice }: { doc: ResumenDocumento; bibliotecas: Biblioteca[]; indice: number }) {
  return (
    <article className="group relative flex flex-col anim-entra" style={{ animationDelay: `${Math.min(indice, 12) * 18}ms` }}>
      <Link
        to="/lector/$id"
        params={{ id: doc.id }}
        className="block rounded-s outline-offset-4"
      >
        <div className={cx('relative aspect-[3/4] overflow-hidden rounded-s border border-filete shadow-hoja transition-transform duration-200 [container-type:inline-size] group-hover:-translate-y-1 group-hover:rotate-[-0.6deg]')}>
          <Portada id={doc.id} titulo={doc.titulo} autores={doc.autores} tipo={doc.tipo} url={doc.portadaUrl} />
          {doc.estado === 'procesando' ? (
            <span className="rotulo absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-papel/95 px-2 py-1 text-tinta"><span className="h-1.5 w-1.5 rounded-full bg-rojo anim-pulso" />Leyendo</span>
          ) : null}
          {doc.estado === 'error' ? <span className="rotulo absolute left-2 top-2 rounded-full bg-rojo px-2 py-1 text-[#fbf5ec]">Con errores</span> : null}
          {doc.estado === 'pendiente' ? <span className="rotulo absolute left-2 top-2 rounded-full bg-amarillo px-2 py-1 text-tinta">Sin leer</span> : null}
          <span className="absolute bottom-2 right-2 grid h-6 w-6 place-items-center rounded-full bg-papel/90 text-tinta-2"><Icono nombre={ICONO_TIPO[doc.tipo]} tam={14} /></span>
        </div>
        <h3 className="mt-3 line-clamp-2 text-[1rem] leading-[1.2] tracking-[-0.01em] text-tinta">{doc.titulo}</h3>
      </Link>
      <p className="mt-1 truncate text-[0.8125rem] text-tinta-2">{doc.autores || 'Sin autor'}{doc.anio ? `, ${doc.anio}` : ''}</p>
      <div className="mt-1 flex items-center gap-2">
        <Rotulo className="truncate">{lineaMeta(doc)}</Rotulo>
        <MenuDocumento doc={doc} bibliotecas={bibliotecas}>
          <button type="button" aria-label={`Acciones de «${doc.titulo}»`} className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-s text-apagado opacity-100 hover:bg-hondo hover:text-tinta md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100">
            <Icono nombre="opciones" tam={16} />
          </button>
        </MenuDocumento>
      </div>
    </article>
  );
});

/** Fila en la vista de lista: densa, alineada en columnas. */
export const FilaDocumento = memo(function FilaDocumento({ doc, bibliotecas }: { doc: ResumenDocumento; bibliotecas: Biblioteca[] }) {
  return (
    <div className="group grid h-16 grid-cols-[2.5rem_1fr_auto] items-center gap-4 border-b border-filete px-1 sm:grid-cols-[2.5rem_minmax(0,3fr)_minmax(0,2fr)_4.5rem_11rem_8.5rem]">
      <div className="h-[3.25rem] w-10 overflow-hidden rounded-[2px] border border-filete [container-type:inline-size]">
        <Portada id={doc.id} titulo="" tipo={doc.tipo} url={doc.portadaUrl} />
      </div>
      <Link to="/lector/$id" params={{ id: doc.id }} className="min-w-0">
        <p className="truncate text-[0.9375rem] text-tinta group-hover:underline group-hover:decoration-filete-fuerte group-hover:underline-offset-4">{doc.titulo}</p>
        <p className="truncate text-[0.8125rem] text-tinta-2 sm:hidden">{doc.autores}{doc.anio ? `, ${doc.anio}` : ''}</p>
      </Link>
      <p className="hidden truncate text-[0.875rem] text-tinta-2 sm:block">{doc.autores || '—'}</p>
      <p className="tnum hidden font-mono text-[0.8125rem] text-tinta-2 sm:block">{doc.anio ?? 's. f.'}</p>
      <p className="hidden truncate sm:block"><Rotulo>{lineaMeta(doc)}</Rotulo></p>
      <div className="flex items-center justify-end gap-2">
        {doc.estado === 'procesando' ? <span className="h-1.5 w-1.5 rounded-full bg-rojo anim-pulso" aria-label="Leyendo" /> : null}
        {doc.estado === 'pendiente' ? <span className="rotulo rounded-full bg-amarillo px-1.5 py-0.5 text-tinta">sin leer</span> : null}
        <span className="hidden text-[0.75rem] text-apagado lg:inline">{haceCuanto(doc.creado)}</span>
        <MenuDocumento doc={doc} bibliotecas={bibliotecas}>
          <button type="button" aria-label={`Acciones de «${doc.titulo}»`} className="grid h-8 w-8 place-items-center rounded-s text-apagado hover:bg-hondo hover:text-tinta">
            <Icono nombre="opciones" tam={16} />
          </button>
        </MenuDocumento>
      </div>
    </div>
  );
});
