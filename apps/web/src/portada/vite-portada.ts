/**
 * La portada en Vite: en desarrollo y en `vite preview` se sirve en /acerca y
 * /en; al construir se prerenderiza a `dist/acerca.html` y `dist/en.html`, que
 * el Worker sirve como estáticos (con `html_handling` por defecto, /acerca
 * encuentra acerca.html sin redirecciones).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer, type Plugin, type ResolvedConfig, type Connect } from 'vite';

const MODULO = '/src/portada/pagina.ts';

type Generador = { pagina: (l: 'es' | 'en') => string; PAGINAS: { lengua: 'es' | 'en'; fichero: string; ruta: string }[] };

function lenguaDe(url: string | undefined): 'es' | 'en' | null {
  const ruta = (url ?? '').split(/[?#]/)[0]!.replace(/\/$/, '') || '/';
  if (ruta === '/acerca' || ruta === '/acerca.html') return 'es';
  if (ruta === '/en' || ruta === '/en.html') return 'en';
  return null;
}

export function portada(): Plugin {
  let config: ResolvedConfig;
  const enviar = (res: import('node:http').ServerResponse, html: string) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  };
  return {
    name: 'scholaris-portada',
    configResolved(c) {
      config = c;
    },
    configureServer(servidor) {
      const mw: Connect.NextHandleFunction = async (req, res, next) => {
        const l = lenguaDe(req.url);
        if (!l) return next();
        try {
          const m = (await servidor.ssrLoadModule(MODULO)) as Generador;
          enviar(res, m.pagina(l));
        } catch (e) {
          next(e);
        }
      };
      servidor.middlewares.use(mw);
    },
    configurePreviewServer(servidor) {
      servidor.middlewares.use((req, res, next) => {
        const l = lenguaDe(req.url);
        if (!l) return next();
        const f = join(resolve(config.root, config.build.outDir), l === 'es' ? 'acerca.html' : 'en.html');
        if (!existsSync(f)) return next();
        enviar(res, readFileSync(f, 'utf8'));
      });
    },
    async closeBundle() {
      if (config.command !== 'build' || config.build.ssr) return;
      const vite = await createServer({
        configFile: false,
        root: config.root,
        logLevel: 'error',
        server: { middlewareMode: true, hmr: false, ws: false },
        appType: 'custom',
        optimizeDeps: { noDiscovery: true, include: [] },
      });
      try {
        const m = (await vite.ssrLoadModule(MODULO)) as Generador;
        const salida = resolve(config.root, config.build.outDir);
        for (const p of m.PAGINAS) {
          const html = m.pagina(p.lengua);
          writeFileSync(join(salida, p.fichero), html);
          config.logger.info(`portada: ${p.fichero} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
        }
      } finally {
        await vite.close();
      }
    },
  };
}
