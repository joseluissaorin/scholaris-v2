/**
 * Servidor MCP de tu biblioteca (transporte «Streamable HTTP», sin estado,
 * respuestas JSON). Herramientas: search, cite, open_page, verify_claim.
 * La puerta lo publica en /mcp con la misma autenticación (token de Clerk o
 * clave de API con el alcance «mcp») y lo entrega aquí, dentro de la
 * estantería del usuario.
 */
import type { Hono } from 'hono';
import { anclaACita, repararMarcasHablante, type Ancla } from '@scholaris/nucleo';
import { citaDocumento, verificarAfirmacion } from '@scholaris/citas';
import type { Entorno } from '../entorno.js';
import { obtenerBuscador } from '../compartido/servicios.js';
import { VERSION } from '../version.js';
import type { PuertosUsuario } from '../puertos.js';
import { citaCorta, puertos, type Ctx } from './util.js';

interface PeticionRpc { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }

const HERRAMIENTAS = [
  {
    name: 'search',
    description: 'Busca en la biblioteca del usuario (búsqueda híbrida léxica + semántica). Devuelve pasajes con su referencia exacta (página impresa, minuto, sección).',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Qué buscar, en lenguaje natural o entre comillas para una cita literal.' }, k: { type: 'integer', minimum: 1, maximum: 50, default: 8 }, documents: { type: 'array', items: { type: 'string' }, description: 'Restringir a estos documentos.' }, library: { type: 'string', description: 'Restringir a esta biblioteca.' } }, required: ['query'] },
  },
  {
    name: 'cite',
    description: 'Devuelve la cita formateada de un pasaje (por su id de fragmento) o de un documento, en el estilo CSL pedido, con la página exacta.',
    inputSchema: { type: 'object', properties: { fragment: { type: 'string' }, document: { type: 'string' }, style: { type: 'string', default: 'apa' }, locale: { type: 'string', default: 'es-ES' } } },
  },
  {
    name: 'open_page',
    description: 'Abre una página (o unidad: diapositiva, tramo de tiempo) de un documento y devuelve su texto completo. Se puede pedir por posición física o por el número impreso.',
    inputSchema: { type: 'object', properties: { document: { type: 'string' }, page: { type: 'integer', description: 'Posición física desde 1.' }, printed: { type: 'string', description: 'Número de página impreso (p. ej. «145» o «xiv»).' } }, required: ['document'] },
  },
  {
    name: 'verify_claim',
    description: 'Comprueba si la biblioteca respalda una afirmación y devuelve los pasajes que la apoyan o la contradicen, con su referencia.',
    inputSchema: { type: 'object', properties: { claim: { type: 'string' }, year: { type: 'integer', description: 'Año del texto que hace la afirmación (lógica temporal).' } }, required: ['claim'] },
  },
];

const texto = (t: string) => ({ content: [{ type: 'text', text: t }] });

