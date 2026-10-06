/**
 * La referencia bibliográfica: la entrada completa que va en la bibliografía,
 * en el estilo elegido, con el motor CSL de la API. Se copia con formato
 * (cursivas, como HTML) y en texto plano a la vez.
 */
import { useQuery, useQueryClient, queryOptions } from '@tanstack/react-query';
import type { Ajustes } from '@scholaris/contrato';
import { avisar } from '@scholaris/ui';
import { api } from '../datos/api';
import { clienteConsultas, q } from '../datos/consultas';
import { ESTILOS_RAPIDOS, estiloNormalizado } from './formato';
import { ponerPreferencia, preferencia } from './acciones';

export const qReferencia = (documento: string, estilo: string) => queryOptions({
  queryKey: ['referencia', documento, estilo],
  queryFn: () => api().documentos.cita(documento, { estilo }),
  staleTime: 10 * 60_000,
});

/** El estilo del usuario: el de Ajustes (servidor) y, mientras llega, el recordado en este navegador. */
export function useEstilo(): [string, (id: string) => void] {
  const qc = useQueryClient();
  const { data: ajustes } = useQuery({ ...q.ajustes(), staleTime: 5 * 60_000 });
  const estilo = estiloNormalizado(ajustes?.preferencias.estiloCita ?? preferencia('estilo', 'apa'));
  const cambiar = (id: string) => {
    ponerPreferencia('estilo', id);
    qc.setQueryData<Ajustes>(['ajustes'], (a) => a && { ...a, preferencias: { ...a.preferencias, estiloCita: id } });
    void api().ajustes.preferencias({ estiloCita: id }).catch(() => undefined);
  };
  return [estilo, cambiar];
}

export function estiloActual(): string {
  const a = clienteConsultas.getQueryData<Ajustes>(['ajustes']);
  return estiloNormalizado(a?.preferencias.estiloCita ?? preferencia('estilo', 'apa'));
}

export const nombreEstilo = (id: string) => ESTILOS_RAPIDOS.find((e) => e.id === id)?.nombre ?? id;

/** Copia HTML y texto plano a la vez; si el navegador no deja, solo el texto. */
export async function copiarRico(html: string, texto: string): Promise<boolean> {
  try {
    if ('ClipboardItem' in window && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([texto], { type: 'text/plain' }) })]);
      return true;
    }
  } catch { /* cae al texto plano */ }
  try { await navigator.clipboard.writeText(texto); return true; } catch { return false; }
}

/** Copia la referencia de un documento y lo confirma enseñando lo copiado. */
export async function copiarReferencia(documento: string, estilo = estiloActual()): Promise<string | null> {
  try {
    const r = await clienteConsultas.fetchQuery(qReferencia(documento, estilo));
    const ok = await copiarRico(r.html || r.texto, r.texto);
    if (!ok) throw new Error('El navegador no dejó copiar.');
    avisar(`Referencia copiada (${nombreEstilo(estilo)}): ${r.texto}`, { tono: 'exito', duracion: 6000 });
    return r.texto;
  } catch (e) {
    avisar(e instanceof Error ? e.message : 'No se pudo copiar la referencia.', { tono: 'error' });
    return null;
  }
}

/** La bibliografía de varios documentos (o de una colección), ordenada por el estilo. */
export async function copiarBibliografia(sel: { documentos?: string[]; biblioteca?: string }, estilo = estiloActual()) {
  try {
    const [html, md] = await Promise.all([
      api().citas.bibliografia({ ...sel, estilo, formato: 'html' }),
      api().citas.bibliografia({ ...sel, estilo, formato: 'texto' }),
    ]);
    const texto = md.entradas.join('\n');
    const ok = await copiarRico(html.html ?? html.entradas.map((e) => `<p>${e}</p>`).join(''), texto);
    if (!ok) throw new Error('El navegador no dejó copiar.');
    avisar(`Bibliografía copiada (${nombreEstilo(estilo)}): ${md.entradas.length} ${md.entradas.length === 1 ? 'entrada' : 'entradas'}.`, { tono: 'exito' });
  } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo copiar la bibliografía.', { tono: 'error' }); }
}

/** Descarga la bibliografía: BibTeX, RIS, CSL-JSON o un DOCX con las entradas en el estilo. */
export async function descargarBibliografia(sel: { documentos?: string[]; biblioteca?: string }, formato: 'bibtex' | 'ris' | 'csl-json' | 'docx', estilo = estiloActual()) {
  try {
    let blob: Blob, ext: string;
    if (formato === 'docx') {
      const b = await api().citas.bibliografia({ ...sel, estilo, formato: 'markdown' as 'texto' });
      blob = (await import('./docx')).markdownADocx(`# Bibliografía\n\n${b.entradas.join('\n\n')}`);
      ext = 'docx';
    } else {
      const t = await api().citas.exportar({ ...sel, formato });
      blob = new Blob([t], { type: 'text/plain' });
      ext = formato === 'bibtex' ? 'bib' : formato === 'ris' ? 'ris' : 'json';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `bibliografia.${ext}`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  } catch (e) { avisar(e instanceof Error ? e.message : 'No se pudo descargar.', { tono: 'error' }); }
}
