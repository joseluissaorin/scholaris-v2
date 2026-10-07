/**
 * /demo/…: la demostración en vídeo de la portada, servida desde R2
 * (publico/demo/…), porque los estáticos de Workers no admiten ficheros de más
 * de 25 MB. Pública (sin sesión), con Range (206) para que Safari e iOS puedan
 * saltar, ETag y caché larga e inmutable: los nombres llevan la versión.
 *
 * Con la Cache API (solo en dominios propios; en workers.dev no guarda nada),
 * el objeto entero se guarda en la caché de la ubicación y los Range se
 * resuelven allí; mientras no está, se sirven desde R2.
 */
export const PREFIJO_DEMO_R2 = 'publico/demo/';

const RUTA = /^\/demo\/([a-z0-9][a-z0-9._-]{0,96}\.(mp4|webm|webp|jpg|png|vtt))$/;

const TIPOS: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png', vtt: 'text/vtt; charset=utf-8',
};

export const CACHE_DEMO = 'public, max-age=31536000, immutable';

/** Un solo intervalo de «Range: bytes=…»; null si no hay o no se entiende (se sirve entero). */
export function leerRango(cabecera: string | null, tam: number): { inicio: number; fin: number } | 'fuera' | null {
  if (!cabecera) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(cabecera.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const sufijo = Number(m[2]);
    if (sufijo === 0) return 'fuera';
    return { inicio: Math.max(0, tam - sufijo), fin: tam - 1 };
  }
  const inicio = Number(m[1]);
  const fin = m[2] === '' ? tam - 1 : Math.min(Number(m[2]), tam - 1);
  if (inicio >= tam || fin < inicio) return 'fuera';
  return { inicio, fin };
}

function cabeceras(obj: R2Object, tipo: string): Headers {
  const h = new Headers();
  h.set('content-type', tipo);
  h.set('etag', obj.httpEtag);
  h.set('last-modified', obj.uploaded.toUTCString());
  h.set('accept-ranges', 'bytes');
  h.set('cache-control', CACHE_DEMO);
  h.set('access-control-allow-origin', '*');
  h.set('x-content-type-options', 'nosniff');
  return h;
}

const sinEtag = (e: string) => e.replace(/^W\//, '').replace(/"/g, '').trim();

const rellenando = new Set<string>();

export interface OpcionesDemo {
  cache?: Cache;
  esperar?: (p: Promise<unknown>) => void;
}

/** Devuelve la respuesta de /demo/…, o null si la ruta no es suya. */
export async function servirDemo(peticion: Request, bucket: R2Bucket, o: OpcionesDemo = {}): Promise<Response | null> {
  const url = new URL(peticion.url);
  if (!url.pathname.startsWith('/demo/')) return null;
  const m = RUTA.exec(url.pathname);
  if (!m) return new Response('No encontrado', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
    return new Response('Método no permitido', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const clave = `${PREFIJO_DEMO_R2}${m[1]}`;
  const tipo = TIPOS[m[2]!]!;
  const claveCache = `${url.origin}${url.pathname}`;

  if (o.cache && peticion.method === 'GET') {
    const h = new Headers();
    for (const n of ['range', 'if-none-match', 'if-modified-since']) {
      const v = peticion.headers.get(n);
      if (v) h.set(n, v);
    }
    const guardada = await o.cache.match(new Request(claveCache, { headers: h }));
    if (guardada) return guardada;
  }

  const cabeza = await bucket.head(clave);
  if (!cabeza) return new Response('No encontrado', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const h = cabeceras(cabeza, tipo);

  const condicion = peticion.headers.get('if-none-match');
  if (condicion && condicion.split(',').some((e) => e.trim() === '*' || sinEtag(e) === cabeza.etag)) {
    return new Response(null, { status: 304, headers: h });
  }

  const rango = leerRango(peticion.headers.get('range'), cabeza.size);
  if (rango === 'fuera') {
    h.set('content-range', `bytes */${cabeza.size}`);
    return new Response(null, { status: 416, headers: h });
  }

  // Mientras la caché de esta ubicación no lo tenga, se rellena con el objeto entero (una vez por isolate).
  if (o.cache && o.esperar && peticion.method === 'GET' && !rellenando.has(claveCache)) {
    rellenando.add(claveCache);
    const cache = o.cache;
    o.esperar((async () => {
      try {
        const entero = await bucket.get(clave);
        if (!entero) return;
        const hc = cabeceras(entero, tipo);
        hc.set('content-length', String(entero.size));
        await cache.put(claveCache, new Response(entero.body, { status: 200, headers: hc }));
      } catch { /* la caché es un extra */ } finally {
        rellenando.delete(claveCache);
      }
    })());
  }

  if (rango) {
    const largo = rango.fin - rango.inicio + 1;
    h.set('content-range', `bytes ${rango.inicio}-${rango.fin}/${cabeza.size}`);
    h.set('content-length', String(largo));
    if (peticion.method === 'HEAD') return new Response(null, { status: 206, headers: h });
    const parte = await bucket.get(clave, { range: { offset: rango.inicio, length: largo } });
    if (!parte) return new Response('No encontrado', { status: 404 });
    return new Response(parte.body, { status: 206, headers: h });
  }

  h.set('content-length', String(cabeza.size));
  if (peticion.method === 'HEAD') return new Response(null, { status: 200, headers: h });
  const entero = await bucket.get(clave);
  if (!entero) return new Response('No encontrado', { status: 404 });
  return new Response(entero.body, { status: 200, headers: h });
}
