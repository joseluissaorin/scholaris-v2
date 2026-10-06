/**
 * Borrador del juego de consultas: Gemini lee cada documento entero (con los
 * ids de sus fragmentos) y propone consultas de varias clases con el pasaje que
 * las responde. El borrador se revisa y se completa a mano antes de pasar a
 * bench/calidad/consultas.json; aquí solo se genera la materia prima.
 *
 *   pnpm bench calidad proponer
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { anclaACita, type Ancla } from '@scholaris/nucleo';
import { DIR_DATOS_CALIDAD, mapaDocumentos } from './estanteria.js';
import { montar } from './montaje.js';

const CUANTAS: Record<string, number> = { Lewis: 30, Attention: 14, Perseguidor: 20, Casamiento: 15, Cabral: 18, CortazarTV: 26, '3b1b': 3, Audio: 0, Slerexe: 3 };

const SISTEMA = `Preparas el banco de pruebas de recuperación de una biblioteca académica. Recibes UN documento partido en fragmentos con su id.
Propón consultas de búsqueda REALISTAS, como las escribiría un investigador o un estudiante, y para cada una los ids de los fragmentos que la responden (1-4).
Mezcla estas clases (campo "clase"):
- "conceptual": una idea o pregunta formulada con OTRAS palabras que las del texto (paráfrasis, sin copiar términos raros del pasaje).
- "factual": un dato concreto (nombre, fecha, cifra, lugar) preguntado de forma natural.
- "literal": una frase textual del documento entre comillas «…» (6-14 palabras copiadas exactamente; en documentos antiguos con su grafía).
- "grafia": SOLO en textos antiguos: consulta en ortografía moderna sobre un pasaje con grafía antigua (o al revés), o términos latinos.
- "interlingue": la consulta en el OTRO idioma (si el documento está en español, la consulta en inglés; si está en inglés, en español).
- "medio": SOLO en audio/vídeo: lo que dice un hablante sobre un tema («¿qué dice X de …?»).
Reparte bien a lo largo de TODO el documento (principio, medio y final), evita preguntas triviales sobre la portada o los créditos, y que cada consulta tenga una respuesta clara en el documento.`;

const ESQUEMA = {
  type: 'object',
  properties: {
    consultas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          consulta: { type: 'string' },
          clase: { type: 'string', enum: ['conceptual', 'factual', 'literal', 'grafia', 'interlingue', 'medio'] },
          fragmentos: { type: 'array', items: { type: 'string' } },
          nota: { type: 'string' },
        },
        required: ['consulta', 'clase', 'fragmentos'],
      },
    },
  },
  required: ['consultas'],
};

export async function proponer(): Promise<void> {
  const m = montar();
  const docs = mapaDocumentos(m.sql.bd);
  const salida: unknown[] = [];
  await Promise.all([...docs].map(async ([id, d]) => {
    const n = CUANTAS[d.corto] ?? 0;
    if (!n) return;
    const frags = m.sql.bd.prepare('SELECT id, texto, ancla FROM fragmentos WHERE documento = ? ORDER BY orden').all(id) as Array<{ id: string; texto: string; ancla: string }>;
    const cuerpo = frags.map((f) => `[${f.id}] (${anclaACita(JSON.parse(f.ancla) as Ancla)})\n${f.texto}`).join('\n\n');
    const r = await m.redactor.generar<{ consultas: Array<{ consulta: string; clase: string; fragmentos: string[]; nota?: string }> }>({
      sistema: SISTEMA,
      mensajes: [{ rol: 'usuario', partes: [{ texto: `Documento: «${d.titulo}» (${d.autores ?? ''}, ${d.anio ?? 's. f.'}, ${d.tipo}, idioma ${d.idioma}). Propón ${n} consultas.\n\n${cuerpo}` }] }],
      esquema: ESQUEMA, temperatura: 0.7, maxTokens: 16_000, calidad: 'alta',
    });
    const validos = new Set(frags.map((f) => f.id));
    for (const c of r.json?.consultas ?? []) salida.push({ ...c, documento: d.corto, fragmentos: c.fragmentos.filter((x) => validos.has(x)) });
    console.error(`${d.corto}: ${r.json?.consultas.length ?? 0} consultas`);
  }));
  const ruta = join(DIR_DATOS_CALIDAD, 'propuestas.json');
  writeFileSync(ruta, JSON.stringify(salida, null, 1));
  console.error(`→ ${ruta} (${salida.length}); coste ${m.contador.total().usd.toFixed(3)} $`);
}
