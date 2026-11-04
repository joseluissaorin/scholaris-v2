/**
 * Lo que se le pide al modelo en cada ventana: instrucciones de especialista
 * según la lente y el medio, y el esquema JSON (listas planas, fáciles de
 * fusionar entre ventanas).
 */
import type { Lente, PersonaPercibida } from '@scholaris/nucleo';
import { marca } from './ventanas.js';

/** Versión del prompt y del esquema: entra en la clave de lo grabado. */
export const VERSION_PERCEPCION = 'percepcion-2';

export const ESCALAS = ['gran plano general', 'plano general', 'plano entero', 'plano americano', 'plano medio', 'plano medio corto', 'primer plano', 'primerísimo primer plano', 'plano detalle'] as const;
export const ANGULACIONES = ['normal', 'picado', 'contrapicado', 'cenital', 'nadir', 'aberrante'] as const;
export const MOVIMIENTOS = ['fija', 'panorámica', 'travelling', 'grúa', 'cámara en mano', 'zoom', 'steadicam', 'combinado'] as const;
export const CLASES_SONIDO = ['musica', 'cancion', 'silencio', 'ambiente', 'efecto', 'voz_fuera', 'otro'] as const;

const T = { type: 'string', description: 'Marca H:MM:SS.s contada desde el principio de la obra completa.' };

const LOCALIZADO = {
  type: 'object',
  properties: {
    nombre: { type: 'string', description: 'Nombre del reparto, o una descripción breve si no se sabe quién es («hombre de bigote»). En objetos, qué objeto es.' },
    caja: { type: 'array', items: { type: 'integer' }, description: '[ymin, xmin, ymax, xmax] normalizados a 0-1000 en el fotograma de «instante».' },
    instante: T,
    nota: { type: 'string', description: 'Qué hace la persona, o qué significa el objeto en la obra.' },
  },
  required: ['nombre'],
};

export function esquemaVentana(medio: 'video' | 'audio'): Record<string, unknown> {
  const escena = {
    type: 'object',
    properties: {
      inicio: T, fin: T,
      titulo: { type: 'string', description: 'Título breve y descriptivo de la escena (o del bloque).' },
      lugar: { type: 'string' },
      tiempo: { type: 'string', description: 'Día, noche, época, si se sabe.' },
      personas: { type: 'array', items: { type: 'string' }, description: 'Quién está presente (visto u oído), con los nombres del reparto.' },
      accion: { type: 'string', description: 'Qué pasa, en dos a cuatro frases.' },
      transicion: { type: 'string', description: 'Cómo se entra en la escena: corte, fundido, encadenado, elipsis, montaje paralelo, analepsis…' },
      notas: { type: 'string', description: medio === 'video' ? 'Lo significativo para el análisis: símbolos, motivos, relación con el resto de la obra.' : 'Tono, prosodia, risas, pausas, solapamientos y papel de cada voz.' },
    },
    required: ['inicio', 'fin', 'titulo', 'personas', 'accion'],
  };
  const sonido = {
    type: 'object',
    properties: {
      inicio: T, fin: T,
      clase: { type: 'string', enum: [...CLASES_SONIDO] },
      diegetico: { type: 'boolean', description: 'Suena dentro del mundo de la obra (lo oyen los personajes).' },
      descripcion: { type: 'string' },
      obra: { type: 'string', description: 'Pieza o canción reconocida (título y autor), si se reconoce con seguridad.' },
    },
    required: ['inicio', 'fin', 'clase', 'descripcion'],
  };
  const dialogo = {
    type: 'object',
    properties: { t: T, hablante: { type: 'string' }, texto: { type: 'string', description: 'Cita literal de la transcripción.' } },
    required: ['t', 'texto'],
  };
  const persona = {
    type: 'object',
    properties: {
      nombre: { type: 'string' },
      ficticia: { type: 'boolean', description: 'Personaje (true) o persona real (false).' },
      actor: { type: 'string' },
      descripcionVisual: { type: 'string', description: 'Cómo reconocerlo en imagen: edad, pelo, ropa, rasgos.' },
      voz: { type: 'string', description: 'Cómo reconocer su voz.' },
    },
    required: ['nombre'],
  };
  const props: Record<string, unknown> = {
    escenas: { type: 'array', items: escena },
    sonidos: { type: 'array', items: sonido },
    dialogos: { type: 'array', items: dialogo, description: 'Las frases clave de la ventana (no todas): las que cuentan para la trama o el sentido.' },
    reparto: { type: 'array', items: persona, description: 'Quién aparece en esta ventana y cómo reconocerlo.' },
  };
  if (medio === 'video') {
    props.planos = {
      type: 'array',
      description: 'Todos los planos de la ventana, de corte a corte, en orden.',
      items: {
        type: 'object',
        properties: {
          inicio: T, fin: T,
          escala: { type: 'string', enum: [...ESCALAS] },
          angulacion: { type: 'string', enum: [...ANGULACIONES] },
          movimiento: { type: 'string', enum: [...MOVIMIENTOS] },
          dominante: { type: 'string', description: 'Quién domina el encuadre (nombre), o «nadie».' },
          composicion: { type: 'string', description: 'Disposición en el cuadro, profundidad de campo, líneas, marcos dentro del marco.' },
          luz: { type: 'string' },
          color: { type: 'string' },
          personas: { type: 'array', items: LOCALIZADO, description: 'Cada persona visible, con su caja en un instante del plano.' },
          objetos: { type: 'array', items: LOCALIZADO, description: 'Objetos significativos (no el mobiliario corriente), con su caja.' },
          textoEnPantalla: { type: 'string' },
          descripcion: { type: 'string', description: 'Qué se ve, en una o dos frases.' },
        },
        required: ['inicio', 'fin', 'escala', 'personas', 'descripcion'],
      },
    };
  }
  const orden = medio === 'video' ? ['escenas', 'planos', 'sonidos', 'dialogos', 'reparto'] : ['escenas', 'sonidos', 'dialogos', 'reparto'];
  return { type: 'object', properties: Object.fromEntries(orden.map((k) => [k, props[k]])), required: orden };
}

