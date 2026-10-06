import { writeFileSync } from 'node:fs';
import { crearSpdf } from '@scholaris/spdf';
const a = await crearSpdf({ generador: 'fixtura de pruebas' });
const ahora = '2026-10-06T00:00:00Z';
// Cervantes, «Don Quijote», primera parte, capítulo I: texto literal de Project Gutenberg n.º 2000
// (https://www.gutenberg.org/cache/epub/2000/pg2000.txt). Los folios (23, 24) son los de esta copia de prueba.
await a.escribirDocumento({ id: 'doc_mini', tipo: 'pdf', metadatos: { titulo: 'Don Quijote', autores: [{ nombre: 'Miguel de', apellidos: 'Cervantes Saavedra' }], anio: 1605, idioma: 'es' }, estado: 'listo', huella: 'abc', original: 'original.pdf', mime: 'application/pdf', bytes: 3, unidades: 3, creado: ahora, actualizado: ahora, bibliotecas: [] });
const pag = (f: number, impresa: string | null) => ({ tipo: 'pagina' as const, fisica: f, impresa, romana: false, origen: 'leido' as const, confianza: 1 });
const textos = [
  'Primera parte del ingenioso hidalgo don Quijote de la Mancha',
  'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.',
  'Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, lantejas los viernes, algún palomino de añadidura los domingos, consumían las tres partes de su hacienda.',
];
await a.escribirUnidades(textos.map((t, i) => ({ id: `u${i}`, documento: 'doc_mini', orden: i, ancla: pag(i + 1, i === 0 ? null : String(i + 22)), texto: t, lector: 'prueba', confianza: 1 })));
await a.escribirFragmentos(textos.map((t, i) => ({ id: `f${i}`, documento: 'doc_mini', unidad: `u${i}`, orden: i, texto: t, contexto: 'Primera parte, capítulo primero.', seccion: ['Capítulo primero'], ancla: pag(i + 1, i === 0 ? null : String(i + 22)) })));
await a.escribirEspacio({ id: 'prueba@4', proveedor: 'pruebas', modelo: 'prueba', dims: 4, normalizado: true, modalidades: ['texto'] });
await a.escribirVectores(textos.map((_, i) => ({ objetivo: 'fragmento' as const, id: `f${i}`, espacio: 'prueba@4', documento: 'doc_mini', valores: new Float32Array([i === 1 ? 1 : 0, i === 2 ? 1 : 0, i === 0 ? 1 : 0, 0]) })));
await a.ponerBlob('original.pdf', 'application/pdf', new Uint8Array([37, 80, 68]));
writeFileSync(process.argv[2]!, a.exportar());
a.cerrar();
console.log('ok');
