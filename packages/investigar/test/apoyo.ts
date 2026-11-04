/**
 * Apoyo de las pruebas: una estantería en memoria (node:sqlite, SPDF 4.2 y
 * funciones) con un cuento escaneado y su película, y un modelo guionizado que
 * hace de planificador, agente, vista, redactor y verificador.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { Buscador } from '@scholaris/busqueda';
import { aplicarEsquemaFunciones } from '@scholaris/funciones';
import { sqlConLimite, type SQL, type ValorSQL } from '@scholaris/nucleo';
import type { LlamadaHerramienta, ModeloAgente, PeticionModelo, RespuestaModelo, TrozoModelo } from '../src/modelo.js';
import type { MediosInvestigar, PuertosInvestigar } from '../src/puertos.js';

const ESQUEMA = fileURLToPath(new URL('../../spdf/esquema/v4.2.sql', import.meta.url));

export type SQLPrueba = SQL & { bd: DatabaseSync };

export function crearSQL(): SQLPrueba {
  const bd = new DatabaseSync(':memory:');
  bd.exec(readFileSync(ESQUEMA, 'utf8'));
  const sql = {
    bd,
    async ejecutar<T>(consulta: string, ...parametros: ValorSQL[]): Promise<T[]> {
      const ps = parametros.map((p) => (p instanceof ArrayBuffer ? new Uint8Array(p) : p));
      return bd.prepare(consulta).all(...(ps as Array<string | number | null | Uint8Array>)) as T[];
    },
    async transaccion<T>(fn: (s: SQL) => Promise<T>): Promise<T> {
      bd.exec('BEGIN');
      try { const r = await fn(sql); bd.exec('COMMIT'); return r; } catch (e) { bd.exec('ROLLBACK'); throw e; }
    },
  };
  return Object.assign(sqlConLimite(sql), { bd });
}

export const CUENTO = 'doc-cuento';
export const PELICULA = 'doc-pelicula';

// Texto de prueba inspirado en el arranque del cuento (no es la edición): basta para anclar.
const PAGINAS = [
  { fisica: 2, impresa: '4', texto: 'Vino hasta mi mesa, y murmurando «con permiso» se instaló en la silla de enfrente con la copa de helado. Le eché una ojeada: habiendo chocolate, había pedido fresa. Así lo conocí en Coppelia.' },
  { fisica: 3, impresa: '6', texto: 'Diego hablaba sin parar de Lezama y de los libros que guardaba en La Guarida, su cuarto lleno de cosas viejas.' },
  { fisica: 15, impresa: '30', texto: 'Y quise cerrar el capítulo agradeciéndole a Diego lo que había hecho por mí, y lo hice viniendo a Coppelia y pidiendo un helado como éste. Porque había chocolate, pero pedí fresa.' },
];

const TRAMOS = [
  { t0: 107, t1: 120, texto: '**Vivian:** Aquí parece que vamos a hacer algo malo. **David:** Ya nosotros habíamos hablado.' },
  { t0: 594.6, t1: 641.8, texto: '**Diego:** No pude resistir la tentación. Me encanta la fresa. Es lo único bueno que hacen en este país.' },
  { t0: 6332.2, t1: 6386.4, texto: '**Diego:** ¡Uy! Una fresa. Hoy es mi día de suerte. **David:** Nadie es perfecto.' },
];

/** Instantes por palabra en el formato compacto de la ingesta (repartidos por igual). */
function palabras(texto: string, t0: number, t1: number) {
  const ps = texto.replace(/\*\*[^*]+:\*\*/g, '').split(/\s+/).filter(Boolean);
  const paso = Math.max(1, Math.round(((t1 - t0) * 100) / ps.length));
  return { v: 1, t0, cs: ps.flatMap((_, i) => [i * paso, paso]) };
}

