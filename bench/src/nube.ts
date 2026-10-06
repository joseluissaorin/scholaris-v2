/**
 * Extremo a extremo contra un Scholaris desplegado, haciendo lo mismo que hace el
 * navegador: la imprenta convierte en local, se suben el original y las partes,
 * se pide la ingesta con el paquete y se sigue el progreso por WebSocket.
 *
 *   tsx src/nube.ts usuario <base>                 crea un usuario de prueba de Clerk y una clave personal
 *   tsx src/nube.ts subir <base> <fichero>...      sube e ingiere cada fichero
 *   tsx src/nube.ts buscar <base> <consulta>...    busca en toda la biblioteca
 *   tsx src/nube.ts preguntar <base> <pregunta>
 *
 * La clave personal se guarda en ~/.scholaris-prueba.key (modo 600) y nunca se imprime.
 * Para «usuario» hace falta CLERK_SECRET_KEY en el entorno (instancia de pruebas).
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { setGlobalDispatcher, Agent } from 'undici';
import WebSocket from 'ws';
import { crearCliente, subirFichero, type EventoTiempoReal } from '@scholaris/contrato';
import { convertirEnMemoria } from '@scholaris/imprenta/node';

setGlobalDispatcher(new Agent({ connections: 64, allowH2: false }));
const [orden, base = 'https://scholaris-v2.jlsf2005.workers.dev', ...resto] = process.argv.slice(2);
const RUTA_CLAVE = `${homedir()}/.scholaris-prueba.key`;
const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

async function clerk<T>(ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`https://api.clerk.com/v1${ruta}`, {
    method: cuerpo ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (!r.ok) throw new Error(`Clerk ${ruta}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

if (orden === 'usuario') {
  if (!process.env.CLERK_SECRET_KEY) throw new Error('Falta CLERK_SECRET_KEY');
  const correo = 'prueba-biblioteca+clerk_test@example.com';
  const existentes = await clerk<Array<{ id: string }>>(`/users?email_address=${encodeURIComponent(correo)}`);
  const usuario = existentes[0] ?? (await clerk<{ id: string }>('/users', { email_address: [correo], password: crypto.randomUUID(), skip_password_checks: true, first_name: 'Prueba', last_name: 'Biblioteca', username: 'prueba_biblioteca' }));
  const sesion = await clerk<{ id: string }>('/sessions', { user_id: usuario.id });
  const { jwt } = await clerk<{ jwt: string }>(`/sessions/${sesion.id}/tokens`, {});
  const api = crearCliente({ base, token: jwt });
  const creada = await api.claves.crear({ nombre: 'banco extremo a extremo', alcances: ['lectura', 'escritura'], dias: 7 } as never);
  writeFileSync(RUTA_CLAVE, creada.secreto);
  chmodSync(RUTA_CLAVE, 0o600);
  console.log(`Usuario ${usuario.id} listo; clave personal guardada en ${RUTA_CLAVE}`);
  process.exit(0);
}

if (!existsSync(RUTA_CLAVE)) throw new Error(`Falta ${RUTA_CLAVE}: ejecuta antes «usuario»`);
const api = crearCliente({ base, token: readFileSync(RUTA_CLAVE, 'utf8').trim() });

if (orden === 'subir') {
  for (const ruta of resto) {
    const t = Date.now();
    const bytes = readFileSync(ruta);
    const huella = createHash('sha256').update(bytes).digest('hex');
    const { paquete, datos } = await convertirEnMemoria(ruta, {});
    const tImprenta = Date.now() - t;
    console.log(`\n${basename(ruta)}: imprenta ${s(tImprenta)}, ${paquete.tipo}, ${paquete.unidades} unidades, ${datos.size} partes`);

    const mime = (paquete as unknown as { origen?: { mime?: string } }).origen?.mime ?? 'application/octet-stream';
    const c = await api.subidas.crear({ nombre: basename(ruta), mime, bytes: bytes.byteLength, huella } as never);
    if (c.duplicado) { console.log(`  ya estaba: ${c.duplicado}`); continue; }
    // Original y partes en paralelo, como en el navegador.
    const json = new TextEncoder().encode(JSON.stringify(paquete));
    const recursos = [
      ...[...datos.entries()].map(([id, b]) => ({ ruta: id, mime: paquete.partes.find((p) => p.id === id)?.mime ?? 'application/octet-stream', bytes: b.byteLength })),
      { ruta: 'paquete.json', mime: 'application/json', bytes: json.byteLength },
    ];
    const subirOriginal = subirFichero(api, c.subida, c.original, new Blob([bytes]));
    const firmados: Array<{ ruta: string; subida: { url?: string; cabeceras?: Record<string, string> } }> = [];
    for (let i = 0; i < recursos.length; i += 200) firmados.push(...(await api.subidas.recursos(c.subida, { recursos: recursos.slice(i, i + 200) })).recursos);
    const cola = [...firmados];
    await Promise.all(Array.from({ length: 24 }, async () => {
      for (let f = cola.shift(); f; f = cola.shift()) {
        const cuerpo = f.ruta === 'paquete.json' ? json : (datos.get(f.ruta) as Uint8Array);
        for (let intento = 0; ; intento++) {
          try {
            const r = await fetch(f.subida.url as string, { method: 'PUT', body: cuerpo, headers: f.subida.cabeceras });
            if (!r.ok) throw new Error(`Recurso ${f.ruta}: ${r.status}`);
            break;
          } catch (e) {
            if (intento >= 4) throw e;
            await new Promise((r) => setTimeout(r, 500 * 2 ** intento));
          }
        }
      }
    }));
    await subirOriginal;
    const tSubida = Date.now() - t;
    console.log(`  subido en ${s(tSubida - tImprenta)}: ${firmados.length} recursos y el original de ${(bytes.byteLength / 1048576).toFixed(1)} MB`);

    const ing = await api.subidas.ingestar(c.subida, { paquete: 'paquete.json' });
    const b = await api.tiempoReal.billete(ing.tarea);
    const ws = new WebSocket(b.url.startsWith('/') ? base.replace(/^http/, 'ws') + b.url : b.url);
    let primeraUnidad = 0;
    const fin = await new Promise<EventoTiempoReal>((res) => {
      ws.on('message', (m) => {
        const e = JSON.parse(String(m)) as EventoTiempoReal;
        if (e.tipo === 'progreso') {
          if (!primeraUnidad && (e.progreso.unidadesListas ?? 0) > 0) primeraUnidad = Date.now() - t;
          process.stdout.write(`\r  ${e.progreso.fase.padEnd(10)} ${(e.progreso.total * 100).toFixed(0).padStart(3)} % ${(e.progreso.mensaje ?? '').slice(0, 60)}`.padEnd(90));
        }
        if (e.tipo === 'fin') res(e);
      });
      // Si el WebSocket se cierra antes del final, se sigue por sondeo (y se anota por qué se cerró).
      ws.on('close', async (codigo, motivo) => {
        console.log(`\n  WebSocket cerrado (${codigo} ${String(motivo)}); sigo por sondeo`);
        for (;;) {
          const d = await api.documentos.obtener(c.documento) as unknown as { estado: string };
          if (d.estado === 'listo' || d.estado === 'error') return res({ tipo: 'fin', estado: d.estado } as never);
          await new Promise((r) => setTimeout(r, 3000));
        }
      });
      ws.on('error', (e) => console.log(`\n  error del WebSocket: ${e.message}`));
    });
    ws.close();
    const total = Date.now() - t;
    console.log(`\n  ${JSON.stringify(fin).slice(0, 200)}`);
    console.log(`  primera unidad legible a los ${s(primeraUnidad)}; listo para buscar a los ${s(total)} (imprenta ${s(tImprenta)}, subida ${s(tSubida - tImprenta)}, ingesta ${s(total - tSubida)})`);
  }
}

if (orden === 'buscar') {
  for (const consulta of resto) {
    const r = await api.busqueda.buscar({ consulta, k: 6 } as never);
    console.log(`\n«${consulta}»: ${r.ms} ms (${r.intencion})`);
    for (const x of r.resultados) console.log(`  ${x.citaCorta.padEnd(48)} [${x.vias.join('+')}] ${x.fragmento.texto.replace(/\s+/g, ' ').slice(0, 100)}…`);
  }
}

if (orden === 'preguntar') {
  const t = Date.now();
  let primera = 0;
  for await (const e of api.busqueda.responder({ consulta: resto.join(' ') } as never)) {
    if (e.tipo === 'texto') { if (!primera) primera = Date.now() - t; process.stdout.write(e.delta); }
    if (e.tipo === 'cita') console.log(`\n  [${e.n}] ${e.citaCorta}`);
    if (e.tipo === 'error') console.log(`\nERROR: ${e.mensaje}`);
  }
  console.log(`\n(primera palabra a los ${s(primera)}, total ${s(Date.now() - t)})`);
}
