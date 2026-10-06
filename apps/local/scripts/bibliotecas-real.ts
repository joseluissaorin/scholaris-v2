/**
 * Prueba real de las bibliotecas como objetos sociales contra un Scholaris
 * local con dos personas (SCHOLARIS_USUARIOS) y la inteligencia de verdad:
 *
 *   1. José Luis llena una colección con bench/datos/originales en un solo lote
 *      (estimación antes de empezar, cola con concurrencia, repetidos por huella).
 *   2. Exporta un paquete .scholaris con una selección y Pepe lo importa (sin leer nada).
 *   3. Le invita, Pepe acepta, la sigue, busca en lo suyo y en lo que sigue, y la copia
 *      (lo que ya tenía no se duplica; lo demás, sin un byte nuevo en el disco).
 *   4. Un enlace de solo lectura con contraseña: se lee y se busca sin cuenta; al retirarlo, deja de funcionar.
 *
 *   tsx scripts/bibliotecas-real.ts [base] [carpeta] [datos]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { abrirZip, crearCliente, importarPaquete, subirFichero, type ElementoNuevo, type ManifiestoPaquete } from '@scholaris/contrato';

const [base = 'http://localhost:8791', carpeta = '../../bench/datos/originales', datos = '/tmp/sch/datos-real'] = process.argv.slice(2);
const jl = crearCliente({ base, token: process.env.TOKEN_A ?? 'tok-jose-luis-7f3a' });
const pepe = crearCliente({ base, token: process.env.TOKEN_B ?? 'tok-pepe-arteaga-9b1c' });
const t0 = Date.now();
const seg = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s`;
const informe: Record<string, unknown> = {};
const MIMES: Record<string, string> = { pdf: 'application/pdf', mp3: 'audio/mpeg', mp4: 'video/mp4' };

function bytesEn(dir: string): number {
  let t = 0;
  try { for (const n of readdirSync(dir)) { const f = join(dir, n); const s = statSync(f); t += s.isDirectory() ? bytesEn(f) : s.size; } } catch { /* no existe */ }
  return t;
}
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

// 1. Llenar ---------------------------------------------------------------------
const ficheros = readdirSync(carpeta).filter((n) => !n.startsWith('.')).sort().map((n) => join(carpeta, n));
const elementos: ElementoNuevo[] = ficheros.map((f) => {
  const ext = f.split('.').pop()!.toLowerCase();
  return { clase: 'archivo', nombre: basename(f), bytes: statSync(f).size, mime: MIMES[ext] ?? 'application/octet-stream', huella: createHash('sha256').update(readFileSync(f)).digest('hex') };
});
const bib = (await jl.bibliotecas.listar()).find((b) => b.nombre === 'Banco de Scholaris')
  ?? await jl.bibliotecas.crear({ nombre: 'Banco de Scholaris', descripcion: 'Los originales del banco de pruebas: artículos, escaneos, audio y vídeo.', color: 'azul', derechos: 'uso_privado', notaDerechos: 'Material de investigación para uso interno del grupo.' });
const est = await jl.lotes.estimar({ elementos });
informe.estimacion = est;
console.log(`[${seg()}] estimación: ${est.elementos} elementos, ${est.nuevos} por leer, ${est.paginas} páginas, ${est.minutos} min; rápido ${Math.round(est.modos.rapido.segundos / 60)} min y ${est.modos.rapido.euros} €, económico ${est.modos.economico.euros} €; repetidos ${est.duplicados.length}; recomendado ${est.recomendado}`);
let lote = await jl.lotes.crear({ elementos, biblioteca: bib.id, modo: 'rapido', concurrencia: 3, nombre: 'Banco de pruebas' });
console.log(`[${seg()}] lote ${lote.id}: ${JSON.stringify(lote.cuentas)}`);
const enCurso = new Set<number>();
while (lote.estado === 'en_marcha') {
  for (const e of await jl.lotes.siguientes(lote.id, 3)) {
    enCurso.add(e.n);
    void (async () => {
      const ruta = ficheros[e.n - 1]!;
      try {
        const blob = new Blob([readFileSync(ruta)]);
        const s = await jl.subidas.crear({ nombre: e.nombre, mime: e.mime!, bytes: blob.size, huella: e.huella!, bibliotecas: [bib.id] });
        if (s.duplicado) { await jl.lotes.apuntar(lote.id, e.n, { estado: 'duplicado', documento: s.duplicado }); return; }
        await jl.lotes.apuntar(lote.id, e.n, { estado: 'subiendo', documento: s.documento });
        await subirFichero(jl, s.subida, s.original, blob);
        const ing = await jl.subidas.ingestar(s.subida, {});
        await jl.lotes.apuntar(lote.id, e.n, { estado: 'procesando', documento: ing.documento, tarea: ing.tarea });
      } catch (err) {
        await jl.lotes.apuntar(lote.id, e.n, { estado: 'error', error: (err as Error).message });
      } finally { enCurso.delete(e.n); }
    })();
  }
  await new Promise((r) => setTimeout(r, 5000));
  lote = await jl.lotes.obtener(lote.id);
  const curso = lote.elementos.filter((x) => x.estado === 'procesando').map((x) => `${x.nombre.slice(0, 22)} ${Math.round((x.avance ?? 0) * 100)} %`).join(', ');
  process.stdout.write(`\r[${seg()}] ${JSON.stringify(lote.cuentas)} ${curso}`.padEnd(160).slice(0, 200));
}
console.log(`\n[${seg()}] lote ${lote.estado}: ${JSON.stringify(lote.cuentas)}`);
for (const e of lote.elementos.filter((x) => x.estado === 'error')) console.log(`   error en ${e.nombre}: ${e.error}`);
informe.lote = { id: lote.id, estado: lote.estado, cuentas: lote.cuentas, segundos: Math.round((Date.now() - t0) / 1000) };
// El mismo lote otra vez: todo repetido, nada se lee.
const otra = await jl.lotes.estimar({ elementos });
console.log(`[${seg()}] estimar otra vez: ${otra.duplicados.length} de ${otra.elementos} ya estaban, ${otra.nuevos} por leer`);
informe.repetidos = { duplicados: otra.duplicados.length, nuevos: otra.nuevos };