export async function sembrar(sql: SQLPrueba): Promise<void> {
  await aplicarEsquemaFunciones(sql);
  const ahora = '2026-11-04T10:00:00Z';
  const doc = (id: string, tipo: string, m: Record<string, unknown>, unidades: number, duracion: number | null) => sql.bd.prepare(
    `INSERT INTO documentos (id, tipo, metadatos, estado, huella, original, mime, bytes, unidades, duracion, creado, actualizado, titulo, autores, anio, idioma)
     VALUES (?, ?, ?, 'listo', ?, '', ?, 1, ?, ?, ?, ?, ?, ?, ?, 'es')`,
  ).run(id, tipo, JSON.stringify(m), `h-${id}`, tipo === 'video' ? 'video/mp4' : 'application/pdf', unidades, duracion, ahora, ahora, String(m.titulo), 'x', Number(m.anio));
  doc(CUENTO, 'pdf_escaneado', { titulo: 'El lobo, el bosque y el hombre nuevo', autores: [{ nombre: 'Senel', apellidos: 'Paz' }], anio: 1994, anioOriginal: 1991, idioma: 'es' }, PAGINAS.length, null);
  doc(PELICULA, 'video', { titulo: 'Fresa y chocolate', autores: [{ nombre: 'Tomás', apellidos: 'Gutiérrez Alea' }, { nombre: 'Juan Carlos', apellidos: 'Tabío' }], anio: 1993, idioma: 'es' }, TRAMOS.length, 6638);
  PAGINAS.forEach((p, i) => {
    const ancla = { tipo: 'pagina', fisica: p.fisica, impresa: p.impresa, romana: false, origen: 'leido', confianza: 1 };
    sql.bd.prepare(`INSERT INTO unidades (id, documento, orden, ancla, texto, imagen, lector, confianza, impresa) VALUES (?, ?, ?, ?, ?, ?, 'prueba', 1, ?)`)
      .run(`${CUENTO}:u${i}`, CUENTO, i, JSON.stringify(ancla), p.texto, `paginas/${String(p.fisica).padStart(4, '0')}.jpg`, p.impresa);
    sql.bd.prepare(`INSERT INTO fragmentos (id, documento, unidad, orden, texto, contexto, seccion, ancla) VALUES (?, ?, ?, ?, ?, '', '[]', ?)`)
      .run(`${CUENTO}:f${i}`, CUENTO, `${CUENTO}:u${i}`, i, p.texto, JSON.stringify(ancla));
  });
  TRAMOS.forEach((t, i) => {
    const ancla = { tipo: 'tiempo', t0: t.t0, t1: t.t1, hablante: /\*\*([^*]+):/.exec(t.texto)?.[1] };
    sql.bd.prepare(`INSERT INTO unidades (id, documento, orden, ancla, texto, lector, confianza, t0, t1, palabras) VALUES (?, ?, ?, ?, ?, 'transcripcion', 1, ?, ?, ?)`)
      .run(`${PELICULA}:u${i}`, PELICULA, i, JSON.stringify(ancla), t.texto, t.t0, t.t1, JSON.stringify(palabras(t.texto, t.t0, t.t1)));
    sql.bd.prepare(`INSERT INTO fragmentos (id, documento, unidad, orden, texto, contexto, seccion, ancla) VALUES (?, ?, ?, ?, ?, '', '[]', ?)`)
      .run(`${PELICULA}:f${i}`, PELICULA, `${PELICULA}:u${i}`, i, t.texto, JSON.stringify(ancla));
  });
  sql.bd.prepare(`INSERT INTO figuras (id, documento, unidad, imagen, descripcion, ancla) VALUES ('fig1', ?, ?, 'fotogramas/0001.jpg', 'Diego llega a la mesa con una copa de helado de fresa.', ?)`)
    .run(PELICULA, `${PELICULA}:u1`, JSON.stringify({ tipo: 'tiempo', t0: 600, t1: 600 }));
  // El grafo: Diego en las dos obras.
  sql.bd.prepare(`INSERT INTO entidades (id, tipo, clave, nombre, alias, busqueda, n_menciones, n_documentos, creada, actualizada) VALUES ('ent-diego', 'persona', 'diego', 'Diego', '[]', '|diego|', 2, 2, ?, ?)`).run(ahora, ahora);
  sql.bd.prepare(`INSERT INTO menciones (id, entidad, documento, fragmento, orden, texto, normalizado, tipo, ini, fin, ancla) VALUES ('m1', 'ent-diego', ?, ?, 1, 'Diego', 'Diego', 'persona', 0, 5, ?)`)
    .run(CUENTO, `${CUENTO}:f1`, JSON.stringify({ tipo: 'pagina', fisica: 3, impresa: '6', romana: false, origen: 'leido', confianza: 1 }));
  sql.bd.prepare(`INSERT INTO menciones (id, entidad, documento, fragmento, orden, texto, normalizado, tipo, ini, fin, ancla) VALUES ('m2', 'ent-diego', ?, ?, 1, 'Diego', 'Diego', 'persona', 2, 7, ?)`)
    .run(PELICULA, `${PELICULA}:f1`, JSON.stringify({ tipo: 'tiempo', t0: 594.6, t1: 641.8 }));
}