const MIRADA: Partial<Record<Lente, string>> = {
  cine: 'Miras como un analista de cine que prepara el découpage completo de la película: planos, escalas, angulación, movimiento, composición (quién domina el encuadre), luz, color, montaje y sonido.',
  documental: 'Miras como un analista de cine documental: secuencias, testimonios y fuentes, material de archivo, rótulos y retórica audiovisual, además del découpage.',
  periodismo: 'Miras como un analista de periodismo audiovisual: bloques, fuentes y testimonios, material de archivo, rótulos y retórica.',
  clase: 'Miras una clase grabada: temas y apartados, lo que hay en la pizarra o en la diapositiva (cópialo en «texto en pantalla»), ejemplos y referencias.',
  entrevista: 'Escuchas una entrevista: quién habla, preguntas y respuestas, tesis de cada interlocutor, desacuerdos, tono y pragmática.',
  podcast: 'Escuchas un pódcast: bloques, intervenciones, quién habla, tesis, desacuerdos, tono, risas y pausas.',
};

export interface ContextoVentana {
  medio: 'video' | 'audio';
  lente: Lente;
  ficha?: string;
  idioma?: string;
  t0: number;
  t1: number;
  n: number;
  total: number;
  reparto: PersonaPercibida[];
  /** Quién habla en este fragmento según la transcripción. */
  hablanAqui?: string[];
  /** Intérpretes de la obra sin papel conocido (Wikidata sin P453). */
  interpretes?: string[];
  transcripcion: string;
  cortes?: number[];
}