const docs = (await jl.documentos.listar({ biblioteca: bib.id, limite: 100 })).elementos.filter((d) => d.estado === 'listo');
const b1 = await jl.busqueda.buscar({ consulta: 'scaled dot-product attention', k: 3, filtros: { bibliotecas: [bib.id] } });
console.log(`[${seg()}] ${docs.length} documentos listos; buscar: ${b1.resultados[0]?.citaCorta ?? 'nada'}`);

// 2. Paquete con una selección → Pepe -----------------------------------------
const seleccion = docs.filter((d) => d.tipo === 'pdf' || d.tipo === 'pdf_escaneado').slice(0, 3).map((d) => d.id);
const r = await jl.bibliotecas.paquete(bib.id, { documentos: seleccion });
const paquete = new Uint8Array(await r.arrayBuffer());
writeFileSync('/tmp/sch/banco-seleccion.scholaris', paquete);
const m = JSON.parse(await (await abrirZip(paquete)).texto('manifest.json')) as ManifiestoPaquete;
console.log(`[${seg()}] paquete: ${mb(paquete.length)}, ${m.documentos.length} documentos, derechos ${m.biblioteca.derechos}`);
const tPaquete = Date.now();
const imp = await importarPaquete(pepe, paquete, { nombre: 'Banco (paquete de José Luis)' });
console.log(`[${seg()}] Pepe importa el paquete en ${((Date.now() - tPaquete) / 1000).toFixed(1)} s: ${imp.importados.length} importados (${imp.importados.filter((x) => x.tarea).length} con tarea), ${imp.repetidos.length} repetidos, ${imp.fallidos.length} fallidos`);
informe.paquete = { bytes: paquete.length, documentos: m.documentos.length, importados: imp.importados.length, conTarea: imp.importados.filter((x) => x.tarea).length, fallidos: imp.fallidos, segundos: (Date.now() - tPaquete) / 1000 };

// 3. Invitar, aceptar, seguir, buscar y copiar ------------------------------------
const inv = await jl.bibliotecas.compartir(bib.id, { correo: 'colega@example.org', permiso: 'lectura', mensaje: 'Pepe, aquí tienes el banco para las pruebas de la edición.' });
const bandeja = await pepe.invitaciones.listar();
console.log(`[${seg()}] invitación ${inv.estado}; en la bandeja de Pepe: ${bandeja.map((b) => `«${b.nombre}» de ${b.de.nombre}`).join(', ')}`);
await pepe.invitaciones.aceptar(bandeja.find((b) => b.biblioteca === bib.id)!.id);
const sigue = await pepe.compartida(bib.id).documentos.listar();
const conj = await pepe.busqueda.conjunta({ consulta: 'attention', alcance: 'todo', k: 5 });
console.log(`[${seg()}] Pepe sigue la colección (${sigue.total} documentos); búsqueda conjunta: ${conj.fuentes.map((f) => `${f.propia ? 'lo suyo' : f.nombre}: ${f.resultados}`).join(', ')}`);
const antes = bytesEn(join(datos, 'almacen', 'u', 'pepe'));
const tCopia = Date.now();
const copia = await pepe.copias.copiarTodo({ origen: { biblioteca: bib.id } });
const despues = bytesEn(join(datos, 'almacen', 'u', 'pepe'));
console.log(`[${seg()}] copia en ${((Date.now() - tCopia) / 1000).toFixed(1)} s: ${copia.copiados.length} copiados, ${copia.repetidos.length} ya los tenía, ${copia.fallidos.length} fallidos; bytes nuevos en el disco de Pepe: ${despues - antes} (los de José Luis: ${mb(bytesEn(join(datos, 'almacen', 'u', 'joseluis')))})`);
informe.copia = { copiados: copia.copiados.length, repetidos: copia.repetidos.length, fallidos: copia.fallidos, bytesNuevos: despues - antes, segundos: (Date.now() - tCopia) / 1000 };

// 4. Enlace con contraseña -----------------------------------------------------
const e = await jl.enlaces.crear({ biblioteca: bib.id, clave: 'anchieta', caducaDias: 30, confirmarDerechos: true });
const anonimo = crearCliente({ base });
const pase = (await anonimo.enlacePublico.acceso(e.token, 'anchieta')).pase;
const pub = anonimo.publico(e.token, pase);
const bp = await pub.busqueda.buscar({ consulta: 'attention' });
console.log(`[${seg()}] enlace ${e.url}: ${(await pub.documentos.listar()).total} documentos sin cuenta, buscar «attention» → ${bp.resultados.length} pasajes`);
writeFileSync('/tmp/sch/enlace.json', JSON.stringify({ url: e.url, token: e.token, id: e.id, biblioteca: bib.id }));
informe.enlace = { url: e.url, documentos: (await pub.documentos.listar()).total, resultados: bp.resultados.length };
writeFileSync('/tmp/sch/informe-real.json', JSON.stringify(informe, null, 2));
console.log(`[${seg()}] informe en /tmp/sch/informe-real.json`);
