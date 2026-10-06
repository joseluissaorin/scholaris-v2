/** Prueba de búsqueda, respuesta y autocita sobre el SPDF nuevo de la entrevista. */
import { readFileSync } from 'node:fs';
import { setGlobalDispatcher, Agent } from 'undici';
import { ArchivoSpdf } from '@scholaris/spdf';
import { Buscador, IndiceVectorialSQL, responderCompleto } from '@scholaris/busqueda';
import { autocitar } from '@scholaris/citas';
import { crearInteligencia } from '@scholaris/proveedores';
import { anclaACita } from '@scholaris/nucleo';
import { cargarEntorno } from './entorno.js';

setGlobalDispatcher(new Agent({ connections: 256 }));
const archivo = await ArchivoSpdf.abrir(readFileSync(process.argv[2] ?? 'bench/datos/salida/serrano.spdf'));
const intel = crearInteligencia(cargarEntorno());
const [esp] = await archivo.sql.ejecutar<{ id: string; proveedor: string; modelo: string; dims: number; modalidades: string }>('SELECT * FROM espacios WHERE id LIKE ?', 'gemini%');
const indice = new IndiceVectorialSQL(archivo.sql, intel.embebedor.espacio);
const b = new Buscador({ sql: archivo.sql, embebedor: intel.embebedor, indice, redactor: intel.redactor, reordenador: intel.reordenador, juez: intel.juez });
console.log('espacio en el SPDF:', esp?.id, '| embebedor:', intel.embebedor.espacio.id);
const [d] = await archivo.sql.ejecutar<{ titulo: string; metadatos: string }>('SELECT titulo, metadatos FROM documentos');
console.log('documento:', d?.titulo, '|', JSON.parse(d?.metadatos ?? '{}').autores?.map((a: any) => `${a.nombre} ${a.apellidos}`).join(', '));

for (const q of ['qué piensa Cabral de la muerte', 'su infancia y su madre', '"no estás deprimido"', 'Dios y la religión']) {
  const t = performance.now();
  const r = await b.buscar(q, { limite: 3 });
  console.log(`\n### «${q}» — ${Math.round(performance.now() - t)} ms`);
  for (const x of r.resultados) console.log(`  [${anclaACita(x.fragmento.ancla, x.fragmento.anclaFin)}] (${x.vias.join('+')}) ${x.fragmento.texto.slice(0, 160).replace(/\s+/g, ' ')}…`);
}

const t = performance.now();
const resp = await responderCompleto(b, intel.redactor, '¿Qué cuenta Facundo Cabral sobre su madre y por qué fue tan importante para él?');
console.log(`\n### PREGUNTA — ${Math.round(performance.now() - t)} ms\n${resp.markdown}`);
console.log('descartadas:', resp.descartadas, 'literales sin verificar:', resp.literalesNoVerificados);

const t2 = performance.now();
const ac = await autocitar('Facundo Cabral sostiene que la felicidad no depende de tener cosas. También recuerda que su madre lo marcó profundamente.', { buscador: b, redactor: intel.redactor, juez: intel.juez });
console.log(`\n### AUTOCITA — ${Math.round(performance.now() - t2)} ms`);
for (const a of (ac as any).afirmaciones) { console.log('•', a.texto); for (const c of a.citas) console.log(`   → [${anclaACita(c.ancla)}] ${c.relacion} respaldo ${c.respaldo} ${c.estado}: «${String(c.evidencia ?? '').slice(0,140)}»`); }
