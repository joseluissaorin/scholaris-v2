/**
 * Extremo a extremo contra un Scholaris local en marcha, solo por HTTP y con
 * el cliente del contrato: sube un PDF, lo ingiere (conversión en el servidor),
 * sigue el progreso por WebSocket, busca, exporta el .spdf y lo reimporta.
 *
 *   tsx scripts/e2e.ts [base] [fichero.pdf] [consulta]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { crearCliente, subirFichero, type EventoTiempoReal } from '@scholaris/contrato';

const base = process.argv[2] ?? 'http://localhost:8790';
const fichero = process.argv[3] ?? '../../bench/datos/originales/attention_2017.pdf';
const consulta = process.argv[4] ?? 'scaled dot-product attention';
const token = process.env.SCHOLARIS_TOKEN ?? process.env.TOKEN;
const api = crearCliente({ base, token });
const t0 = Date.now();
const seg = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;

const bytes = readFileSync(fichero);
const huella = createHash('sha256').update(bytes).digest('hex');
const s = await api.subidas.crear({ nombre: basename(fichero), mime: 'application/pdf', bytes: bytes.byteLength, huella });
if (s.duplicado) {
  console.log(`Ya estaba: ${s.duplicado}`);
} else {
  await subirFichero(api, s.subida, s.original, new Blob([bytes]), (n, total) => process.stdout.write(`\rsubido ${Math.round((100 * n) / total)} %`));
  console.log(`\n[${seg()}] original subido (${s.documento})`);
  const ing = await api.subidas.ingestar(s.subida, {});
  console.log(`[${seg()}] tarea ${ing.tarea}`);

  const b = await api.tiempoReal.billete(ing.tarea);
  const ws = new WebSocket(b.url.startsWith('/') ? base.replace(/^http/, 'ws') + b.url : b.url);
  const latido = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ tipo: 'ping', t: Date.now() })), 30_000);
  const fin = new Promise<EventoTiempoReal>((res) => {
    ws.on('message', (m) => {
      const e = JSON.parse(String(m)) as EventoTiempoReal;
      if (e.tipo === 'progreso') process.stdout.write(`\r[${seg()}] ${e.progreso.fase.padEnd(10)} ${(e.progreso.total * 100).toFixed(0).padStart(3)} % ${e.progreso.mensaje ?? ''}`.padEnd(100));
      if (e.tipo === 'fin') res(e);
    });
  });
  const r = await fin;
  clearInterval(latido);
  ws.close();
  console.log(`\n[${seg()}] fin: ${JSON.stringify(r)}`);
  if (r.tipo === 'fin' && r.estado !== 'listo') process.exit(1);
}

const docId = s.duplicado ?? s.documento;
const d = await api.documentos.obtener(docId);
console.log(`Documento: «${d.metadatos.titulo}» de ${d.metadatos.autores.map((a) => a.apellidos).join(', ')} (${d.metadatos.anio ?? 's. f.'}), ${d.unidades} unidades, ${d.cuentas.fragmentos} fragmentos, espacios: ${d.espacios.map((e) => e.id).join(', ')}`);
const folios = await api.documentos.folios(docId);
console.log(`Folios: ${folios.folios.slice(0, 12).map((f) => `${f.fisica}→${f.impresa ?? '∅'}`).join(' ')}`);

const busq = await api.busqueda.buscar({ consulta, k: 5 });
console.log(`\nBúsqueda «${consulta}» (${busq.ms} ms, intención ${busq.intencion}):`);
for (const x of busq.resultados) console.log(`  ${x.citaCorta} [${x.vias.join('+')}] ${x.puntuacion.toFixed(3)}: ${x.fragmento.texto.replace(/\s+/g, ' ').slice(0, 110)}…`);

const spdf = await api.documentos.spdf(docId);
writeFileSync('/tmp/attention_2017.v4.spdf', spdf);
console.log(`\n.spdf exportado: /tmp/attention_2017.v4.spdf (${(spdf.byteLength / 1024).toFixed(0)} KB)`);
const imp = await api.documentos.importar(spdf);
console.log(`Reimportado como ${imp.documento} (v${imp.versionOrigen}) ${imp.avisos.join(' ')}`);
const v = await api.citas.verificar({ afirmacion: 'The Transformer relies entirely on attention mechanisms, dispensing with recurrence and convolutions.' });
console.log(`Verificación: ${v.veredicto}; ${v.citas.slice(0, 2).map((c) => `${c.citaCorta} ${c.respaldo.toFixed(2)}`).join(' | ')}`);
console.log(`\nTotal: ${seg()}`);
