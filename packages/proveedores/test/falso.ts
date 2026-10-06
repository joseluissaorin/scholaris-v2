/** `fetch` simulado para las pruebas: registra las llamadas y responde con lo que diga el manejador. */

export interface LlamadaFalsa {
  url: string;
  metodo: string;
  cabeceras: Record<string, string>;
  cuerpo: unknown;
  crudo: unknown;
}

type Respuesta = Response | Record<string, unknown> | unknown[] | { estado: number; cuerpo: unknown };

export function fetchFalso(manejador: (ll: LlamadaFalsa, n: number) => Respuesta | Promise<Respuesta>) {
  const llamadas: LlamadaFalsa[] = [];
  const f = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const cabeceras: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { cabeceras[k] = v; });
    let cuerpo: unknown = init.body;
    if (typeof init.body === 'string') { try { cuerpo = JSON.parse(init.body); } catch { cuerpo = init.body; } }
    const ll: LlamadaFalsa = { url: String(url), metodo: init.method ?? 'GET', cabeceras, cuerpo, crudo: init.body };
    llamadas.push(ll);
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const r = await manejador(ll, llamadas.length);
    if (r instanceof Response) return r;
    if (r && typeof r === 'object' && 'estado' in r && 'cuerpo' in r) {
      const x = r as { estado: number; cuerpo: unknown };
      return new Response(typeof x.cuerpo === 'string' ? x.cuerpo : JSON.stringify(x.cuerpo), { status: x.estado });
    }
    return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: f, llamadas };
}

/** Respuesta de generateContent de Gemini con un texto. */
export function respuestaGemini(texto: string, opciones: { fin?: string; entrada?: number; salida?: number; pensamiento?: number } = {}) {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text: texto }] }, finishReason: opciones.fin ?? 'STOP' }],
    usageMetadata: { promptTokenCount: opciones.entrada ?? 1000, candidatesTokenCount: opciones.salida ?? 200, thoughtsTokenCount: opciones.pensamiento ?? 0 },
  };
}

export function paginasJSON(desde: number, n: number, extra: (i: number) => Record<string, unknown> = () => ({})) {
  return JSON.stringify({
    paginas: Array.from({ length: n }, (_, i) => ({
      fisica: desde + i, vacia: false, cabecera: 'TITULILLO', folio: String(desde + i - 6), titulos: [],
      texto: `Texto de la página ${desde + i}, con bastante contenido para pasar el control de calidad.`,
      notas: [], pie: '', figuras: [], idioma: 'es', confianza: 0.95, ...extra(i),
    })),
  });
}

export const IMG = (n = 1) => Array.from({ length: n }, () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), mime: 'image/jpeg' }));

export async function pdfDePaginas(n: number): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([200, 300]);
  return doc.save();
}
