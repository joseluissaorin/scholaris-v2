/**
 * Meter un .spdf en la estantería: lo usan la importación de un .spdf suelto,
 * los paquetes .scholaris y las copias de bibliotecas ajenas. Nada se vuelve a
 * leer: se copian las filas, los binarios incrustados van al almacén y solo se
 * calculan los vectores del espacio de la estantería si faltan.
 *
 * Copias (`ajeno`): el .spdf lo arma el servidor desde la estantería de otro
 * usuario con las claves completas de sus binarios («u/<dueño>/d/<doc>/…»), y
 * aquí se aceptan tal cual, sin copiar bytes: se apunta la referencia para que
 * el dueño no los borre mientras alguien los use. Solo la puerta puede pedir
 * esto (va en la sesión, no en la petición).
 */
import { limpiarMarcadoOCR, nuevoId } from '@scholaris/nucleo';
import {
  abrirSpdf, escribirDocumento, escribirEspacio, escribirFiguras, escribirFragmentos, escribirSecciones, escribirUnidades, escribirVectores,
  leerDocumento, leerVectores, registrarProcedencia,
} from '@scholaris/spdf';
import type { PuertosUsuario } from '../puertos.js';
import { ahora, cambiarBiblioteca, documentoPorHuella, totalesEstanteria } from './estanteria.js';
import { fallo } from './errores.js';
import { invalidarBuscador } from './servicios.js';
import { lanzarIngesta, prefijoDocumento } from '../rutas/subidas.js';

export interface OrigenAjeno {
  propietario: string;
  biblioteca?: string;
  /** Nombre de la biblioteca de origen y de quien la comparte (para la procedencia). */
  nombre?: string;
  de?: string;
}

export interface OpcionesImportarSpdf {
  bibliotecas?: string[];
  /** Si ya hay un documento con la misma huella, no se copia: se añade a las bibliotecas. */
  deduplicar?: boolean;
  ajeno?: OrigenAjeno;
}

export interface DocumentoImportado {
  origen: string;
  documento: string;
  repetido: boolean;
  tarea?: string;
}

export interface ResultadoImportarSpdf {
  versionOrigen: number;
  documentos: DocumentoImportado[];
  avisos: string[];
}

const PREFIJO_DOC = /^(u\/[\w-]+\/d\/[\w-]+\/)/;