export function instruccionesSistema(medio: 'video' | 'audio', lente: Lente, idioma = 'es'): string {
  const mirada = MIRADA[lente] ?? (medio === 'video' ? MIRADA.cine! : MIRADA.podcast!);
  const lengua = idioma.startsWith('es') ? 'en español' : `en la lengua del documento (${idioma})`;
  const comun = [
    mirada,
    `Escribe ${lengua}, con precisión y sin adornos. Describe solo lo que se ve y se oye; si algo no se distingue, no lo inventes.`,
    'Todas las marcas de tiempo, en H:MM:SS.s contadas desde el principio de la obra completa (no desde el principio del fragmento).',
    'Usa exactamente los nombres del reparto conocido. Si aparece alguien que no está, dale un nombre si la obra lo dice y, si no, una descripción breve y estable («camarero de Coppelia»).',
    'No le des a nadie un nombre del reparto solo porque esté en la lista: hazlo cuando lo reconozcas por su aspecto o por su voz, o cuando la transcripción lo nombre o le dé la palabra en ese momento. Un figurante que no habla y no reconoces se describe.',
    'La transcripción es fiable para lo que se dice: las frases de «dialogos» se copian literalmente de ella, con su hablante.',
    'Las escenas cubren todo el fragmento, sin huecos ni solapes: cambia de escena con el lugar, el tiempo o la acción.',
    'Sonido: separa música (incidental o de la escena), canciones, silencios significativos, ambiente y efectos; di si es diegético.',
  ];
  if (medio === 'video') {
    comun.push(
      'Planos: uno por cada corte de montaje, todos y en orden, sin huecos. Un plano empieza en un corte (o en una transición) y acaba en el siguiente; un movimiento de cámara dentro del mismo plano no lo parte.',
      'Escala de plano: gran plano general (el paisaje domina), plano general (figuras enteras en su entorno), plano entero (la figura de pies a cabeza), plano americano (hasta las rodillas), plano medio (hasta la cintura), plano medio corto (hasta el pecho), primer plano (rostro y hombros), primerísimo primer plano (parte del rostro), plano detalle (un objeto o una parte del cuerpo).',
      'Personas y objetos: para cada persona visible, su caja [ymin, xmin, ymax, xmax] en 0-1000 sobre el fotograma del «instante» que indiques (dentro del plano), ajustada a lo que se ve de la persona (cabeza y cuerpo visibles), no a todo el cuadro.',
      'Quién domina el encuadre: por tamaño, posición, foco, luz o mirada.',
    );
  } else {
    comun.push('No hay imagen: las escenas son bloques de conversación o de contenido. En «notas», el tono, la prosodia, las risas, las pausas, los solapamientos y el papel de cada voz.');
  }
  return comun.join('\n');
}

function lineaPersona(p: PersonaPercibida, habla = false): string {
  const extra = [p.ficticia === false ? 'persona real' : p.ficticia ? 'personaje' : '', p.actor ? `interpretado por ${p.actor}` : '', p.descripcionVisual ?? '', p.voz ? `voz: ${p.voz}` : ''].filter(Boolean);
  return `- ${p.nombre}${habla ? ' (habla en este fragmento)' : ''}${extra.length ? `: ${extra.join('; ')}` : ''}`;
}

export function textoVentana(c: ContextoVentana): string {
  const partes: string[] = [];
  if (c.ficha) partes.push(`Obra: ${c.ficha}. Lente: ${c.lente}.`);
  partes.push(`Fragmento ${c.n} de ${c.total}: de ${marca(c.t0)} a ${marca(c.t1)}. Analiza SOLO este fragmento y da las marcas contadas desde el principio de la obra.`);
  const hablan = new Set(c.hablanAqui ?? []);
  if (c.reparto.length) partes.push(`Reparto conocido:\n${c.reparto.map((p) => lineaPersona(p, hablan.has(p.nombre))).join('\n')}`);
  if (c.interpretes?.length) partes.push(`Intérpretes de la obra (sin papel asignado): ${c.interpretes.join(', ')}. No son personajes: si reconoces a quién interpreta cada uno, ponlo en «actor» del personaje.`);
  if (c.cortes?.length) {
    const dentro = c.cortes.filter((x) => x >= c.t0 - 0.5 && x <= c.t1 + 0.5).map((x) => marca(x));
    if (dentro.length) partes.push(`Cortes de montaje detectados automáticamente por cambio de imagen (pueden faltar los muy suaves y sobrar falsos en destellos o movimientos bruscos): ${dentro.join(', ')}.`);
  }
  partes.push(c.transcripcion ? `Transcripción del fragmento (con hablantes):\n${c.transcripcion}` : 'En este fragmento no hay transcripción: puede que no se hable.');
  return partes.join('\n\n');
}
