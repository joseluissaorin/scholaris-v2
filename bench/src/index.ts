/**
 * El banco de pruebas de Scholaris.
 *
 *   pnpm bench ingesta <archivo> [--digital capa|vision|auto] [--pliego N] [--concurrencia N] [--tramo S] [--sin-contexto] [--etiqueta X]
 *   pnpm bench comparar [etiqueta…]
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Agent, setGlobalDispatcher } from 'undici';
import { ingerir, type OpcionesBanco } from './ingesta.js';

// El fetch de Node 26 encola las peticiones simultáneas al mismo origen (8 llamadas
// a Gemini en paralelo acaban de una en una); con un Agent propio van de verdad en paralelo.
// keepAlive corto: Google cierra las conexiones ociosas y un POST sobre un socket ya cerrado falla («fallo de red»).
setGlobalDispatcher(new Agent({ connections: 128, keepAliveTimeout: 4_000, keepAliveMaxTimeout: 10_000, allowH2: true }));
import { compararTodo } from './comparar.js';

const [orden, ...resto] = process.argv.slice(2);

function opciones(args: string[]): { posicionales: string[]; o: OpcionesBanco } {
  const o: OpcionesBanco = {};
  const posicionales: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    const sig = () => args[++i] as string;
    if (a === '--digital') o.digital = sig() as OpcionesBanco['digital'];
    else if (a === '--pliego') o.pliego = Number(sig());
    else if (a === '--concurrencia') o.concurrencia = Number(sig());
    else if (a === '--tramo') o.tramo = Number(sig());
    else if (a === '--etiqueta') o.etiqueta = sig();
    else if (a === '--pista') o.pista = sig();
    else if (a === '--sin-contexto') o.sinContexto = true;
    else if (a === '--sin-figuras') o.sinFiguras = true;
    else if (a === '--sin-vista') o.sinVista = true;
    else if (a === '--original') o.original = true;
    else if (a === '--lector') o.lector = sig() as OpcionesBanco['lector'];
    else posicionales.push(a);
  }
  return { posicionales, o };
}

if (orden === 'ingesta') {
  const { posicionales, o } = opciones(resto);
  for (const r of posicionales) {
    // `pnpm bench` corre dentro de bench/: las rutas relativas se resuelven desde donde se lanzó.
    const ruta = existsSync(r) ? r : resolve(process.env.INIT_CWD ?? '.', r);
    const inf = await ingerir(ruta, o);
    console.log(JSON.stringify({ etiqueta: inf.etiqueta, ms: inf.ms, usd: inf.usd, unidades: inf.unidades, fragmentos: inf.fragmentos, folios: inf.folios, titulo: inf.metadatos.titulo }, null, 2));
  }
} else if (orden === 'comparar') {
  console.log(JSON.stringify(compararTodo(resto), null, 2));
} else {
  console.error('Uso: pnpm bench ingesta <archivo> [opciones] | pnpm bench comparar [etiqueta…]');
  process.exit(1);
}