async function llamar(p: PuertosUsuario, nombre: string, a: Record<string, unknown>): Promise<unknown> {
  switch (nombre) {
    case 'search': {
      const b = await obtenerBuscador(p);
      const filtros = { ...(Array.isArray(a.documents) ? { documentos: a.documents as string[] } : {}), ...(typeof a.library === 'string' ? { bibliotecas: [a.library] } : {}) };
      const r = await b.buscar(String(a.query ?? ''), { limite: Math.min(50, Number(a.k ?? 8)), filtros });
      const lineas = r.resultados.map((x, i) => `[${i + 1}] ${citaCorta(x.documento.metadatos, x.fragmento.ancla, x.fragmento.anclaFin)}: «${x.documento.metadatos.titulo}» (documento ${x.documento.id}, fragmento ${x.fragmento.id})\n${repararMarcasHablante(x.fragmento.texto)}`);
      return { ...texto(lineas.join('\n\n') || 'Sin resultados.'), structuredContent: { results: r.resultados.map((x) => ({ fragment: x.fragmento.id, document: x.documento.id, title: x.documento.metadatos.titulo, locator: anclaACita(x.fragmento.ancla, x.fragmento.anclaFin), text: x.fragmento.texto, score: x.puntuacion })) } };
    }
    case 'cite': {
      let docId = typeof a.document === 'string' ? a.document : undefined;
      let localizador = '';
      if (typeof a.fragment === 'string') {
        const [f] = await p.sql.ejecutar<{ documento: string; ancla: string; ancla_fin: string | null }>('SELECT documento, ancla, ancla_fin FROM fragmentos WHERE id = ?', a.fragment);
        if (!f) return { ...texto('Ese fragmento no existe.'), isError: true };
        docId = f.documento;
        localizador = anclaACita(JSON.parse(f.ancla) as Ancla, f.ancla_fin ? (JSON.parse(f.ancla_fin) as Ancla) : undefined);
      }
      if (!docId) return { ...texto('Indica «fragment» o «document».'), isError: true };
      const [d] = await p.sql.ejecutar<{ id: string; tipo: string; metadatos: string }>('SELECT id, tipo, metadatos FROM documentos WHERE id = ?', docId);
      if (!d) return { ...texto('Ese documento no existe.'), isError: true };
      const c = await citaDocumento({ id: d.id, tipo: d.tipo as never, metadatos: JSON.parse(d.metadatos) }, { estilo: String(a.style ?? 'apa'), idioma: String(a.locale ?? 'es-ES') });
      return texto(localizador ? `${c.texto}\nLocalizador: ${localizador}` : c.texto);
    }
    case 'open_page': {
      const doc = String(a.document ?? '');
      const filas = typeof a.printed === 'string'
        ? await p.sql.ejecutar<{ orden: number; texto: string; ancla: string }>('SELECT orden, texto, ancla FROM unidades WHERE documento = ? AND impresa = ? ORDER BY orden LIMIT 1', doc, a.printed)
        : await p.sql.ejecutar<{ orden: number; texto: string; ancla: string }>('SELECT orden, texto, ancla FROM unidades WHERE documento = ? AND orden = ?', doc, Number(a.page ?? 1));
      const u = filas[0];
      if (!u) return { ...texto('No encuentro esa página en el documento.'), isError: true };
      return texto(`${anclaACita(JSON.parse(u.ancla) as Ancla)} (posición ${u.orden})\n\n${u.texto}`);
    }
    case 'verify_claim': {
      const ia = await p.inteligencia();
      const r = await verificarAfirmacion(String(a.claim ?? ''), { buscador: await obtenerBuscador(p), juez: ia.juez }, { ...(a.year ? { anioTexto: Number(a.year) } : {}) });
      const lineas = r.citas.map((x) => `- ${x.citaCorta} [${x.relacion}, respaldo ${x.respaldo.toFixed(2)}]: «${x.pasaje}»`);
      return { ...texto(`Veredicto: ${r.veredicto}\n${lineas.join('\n')}`), structuredContent: r };
    }
    default:
      return { ...texto(`Herramienta desconocida: ${nombre}`), isError: true };
  }
}

export function rutasMcp(app: Hono<Entorno>): void {
  app.get('/mcp', (c: Ctx) => c.json({ error: { codigo: 'peticion_invalida', mensaje: 'Este servidor MCP no abre flujos SSE: usa POST.' } }, 405));
  app.post('/mcp', async (c: Ctx) => {
    const p = puertos(c);
    const cuerpo = (await c.req.json()) as PeticionRpc | PeticionRpc[];
    const lista = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
    const respuestas = [];
    for (const m of lista) {
      if (m.id === undefined || m.id === null) continue; // notificaciones: sin respuesta
      try {
        let result: unknown;
        if (m.method === 'initialize') {
          result = {
            protocolVersion: (m.params?.protocolVersion as string) ?? '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'scholaris', title: 'Scholaris: tu biblioteca', version: VERSION },
            instructions: 'Busca en la biblioteca del usuario y cita con página exacta. Cita solo lo que devuelvan las herramientas.',
          };
        } else if (m.method === 'ping') result = {};
        else if (m.method === 'tools/list') result = { tools: HERRAMIENTAS };
        else if (m.method === 'tools/call') result = await llamar(p, String(m.params?.name ?? ''), (m.params?.arguments as Record<string, unknown>) ?? {});
        else {
          respuestas.push({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Método no admitido: ${m.method}` } });
          continue;
        }
        respuestas.push({ jsonrpc: '2.0', id: m.id, result });
      } catch (e) {
        respuestas.push({ jsonrpc: '2.0', id: m.id, result: { ...texto(`Error: ${(e as Error).message}`), isError: true } });
      }
    }
    if (!respuestas.length) return c.body(null, 202);
    return c.json(Array.isArray(cuerpo) ? respuestas : respuestas[0]);
  });
}
