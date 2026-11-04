import { describe, expect, it } from 'vitest';
import type { Redactor, SQL } from '@scholaris/nucleo';
import type { AlmacenAmpliado } from '../src/puertos.js';
import { crearAnclador, leerPercepcion, percibirDocumento } from '../src/compartido/percepcion.js';

function almacenFalso() {
  const datos = new Map<string, { bytes: Uint8Array; tipo?: string }>();
  return {
    datos,
    async poner(clave: string, cuerpo: Uint8Array | string, tipo?: string) { datos.set(clave, { bytes: typeof cuerpo === 'string' ? new TextEncoder().encode(cuerpo) : cuerpo, ...(tipo ? { tipo } : {}) }); },
    async bytes(clave: string) { return datos.get(clave)?.bytes ?? null; },
    async rango(clave: string, desde: number, hasta: number) { return datos.get(clave)?.bytes.slice(desde, hasta + 1) ?? null; },
    async cabecera(clave: string) { const d = datos.get(clave); return d ? { bytes: d.bytes.length, ...(d.tipo ? { tipo: d.tipo } : {}) } : null; },
    async obtener(clave: string) { const d = datos.get(clave); return d ? { cuerpo: new Blob([d.bytes] as never).stream(), meta: { clave, bytes: d.bytes.length, ...(d.tipo ? { tipo: d.tipo } : {}) } } : null; },
  };
}

/** Una estantería mínima: el documento y sus unidades. */
function sqlFalso(documento: Record<string, unknown>, unidades: Array<Record<string, unknown>>): SQL {
  return {
    async ejecutar(sql: string, ...ps: unknown[]) {
      if (/FROM documentos/.test(sql)) return [documento] as never;
      if (/AND orden = \?/.test(sql)) return unidades.filter((u) => u.orden === ps[1]) as never;
      if (/FROM unidades/.test(sql)) return unidades as never;
      return [] as never;
    },
  } as unknown as SQL;
}

const pelicula = {
  id: 'd1', tipo: 'video', titulo: 'Fresa y chocolate', estado: 'listo', huella: 'h', original: 'u/a/d/d1/original.mp4', mime: 'video/mp4', bytes: 10, unidades: 2, creado: '', actualizado: '', bibliotecas: '[]', duracion: 300,
  metadatos: JSON.stringify({ titulo: 'Fresa y chocolate', anio: 1993, autores: [{ nombre: 'Tomás', apellidos: 'Gutiérrez Alea' }], tipoCSL: 'motion_picture', idioma: 'es' }),
};

describe('percibirDocumento', () => {
  it('ve el proxy con la transcripción y los cortes, guarda percepcion.json y no repite lo hecho', async () => {
    const a = almacenFalso();
    await a.poner('u/a/d/d1/proxy.mp4', new Uint8Array(10), 'video/mp4');
    await a.poner('u/a/d/d1/proxy.cortes.json', JSON.stringify({ cortes: [12.5], umbral: 0.3 }));
    const sql = sqlFalso(pelicula, [{ orden: 0, ancla: JSON.stringify({ tipo: 'tiempo', t0: 10, t1: 12, hablante: 'Diego' }), texto: '**Diego:** Me encanta la fresa.', t0: 10, t1: 12, palabras: null, imagen: null }]);
    const peticiones: Array<Record<string, unknown>> = [];
    let subidas = 0;
    const gemini = {
      async generar(modelo: string, cuerpo: Record<string, unknown>) {
        peticiones.push(cuerpo);
        const json = { escenas: [{ inicio: '0:00:00', fin: '0:05:00', titulo: 'Coppelia', personas: ['Diego'], accion: 'Diego come helado.' }], planos: [{ inicio: '0:00:00', fin: '0:00:12.4', escala: 'plano medio', personas: [{ nombre: 'Diego', caja: [0, 0, 1000, 500], instante: '0:00:05' }], descripcion: 'Diego.' }, { inicio: '0:00:12.4', fin: '0:05:00', escala: 'primer plano', personas: [], descripcion: 'David.' }], sonidos: [], dialogos: [], reparto: [] };
        return { texto: JSON.stringify(json), fin: 'STOP', uso: { proveedor: 'gemini', modelo, operacion: 'percibir', tokensEntrada: 100, tokensSalida: 10, usd: 0.01, ms: 1 } };
      },
      async subirArchivoPorTrozos(o: { bytes: number; mime: string }) { subidas++; return { nombre: 'files/x', uri: 'https://g/files/x', mime: o.mime, estado: 'ACTIVE', expira: new Date(Date.now() + 40 * 3600_000).toISOString() }; },
      async archivo() { return { nombre: 'files/x', uri: 'https://g/files/x', mime: 'video/mp4', estado: 'ACTIVE' }; },
    };
    const ctx = { almacen: a as unknown as AlmacenAmpliado, sql, gemini: gemini as never };
    const doc = { documento: 'd1', prefijo: 'u/a/d/d1/', tipo: 'video' };
    const r = await percibirDocumento(ctx, doc);
    expect(subidas).toBe(1);
    const texto = JSON.stringify(peticiones[0]);
    expect(texto).toContain('«Fresa y chocolate» (1993), de Tomás Gutiérrez Alea');
    expect(texto).toContain('Me encanta la fresa.');
    expect(texto).toContain('0:00:12.5');
    expect(r.escenas[0]!.planos.map((p) => p.t1)).toEqual([12.5, 300]);
    expect((await leerPercepcion(a as unknown as AlmacenAmpliado, 'u/a/d/d1/'))?.escenas.length).toBe(1);
    // Lo grabado no se vuelve a pagar, y con «reutilizar» ni siquiera se recompone.
    await percibirDocumento(ctx, doc);
    expect(peticiones.length).toBe(1);
    expect((await percibirDocumento(ctx, doc, { reutilizar: true })).documento).toBe('d1');
    expect(peticiones.length).toBe(1);
  });
});

