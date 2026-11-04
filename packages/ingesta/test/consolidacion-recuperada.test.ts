/**
 * Una consolidación que termina sin que nadie se entere. En producción, el paso
 * «consolidar» de una película de casi dos horas caducó a los 144 s, el
 * trabajador siguió y terminó bien, limpió el estado de las tandas y los
 * reintentos del paso fallaron con «Falta la tanda 0»: la película quedó en
 * error estando consolidada. El sello de la consolidación (su procedencia
 * «indexado», escrita con el borrado de las tandas) permite reconocerlo.
 */
import { describe, expect, it } from 'vitest';
import { consolidacionRegistrada, consolidar, ErrorFaltaTanda, planificar, type ContextoTuberia } from '../src/index.js';
import { ejecutarIngesta } from '../src/orquestador.js';
import { baseReal, fuenteFalsa, inteligenciaFalsa, paginaPdf, paquetePdf } from './fakes.js';

const texto = (n: number) => Array.from({ length: 30 }, (_, i) => `Frase ${i} de la página ${n} sobre el helado de Coppelia.`).join(' ');

describe('consolidación ya hecha', () => {
  it('sin tandas, consolidar avisa con ErrorFaltaTanda y el sello dice que ya está hecha', async () => {
    const { sql } = await baseReal();
    const paquete = paquetePdf([1, 2, 3, 4].map((f) => paginaPdf(f, texto(f))), { metadatos: { titulo: 'El lobo, el bosque y el hombre nuevo' } });
    const puertos = { inteligencia: inteligenciaFalsa(), fuente: fuenteFalsa, sql };
    const antes = new Date(Date.now() - 1000).toISOString();
    const r = await ejecutarIngesta(paquete, puertos, { sinVerificacion: true, documentoId: 'lobo' });
    expect(r.documento.estado).toBe('listo');

    // El trabajo de las tandas ya no está: una segunda consolidación no puede empezar.
    const ctx: ContextoTuberia = { paquete, plan: planificar(paquete), puertos: puertos as ContextoTuberia['puertos'], documento: 'lobo', opciones: { sinVerificacion: true } };
    const e = await consolidar(ctx).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorFaltaTanda);
    expect((e as ErrorFaltaTanda).tanda).toBe(0);
    expect((e as Error).message).toMatch(/^Falta la tanda 0/);

    // Pero el sello de la primera está, con las cuentas de lo que escribió.
    const hecha = await consolidacionRegistrada(sql, 'lobo', antes);
    expect(hecha).not.toBeNull();
    expect(hecha!.unidades).toBe(r.unidades.length);
    expect(hecha!.fragmentos).toBe(r.fragmentos.length);
    expect(hecha!.secciones).toBe(r.secciones.length);
    expect(hecha!.figuras).toBe(r.figuras.length);
    expect(hecha!.vectores).toEqual(r.vectores);
    expect(hecha!.cuando >= antes).toBe(true);
  });

  it('el sello de una ingesta anterior no cuenta', async () => {
    const { sql } = await baseReal();
    const paquete = paquetePdf([1, 2].map((f) => paginaPdf(f, texto(f))));
    await ejecutarIngesta(paquete, { inteligencia: inteligenciaFalsa(), fuente: fuenteFalsa, sql }, { sinVerificacion: true, documentoId: 'viejo' });
    const despues = new Date(Date.now() + 60_000).toISOString();
    expect(await consolidacionRegistrada(sql, 'viejo', despues)).toBeNull();
    expect(await consolidacionRegistrada(sql, 'otro', '1970-01-01T00:00:00.000Z')).toBeNull();
  });
});
