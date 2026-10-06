/**
 * PPTX → texto y notas de cada diapositiva. La imagen de cada diapositiva no se
 * puede hacer en el navegador (hace falta LibreOffice): se pide al servidor.
 */

import { strFromU8, unzipSync } from 'fflate';
import type { Contexto } from '../contexto.js';
import type { Deteccion } from '../detectar.js';
import type { ArchivoEntrada, Diapositiva, OrigenArchivo, PaqueteConversion } from '../tipos.js';
import { VERSION_PAQUETE } from '../tipos.js';
import { metadatosOoxml } from './convertir-documento.js';
import { resolverRuta } from './epub.js';
import { analizarHtml, buscar, buscarTodos, textoPlano, type Nodo } from './html.js';

function relaciones(zip: Record<string, Uint8Array>, ruta: string): Map<string, { destino: string; tipo: string }> {
  const partes = ruta.split('/');
  const archivo = partes.pop();
  const rels = zip[`${partes.join('/')}/_rels/${archivo}.rels`];
  const m = new Map<string, { destino: string; tipo: string }>();
  if (!rels) return m;
  for (const r of buscarTodos(analizarHtml(strFromU8(rels), true), (n) => n.nombre === 'relationship')) {
    m.set(r.attrs.id ?? '', { destino: resolverRuta(ruta, r.attrs.target ?? ''), tipo: r.attrs.type ?? '' });
  }
  return m;
}

/** Texto de una forma: párrafos a:p con sus niveles de viñeta. */
function textoForma(sp: Nodo): { lineas: string[]; titulo: boolean; ph: string } {
  const ph = buscar(sp, (n) => n.nombre === 'ph');
  const tipo = ph?.attrs.type ?? '';
  const lineas: string[] = [];
  const cuerpo = buscar(sp, (n) => n.nombre === 'txbody');
  if (cuerpo) {
    for (const p of cuerpo.hijos.filter((h) => h.nombre === 'p')) {
      const t = buscarTodos(p, (n) => n.nombre === 't' || n.nombre === 'br').map((n) => (n.nombre === 'br' ? '\n' : textoPlano(n))).join('').trim();
      if (!t) continue;
      const ppr = p.hijos.find((h) => h.nombre === 'ppr');
      const nivel = Number(ppr?.attrs.lvl ?? 0);
      const vineta = !['title', 'ctrTitle', 'subTitle'].includes(tipo) && (tipo === 'body' || tipo === '' ) && cuerpo.hijos.filter((h) => h.nombre === 'p').length > 1;
      lineas.push(vineta ? `${'  '.repeat(nivel)}- ${t}` : t);
    }
  }
  return { lineas, titulo: tipo === 'title' || tipo === 'ctrTitle', ph: tipo };
}

export async function convertirPresentacion(ctx: Contexto, archivo: ArchivoEntrada, d: Deteccion, origen: OrigenArchivo): Promise<PaqueteConversion> {
  await ctx.emitir({ tipo: 'inicio', entrada: 'presentacion', origen, unidades: null, metadatos: {} });
  if (d.formato !== 'pptx') {
    return {
      version: VERSION_PAQUETE, tipo: 'presentacion', origen, metadatos: {}, unidades: 0,
      contenido: { clase: 'presentacion', diapositivas: [] }, partes: [],
      reserva: { motivo: `${d.formato.toUpperCase()} solo se convierte en el servidor (LibreOffice)`, tareas: ['conversion_completa', 'imagenes_diapositivas'] },
      avisos: ctx.avisos, entorno: ctx.plataforma.nombre, tiempos: ctx.cerrarTiempos(),
    };
  }
  const t = performance.now();
  const zip = unzipSync(archivo.bytes, { filter: (f) => f.name.endsWith('.xml') || f.name.endsWith('.rels') });
  const pres = zip['ppt/presentation.xml'];
  const relsPres = relaciones(zip, 'ppt/presentation.xml');
  const orden = pres ? buscarTodos(analizarHtml(strFromU8(pres), true), (n) => n.nombre === 'sldid').map((n) => relsPres.get(n.attrs['r:id'] ?? n.attrs.id ?? '')?.destino).filter((x): x is string => Boolean(x)) : [];
  const diapositivas: Diapositiva[] = [];
  for (const [i, ruta] of orden.entries()) {
    const xml = zip[ruta];
    if (!xml) continue;
    const arbol = analizarHtml(strFromU8(xml), true);
    let titulo = '';
    const cuerpo: string[] = [];
    for (const sp of buscarTodos(arbol, (n) => n.nombre === 'sp')) {
      const f = textoForma(sp);
      if (['sldNum', 'dt', 'ftr'].includes(f.ph)) continue;
      if (f.titulo && !titulo) titulo = f.lineas.join(' ');
      else cuerpo.push(...f.lineas);
    }
    // Tablas (a:tbl) como Markdown.
    for (const tbl of buscarTodos(arbol, (n) => n.nombre === 'tbl')) {
      const filas = tbl.hijos.filter((h) => h.nombre === 'tr').map((tr) => tr.hijos.filter((c) => c.nombre === 'tc').map((c) => textoPlano(c).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')));
      const ancho = Math.max(0, ...filas.map((f) => f.length));
      if (!ancho) continue;
      const fila = (f: string[]) => '| ' + Array.from({ length: ancho }, (_, k) => f[k] ?? '').join(' | ') + ' |';
      cuerpo.push([fila(filas[0] ?? []), '|' + ' --- |'.repeat(ancho), ...filas.slice(1).map(fila)].join('\n'));
    }
    let notas = '';
    const rels = relaciones(zip, ruta);
    const rutaNotas = [...rels.values()].find((r) => r.tipo.endsWith('/notesSlide'))?.destino;
    if (rutaNotas && zip[rutaNotas]) {
      const an = analizarHtml(strFromU8(zip[rutaNotas] as Uint8Array), true);
      notas = buscarTodos(an, (n) => n.nombre === 'sp').map(textoForma).filter((f) => f.ph !== 'sldNum' && f.ph !== 'sldImg').flatMap((f) => f.lineas).join('\n').trim();
    }
    diapositivas.push({ n: i + 1, titulo, texto: cuerpo.join('\n'), notas });
  }
  ctx.tiempos.texto = Math.round(performance.now() - t);
  const metadatos = metadatosOoxml(archivo.bytes);
  if (!metadatos.titulo && diapositivas[0]?.titulo) metadatos.titulo = diapositivas[0].titulo;
  return {
    version: VERSION_PAQUETE, tipo: 'presentacion', origen, metadatos, unidades: diapositivas.length,
    contenido: { clase: 'presentacion', diapositivas }, partes: ctx.partes,
    reserva: { motivo: 'La imagen de cada diapositiva necesita LibreOffice en el servidor', tareas: ['imagenes_diapositivas'] },
    avisos: ctx.avisos, entorno: ctx.plataforma.nombre, tiempos: ctx.cerrarTiempos(),
  };
}
