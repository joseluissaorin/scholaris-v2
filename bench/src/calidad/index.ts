/**
 * `pnpm bench calidad [orden]`: el banco de calidad de búsqueda y citas.
 *
 *   (sin orden)       ejecuta el banco y anota el resultado (bench/calidad/RESULTADOS.md)
 *   estanteria        reconstruye la estantería congelada desde bench/datos/salida
 *   proponer          borrador de consultas con Gemini (materia prima, se revisa a mano)
 *   pool              ejecuta todos los sistemas y junta candidatos por consulta
 *   juzgar            juicios 0-3 con dos jueces independientes y adjudicación
 *   citas-proponer    borrador de afirmaciones para el juego de citas
 *   citas-juzgar      oro de las afirmaciones con pool y dos jueces
 *   remapear          lleva juicios, semillas y oro de citas a una estantería reconstruida
 *   revisar           confirmar o corregir juicios a mano
 *   experimentos      barridos de ajustes (vías, rrf, pesos, reordenadores, expansiones, contiguos, vista)
 *   embebedores       compara embebedores (Gemini, EmbeddingGemma 2, bge-m3, Qwen3-VL) en la vía densa
 *   folios-rehacer    recalcula los folios de las fuentes congeladas sin releer (--simular: sin escribir)
 */
export async function calidad(args: string[]): Promise<void> {
  const [orden, ...resto] = args;
  switch (orden) {
    case 'estanteria': {
      const { construirEstanteria } = await import('./estanteria.js');
      console.log(await construirEstanteria({ actualizar: resto.includes('--actualizar') }));
      return;
    }
    case 'proponer': return (await import('./proponer.js')).proponer(resto);
    case 'pool': return (await import('./pool.js')).pool(resto);
    case 'citas-proponer': return (await import('./citas.js')).proponerCitas();
    case 'citas-juzgar': return (await import('./citas.js')).juzgarCitas();
    case 'juzgar': return (await import('./juzgar.js')).juzgar(resto);
    case 'experimentos': return (await import('./experimentos.js')).experimentos(resto);
    case 'remapear': return (await import('./remapear.js')).remapear();
    case 'revisar': return (await import('./revisar.js')).revisar(resto);
    case 'embebedores': return (await import('./embebedores.js')).embebedores(resto);
    case 'folios-rehacer': return (await import('./folios-rehacer.js')).foliosRehacer(resto);
    case undefined: return (await import('./ejecutar.js')).ejecutar([]);
    default:
      if (orden.startsWith('--')) return (await import('./ejecutar.js')).ejecutar(args);
      throw new Error(`Orden desconocida: ${orden} ${resto.join(' ')}`);
  }
}