describe('crearAnclador', () => {
  it('ancla por la capa del paquete en las páginas digitales y por visión en las escaneadas', async () => {
    const a = almacenFalso();
    const pagina = (fisica: number, clase: 'pdf' | 'pdf_escaneado', lineas: Array<{ texto: string; x: number; y: number; w: number; h: number }>) => ({
      fisica, clase, texto: { origen: clase === 'pdf' ? 'digital' : 'ocr' }, lineas: lineas.map((l) => ({ ...l, tam: 10, bloque: 0 })),
    });
    await a.poner('u/a/d/d2/paquete.json', JSON.stringify({ contenido: { clase: 'pdf', paginas: [
      pagina(1, 'pdf', [{ texto: 'El hábito del triunfo disminuye la duda', x: 0.1, y: 0.4, w: 0.8, h: 0.02 }]),
      pagina(2, 'pdf_escaneado', [{ texto: 'texto ocr sin cajas fiables', x: 0, y: 0, w: 1, h: 1 }]),
    ] } }));
    await a.poner('u/a/d/d2/paginas/0002.jpg', new Uint8Array([1, 2]), 'image/jpeg');
    const sql = sqlFalso({ ...pelicula, id: 'd2', tipo: 'pdf' }, [
      { orden: 0, ancla: JSON.stringify({ tipo: 'pagina', fisica: 1, impresa: '1', romana: false, origen: 'leido', confianza: 1 }), texto: 'El hábito del triunfo disminuye la duda.', imagen: 'paginas/0001.jpg' },
      { orden: 1, ancla: JSON.stringify({ tipo: 'pagina', fisica: 2, impresa: '2', romana: false, origen: 'leido', confianza: 1 }), texto: 'texto ocr sin cajas fiables', imagen: 'paginas/0002.jpg' },
    ]);
    const vistas: string[] = [];
    const redactor: Redactor = { nombre: 'r', async generar<T>(p: Parameters<Redactor['generar']>[0]) { vistas.push(p.mensajes[0]!.partes.map((x) => ('mime' in x ? x.mime : '')).join()); const json = { encontrada: true, cajas: [[100, 100, 200, 900]] }; return { texto: '', json: json as T }; } };
    const anclar = crearAnclador({ almacen: a as unknown as AlmacenAmpliado, sql, redactor }, { documento: 'd2', prefijo: 'u/a/d/d2/' });
    const d = await anclar(0, { cita: 'triunfo disminuye' });
    expect(d.metodo).toBe('capa');
    expect(d.ancla.caracteres).toEqual([14, 31]);
    const e = await anclar(1, { cita: 'sin cajas' });
    expect(e.metodo).toBe('vision');
    expect(e.ancla.region).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.1 });
    expect(vistas).toEqual(['image/jpeg,']);
    expect([...a.datos.keys()].some((k) => k.startsWith('u/a/d/d2/percepcion/anclaje/'))).toBe(true);
  });
});