/** Medios falsos: una «URI» para la película y bytes para las páginas. */
export const medios: MediosInvestigar = {
  async fuente(d) { return d === PELICULA ? { uri: 'https://archivos/fresa', mime: 'video/mp4' } : null; },
  async imagen(_d, clave) { return { bytes: new TextEncoder().encode(clave), mime: 'image/jpeg' }; },
  async url(d, clave) { return `https://img/${d}/${clave}`; },
};

const uso = (modelo = 'guion') => ({ modelo, entrada: 100, salida: 50, cache: 0, usd: 0.001, ms: 1 });

export type Guion = (p: PeticionModelo, n: number) => { texto?: string; llamadas?: LlamadaHerramienta[]; json?: unknown };

/** Un modelo que responde según un guion (y guarda lo que se le pidió). */
export class ModeloGuion implements ModeloAgente {
  readonly nombre = 'guion';
  readonly peticiones: PeticionModelo[] = [];
  constructor(private guion: Guion) {}
  async turno(p: PeticionModelo): Promise<RespuestaModelo> {
    this.peticiones.push(p);
    const r = this.guion(p, this.peticiones.length);
    const texto = r.texto ?? (r.json !== undefined ? JSON.stringify(r.json) : '');
    const llamadas = r.llamadas ?? [];
    return {
      mensaje: { rol: 'modelo', partes: [...(texto ? [{ tipo: 'texto' as const, texto }] : []), ...llamadas.map((l) => ({ tipo: 'llamada' as const, ...l }))] },
      texto, llamadas, ...(r.json !== undefined ? { json: r.json } : {}), uso: uso(),
    };
  }
  async *flujo(p: PeticionModelo): AsyncGenerator<TrozoModelo> {
    const r = await this.turno(p);
    // Por trozos pequeños, para probar que las marcas partidas se recomponen.
    for (let i = 0; i < r.texto.length; i += 7) yield { delta: r.texto.slice(i, i + 7) };
    yield { uso: uso() };
  }
}

/** Texto de la primera petición del usuario. */
export const textoDe = (p: PeticionModelo) => p.mensajes.flatMap((m) => m.partes).map((x) => (x.tipo === 'texto' ? x.texto : '')).join('\n');

