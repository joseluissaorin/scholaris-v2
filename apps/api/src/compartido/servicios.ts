/**
 * Servicios con estado que conviene conservar entre peticiones del mismo
 * usuario (cachés del buscador). Se cuelgan del objeto SQL de la estantería,
 * que es estable dentro de un Durable Object y en el proceso local.
 */
import { Buscador } from '@scholaris/busqueda';
import type { Buscador as BuscadorFunciones, PuertosFunciones } from '@scholaris/funciones';
import type { SQL } from '@scholaris/nucleo';
import type { PuertosUsuario } from '../puertos.js';

const buscadores = new WeakMap<SQL, { buscador: Buscador; creado: number }>();

/** El buscador del usuario, con sus cachés de comprensión y de vectores de consulta. */
export async function obtenerBuscador(p: PuertosUsuario): Promise<Buscador> {
  const hay = buscadores.get(p.sql);
  // La inteligencia puede cambiar (claves propias): se rehace cada 10 minutos.
  if (hay && Date.now() - hay.creado < 600_000) return hay.buscador;
  const ia = await p.inteligencia();
  const buscador = new Buscador({
    sql: p.sql,
    embebedor: ia.embebedor,
    ...(p.indice ? { indice: p.indice } : {}),
    espacioNombres: p.config.espacioNombres(p.usuario.id),
    redactor: ia.redactor,
    reordenador: ia.reordenador,
    juez: ia.juez,
  });
  buscadores.set(p.sql, { buscador, creado: Date.now() });
  return buscador;
}

/** Tras una ingesta o un borrado: olvidar la caché de documentos del buscador. */
export function invalidarBuscador(sql: SQL): void {
  buscadores.get(sql)?.buscador.invalidar();
}

/** Los puertos que leen las rutas de `@scholaris/funciones`. */
export async function puertosFunciones(p: PuertosUsuario): Promise<PuertosFunciones> {
  const buscador: BuscadorFunciones = {
    async buscar(pet) {
      const b = await obtenerBuscador(p);
      const r = await b.buscar(pet.consulta, { ...(pet.filtros ? { filtros: pet.filtros } : {}), limite: pet.k ?? 10 });
      return { resultados: r.resultados };
    },
  };
  const ia = await p.inteligencia();
  return {
    sql: p.sql,
    usuario: { id: p.usuario.id, pro: p.usuario.plan === 'pro' },
    inteligencia: { embebedor: ia.embebedor, reordenador: ia.reordenador, juez: ia.juez, redactor: ia.redactor },
    ...(p.indice ? { indice: p.indice } : {}),
    buscador,
    emisor: p.emisor as never,
    canal: `usuario:${p.usuario.id}`,
    enSegundoPlano: (pr) => p.segundoPlano(pr),
  } as PuertosFunciones;
}