export async function importarSpdf(p: PuertosUsuario, bytes: Uint8Array, o: OpcionesImportarSpdf = {}): Promise<ResultadoImportarSpdf> {
  const avisos: string[] = [];
  let a;
  try {
    a = await abrirSpdf(bytes, { migrar: true });
  } catch (e) {
    return fallo('peticion_invalida', `No es un .spdf válido: ${(e as Error).message}`);
  }
  const bibliotecas = o.bibliotecas ?? [];
  const documentos: DocumentoImportado[] = [];
  try {
    const versionOrigen = Number.parseFloat(await a.version()) >= 4 ? 400 : 300;
    const docs = await a.documentos();
    if (!docs.length) fallo('peticion_invalida', 'El .spdf no contiene ningún documento.');
    const ia = await p.inteligencia();
    for (const d0 of docs) {
      if (o.deduplicar && d0.huella) {
        const ya = await documentoPorHuella(p.sql, d0.huella);
        if (ya) {
          if (bibliotecas.length) for (const b of bibliotecas) await cambiarBiblioteca(p.sql, b, [ya], true);
          documentos.push({ origen: d0.id, documento: ya, repetido: true });
          continue;
        }
      }
      // Si el id ya existe en la estantería (otra copia), se importa con id nuevo.
      const existe = await leerDocumento(p.sql, d0.id);
      const id = existe ? nuevoId('d') : d0.id;
      if (existe && !o.ajeno) avisos.push(`El documento ya estaba en tu estantería: se ha importado como copia (${id}).`);
      const prefijo = prefijoDocumento(p.usuario.id, id);
      // Binarios incrustados → almacén.
      const claves = new Map<string, string>();
      for (const b of await a.blobs()) {
        const blob = await a.leerBlob(b.clave);
        if (!blob) continue;
        const destino = `${prefijo}${b.clave.replace(/^\/+/, '').replace(/\.\.+/g, '.')}`;
        await p.almacen.poner(destino, blob.datos, blob.mime);
        claves.set(b.clave, destino);
      }
      const ajenas = new Set<string>();
      const k = (x?: string | null): string | undefined => {
        if (!x) return undefined;
        const propia = claves.get(x) ?? (x.startsWith(prefijo) ? x : undefined);
        if (propia) return propia;
        // Solo en una copia hecha por la puerta: binarios de otro, por referencia.
        if (o.ajeno && !x.includes('..')) {
          const m = PREFIJO_DOC.exec(x);
          if (m) { ajenas.add(m[1]!); return x; }
        }
        return undefined;
      };
      const unidades = await a.leerUnidades(d0.id);
      const fragmentos = await a.leerFragmentos(d0.id);
      const secciones = await a.leerSecciones(d0.id);
      const figuras = await a.leerFiguras(d0.id);
      const espacios = await a.espacios();
      const remap = <T extends { id: string }>(x: T) => (existe ? { ...x, id: `${x.id}_${id.slice(-6)}` } : x);
      const mapaUnidad = new Map(unidades.map((u) => [u.id, remap(u).id]));
      const mapaFrag = new Map(fragmentos.map((f) => [f.id, remap(f).id]));
      await p.sql.transaccion(async (tx) => {
        await escribirDocumento(tx, { ...d0, id, original: k(d0.original) ?? claves.get('original') ?? '', estado: 'listo', bibliotecas, actualizado: ahora() });
        // Un .spdf del migrador antiguo numera desde 1 y trae el marcado de la OCR de la v1: se normaliza al entrar.
        const base = unidades.length && Math.min(...unidades.map((u) => u.orden)) === 1 && unidades.some((u) => (u.lector ?? '').startsWith('scholaris-v3')) ? 1 : 0;
        await escribirUnidades(tx, unidades.map((u) => ({ ...remap(u), documento: id, orden: u.orden - base, texto: limpiarMarcadoOCR(u.texto), imagen: k(u.imagen), miniatura: k(u.miniatura) })));
        await escribirSecciones(tx, secciones.map((s) => ({ ...remap(s), documento: id, unidadDesde: mapaUnidad.get(s.unidadDesde) ?? s.unidadDesde, unidadHasta: s.unidadHasta ? mapaUnidad.get(s.unidadHasta) ?? s.unidadHasta : s.unidadHasta })));
        await escribirFragmentos(tx, fragmentos.map((f) => ({ ...remap(f), documento: id, texto: limpiarMarcadoOCR(f.texto), unidad: mapaUnidad.get(f.unidad) ?? f.unidad })));
        await escribirFiguras(tx, figuras.map((g) => ({ ...remap(g), documento: id, unidad: mapaUnidad.get(g.unidad) ?? g.unidad, imagen: k(g.imagen) ?? g.imagen })));
        for (const e of espacios) await escribirEspacio(tx, e);
      });
      // Vectores: se guardan los de todos los espacios; al índice va solo el de la estantería.
      let tieneBase = false;
      for (const e of espacios) {
        const vs = (await leerVectores(a.sql, { espacio: e.id, documento: d0.id })).map((v) => ({ ...v, documento: id, id: v.objetivo === 'fragmento' ? mapaFrag.get(v.id) ?? v.id : v.objetivo === 'unidad' ? mapaUnidad.get(v.id) ?? v.id : v.id }));
        for (let i = 0; i < vs.length; i += 500) await escribirVectores(p.sql, vs.slice(i, i + 500));
        if (e.id === ia.embebedor.espacio.id && vs.length) {
          tieneBase = true;
          if (p.indice) {
            const meta = (obj: string) => ({ objetivo: obj, documento: id, tipo: d0.tipo, ...(d0.metadatos.anio ? { anio: d0.metadatos.anio } : {}), ...(d0.metadatos.idioma ? { idioma: d0.metadatos.idioma } : {}) });
            for (let i = 0; i < vs.length; i += 500) {
              await p.indice.insertar(p.config.espacioNombres(p.usuario.id), vs.slice(i, i + 500).map((v) => ({ id: v.id, valores: v.valores, metadatos: meta(v.objetivo) })));
            }
          }
        }
      }
      for (const e of await a.leerProcedencia(d0.id)) await registrarProcedencia(p.sql, { ...e, documento: id });
      if (o.ajeno) {
        await registrarProcedencia(p.sql, {
          documento: id, fase: 'copia', proveedor: null, ms: null, cuando: ahora(),
          detalle: { de: o.ajeno.de ?? null, propietario: o.ajeno.propietario, biblioteca: o.ajeno.biblioteca ?? null, nombre: o.ajeno.nombre ?? null, documento: d0.id },
        });
        for (const pref of ajenas) await p.cuentas.referenciar(pref, p.usuario.id, id);
      }
      if (bibliotecas.length) await p.sql.ejecutar('UPDATE pl_bibliotecas SET actualizada = ? WHERE id IN (SELECT value FROM json_each(?))', ahora(), JSON.stringify(bibliotecas));
      let tarea: string | undefined;
      if (!tieneBase) {
        avisos.push(`Faltan los vectores de ${ia.embebedor.espacio.id}: se calculan ahora a partir del texto ya leído.`);
        const r = await lanzarIngesta(p, { documento: id, prefijo, original: k(d0.original) ?? '', tipo: d0.tipo, mime: d0.mime, nombre: d0.metadatos.titulo, fases: ['contexto', 'vectores'] }, 'importacion');
        tarea = r.tarea;
      }
      documentos.push({ origen: d0.id, documento: id, repetido: false, ...(tarea ? { tarea } : {}) });
    }
    invalidarBuscador(p.sql);
    const t = await totalesEstanteria(p.sql);
    await p.cuentas.totales(p.usuario.id, t.documentos, t.bytes);
    return { versionOrigen, documentos, avisos };
  } finally {
    a.cerrar();
  }
}