/** Un guion completo: plan, tres turnos de herramientas, visión, redacción y verificación. */
export function guionCompleto(): Guion {
  let turnoAgente = 0;
  return (p) => {
    const t = textoDe(p);
    const esquema = JSON.stringify(p.esquema ?? {});
    if (esquema.includes('subpreguntas')) {
      return { json: { enfoque: 'Comparar Coppelia en las dos obras.', documentos: [{ id: CUENTO, papel: 'el cuento' }, { id: PELICULA, papel: 'la película' }, { id: 'no-existe', papel: 'x' }], subpreguntas: [{ pregunta: '¿Qué pasa en Coppelia en el cuento?', pruebas: ['literal'], documentos: [CUENTO] }, { pregunta: '¿Cómo se filma?', pruebas: ['visual', 'inventada'] }], idiomas: ['es'], idiomaRespuesta: 'es' } };
    }
    if (esquema.includes('observaciones')) {
      return { json: { respuesta: 'Diego entra en plano medio y domina el encuadre.', observaciones: [
        { desde: '10:00', hasta: '10:04', clase: 'plano', descripcion: 'Plano medio de Diego con la copa de helado; ocupa el centro del encuadre.', caja: [100, 300, 900, 700], personas: ['Diego'] },
        { desde: '10:05', clase: 'dialogo', descripcion: 'Diego elogia la fresa.', cita: 'Me encanta la fresa' },
        { desde: '3:00:00', clase: 'accion', descripcion: 'Fuera del tramo: se descarta.' },
      ] } };
    }
    // Volver a mirar: todas las afirmaciones se ven.
    if (esquema.includes('juicios')) return { json: { juicios: [...t.matchAll(/^(\d+)\. /gm)].map((m) => ({ n: Number(m[1]), veredicto: 'si', nota: 'Se ve.' })) } };
    // Corregir: nada que corregir (devuelve la frase igual).
    if (p.sistema?.startsWith('Corriges')) return { json: { frases: [...t.matchAll(/^### Frase (\d+)\n(.*)$/gm)].map((m) => ({ i: Number(m[1]), texto: m[2] })) } };
    if (esquema.includes('"frases"')) return { json: juicioDeFrases(t) };
    if (p.herramientas?.length) {
      turnoAgente++;
      if (turnoAgente === 1) return { llamadas: [{ nombre: 'mapa', args: { documento: PELICULA } }, { nombre: 'buscar', args: { consulta: 'Coppelia helado fresa', documentos: [CUENTO] } }] };
      if (turnoAgente === 2) return { llamadas: [{ id: 'a1', nombre: 'leer', args: { documento: PELICULA, tiempo: { desde: '9:50', hasta: '10:45' } } }, { nombre: 'ver', args: { documento: PELICULA, tiempo: { desde: '9:50', hasta: '10:45' }, pregunta: '¿Quién domina el encuadre?' } }] };
      if (turnoAgente === 3) return { llamadas: [{ nombre: 'anotar', args: { tipo: 'hallazgo', texto: 'La fresa marca a Diego en las dos obras.', pruebas: ['P1'] } }] };
      return { texto: 'Hay pruebas suficientes.' };
    }
    // La redacción: cita las pruebas que encuentra en el cuaderno.
    const cuento = /\[(P\d+)\][^\n]*p\. 4/.exec(t)?.[1];
    const vista = /\[(P\d+)\][^\n]*instante 600/.exec(t)?.[1];
    const dialogo = [...t.matchAll(/\[(P\d+)\][^\n]*9:54/g)].map((m) => m[1])[0] ?? /\[(P\d+)\][^\n]*habla: Diego/.exec(t)?.[1];
    return {
      texto: `### Coppelia\n\nEn el cuento, Diego llega a la mesa del narrador y «habiendo chocolate, había pedido fresa» [${cuento}]. En la película Diego domina el encuadre al llegar [${vista}], y dice: «Me encanta la fresa» [${dialogo}]. Una marca inventada [P999] desaparece.\n\n| Obra | Fresa |\n|---|---|\n| Cuento | marca a Diego [${cuento}] |\n\nCabe leerlo como una seña de identidad compartida por las dos obras.`,
    };
  };
}

export function puertos(sql: SQLPrueba, modelo: ModeloAgente, conMedios = true): PuertosInvestigar {
  return { sql, buscador: new Buscador({ sql }), modelos: { agente: modelo }, ...(conMedios ? { medios } : {}), usuario: { id: 'u1', pro: true }, ahora: () => Date.now() };
}

/**
 * El juicio del verificador falso: cada marca sostiene su frase; la frase es visual si habla
 * de encuadre o de plano, e interpretación si no lleva marcas.
 */
export function juicioDeFrases(t: string, veredicto: (frase: string, marca: string) => string = () => 'sostiene') {
  const frases = [...t.matchAll(/^(\d+)\. (.*?)(?: \[marcas: ([^\]]+)\]| \[sin marcas\])$/gm)].map((m) => ({ i: Number(m[1]), texto: m[2]!, marcas: m[3] ? m[3].split(/,\s*/) : [] }));
  return {
    frases: frases.map((f) => ({
      i: f.i,
      clase: !f.marcas.length ? 'interpretacion' : /encuadre|plano/.test(f.texto) ? 'visual' : 'hecho',
      marcas: f.marcas.map((marca) => ({ marca, veredicto: veredicto(f.texto, marca) })),
    })),
  };
}
