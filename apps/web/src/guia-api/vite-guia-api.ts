/**
 * La guía de la API en Vite: en desarrollo se sirve en /api, /en/api y
 * /llms.txt; al construir se prerenderiza a `dist/api.html`,
 * `dist/en/api.html` y `dist/llms.txt`, que el Worker y la versión local
 * sirven como estáticos.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createServer, type Connect, type Plugin, type ResolvedConfig } from 'vite';

const MODULO = '/src/guia-api/pagina.ts';

type Generador = {
  pagina: (l: 'es' | 'en') => string;
  llmsTxt: () => string;
  PAGINAS: { lengua: 'es' | 'en'; fichero: string; ruta: string }[];
};

function rutaDe(url: string | undefined): string {
  return (url ?? '').split(/[?#]/)[0]!.replace(/\.html$/, '').replace(/\/$/, '') || '/';
}

export function guiaApi(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'scholaris-guia-api',
    configResolved(c) {
      config = c;
    },
    configureServer(servidor) {
      const mw: Connect.NextHandleFunction = async (req, res, next) => {
        const ruta = rutaDe(req.url);
        if (ruta !== '/api' && ruta !== '/en/api' && ruta !== '/llms.txt') return next();
        try {
          const m = (await servidor.ssrLoadModule(MODULO)) as Generador;
          res.statusCode = 200;
          if (ruta === '/llms.txt') {
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            return res.end(m.llmsTxt());
          }
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(m.pagina(ruta === '/api' ? 'es' : 'en'));
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
        const m = (await vite.ssrLoadModule(MODULO)) as Generador;
        const salida = resolve(config.root, config.build.outDir);
        for (const p of m.PAGINAS) {
          const destino = join(salida, p.fichero);
          mkdirSync(dirname(destino), { recursive: true });
          const html = m.pagina(p.lengua);
          writeFileSync(destino, html);
          config.logger.info(`guía de la API: ${p.fichero} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
        }
        writeFileSync(join(salida, 'llms.txt'), m.llmsTxt());
      } finally {
        await vite.close();
      }
    },
  };
}
