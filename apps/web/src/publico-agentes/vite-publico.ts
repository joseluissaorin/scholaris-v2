/**
 * La parte pública para personas, buscadores y agentes, en Vite: en desarrollo
 * sirve cada hoja (/saber/…, /en/knowledge/…, /agentes, /en/agents), sus .md,
 * /llms.txt, /llms-full.txt, robots.txt, sitemap.xml y /.well-known; al
 * construir lo escribe todo en dist (ver emitir.ts).
 *
 * La fecha de revisión de cada hoja es la del último commit que tocó su texto
 * (o hoy, si no hay git).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createServer, type Connect, type Plugin, type ResolvedConfig, type ViteDevServer } from 'vite';

const MODULO = '/src/publico-agentes/emitir.ts';

type Emisor = {
  ficheros: (f: (ruta: string) => string) => [string, string][];
  rutasPublicas: () => { ruta: string; pagina?: { clave: string } }[];
};

const TIPOS: Record<string, string> = {
  html: 'text/html; charset=utf-8', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8', json: 'application/json',
};

/** Fecha del último commit que tocó estos ficheros (AAAA-MM-DD), o hoy. */
function fechaGit(raiz: string, rutas: string[]): string {
  try {
    const f = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...rutas], { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
  } catch { /* sin git */ }
  return new Date().toISOString().slice(0, 10);
}

function fechas(raiz: string, m: Emisor): (ruta: string) => string {
  const cache = new Map<string, string>();
  const fuente = (ruta: string, clave?: string): string[] => {
    if (clave) return [`src/publico-agentes/contenido/${clave}.ts`];
    if (ruta === '/acerca' || ruta === '/en') return ['src/portada/textos.ts'];
    if (ruta === '/api' || ruta === '/en/api') return ['src/guia-api/textos.ts', '../../packages/contrato/src/v1.ts'];
    return ['src/publico-agentes'];
  };
  const claves = new Map(m.rutasPublicas().map((r) => [r.ruta, r.pagina?.clave]));
  return (ruta) => {
    if (!cache.has(ruta)) cache.set(ruta, fechaGit(raiz, fuente(ruta, claves.get(ruta))));
    return cache.get(ruta)!;
  };
}

export function publicoAgentes(): Plugin {
  let config: ResolvedConfig;
  const generar = async (vite: ViteDevServer) => {
    const m = (await vite.ssrLoadModule(MODULO)) as Emisor;
    return m.ficheros(fechas(config.root, m));
  };
  return {
    name: 'scholaris-publico-agentes',
    configResolved(c) {
      config = c;
    },
    configureServer(servidor) {
      const mw: Connect.NextHandleFunction = async (req, res, next) => {
        const ruta = (req.url ?? '').split(/[?#]/)[0]!.replace(/\/$/, '') || '/';
        if (!/^\/(saber|agentes|en\/knowledge|en\/agents|llms|robots\.txt|sitemap\.xml|\.well-known\/(mcp|api-catalog|security|agent-skills))|\.md$/.test(ruta)) return next();
        try {
          const todos = await generar(servidor);
          const quiereMd = /text\/markdown/.test(String(req.headers.accept ?? ''));
          const buscado = ruta.slice(1);
          const f = todos.find(([n]) => n === buscado || n === `${buscado}.html` || (quiereMd && n === `${buscado}.md`));
          if (!f) return next();
          const ext = /\.([a-z]+)$/.exec(f[0])?.[1] ?? 'json';
          res.statusCode = 200;
          res.setHeader('content-type', TIPOS[ext] ?? 'application/json');
          res.end(f[1]);
        } catch (e) {
          next(e);
        }
      };
      servidor.middlewares.use(mw);
    },
    async closeBundle() {
      if (config.command !== 'build' || config.build.ssr) return;
      const vite = await createServer({
        configFile: false, root: config.root, logLevel: 'error',
        server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
        optimizeDeps: { noDiscovery: true, include: [] },
      });
      try {
        const salida = resolve(config.root, config.build.outDir);
        const todos = await generar(vite);
        let bytes = 0;
        for (const [nombre, contenido] of todos) {
          const destino = join(salida, nombre);
          mkdirSync(dirname(destino), { recursive: true });
          writeFileSync(destino, contenido);
          bytes += Buffer.byteLength(contenido);
        }
        const origen = (await vite.ssrLoadModule('/src/publico-agentes/origen.ts')) as { ORIGEN: string };
        config.logger.info(`público para agentes: ${todos.length} ficheros (${(bytes / 1024).toFixed(0)} KB) para ${origen.ORIGEN}`);
      } finally {
        await vite.close();
      }
    },
  };
}
