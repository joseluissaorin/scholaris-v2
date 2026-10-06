/** Todas las rutas de las funciones, para montarlas de una vez bajo /api/v2. */

import type { EntornoFunciones } from '../puertos.js';
import type { AppFunciones } from './comun.js';
import { rutasConceptos } from './conceptos.js';
import { rutasCorpus } from './corpus.js';
import { rutasCuadernos } from './cuadernos.js';
import { rutasEntidades } from './entidades.js';
import { rutasGrafo } from './grafo.js';
import { rutasHistorial } from './historial.js';
import { rutasMapa } from './mapa.js';
import { rutasPerspectivas } from './perspectivas.js';
import { rutasPrivacidad } from './privacidad.js';
import { rutasAlertas, rutasVigilantes } from './vigilantes.js';

export { rutasConceptos, rutasCorpus, rutasCuadernos, rutasEntidades, rutasGrafo, rutasHistorial, rutasMapa, rutasPerspectivas, rutasPrivacidad, rutasAlertas, rutasVigilantes };
export { manejar, puertosDe, respuestaError, sse, type AppFunciones } from './comun.js';

export function rutasFunciones<E extends EntornoFunciones>(app: AppFunciones<E>): void {
  rutasHistorial(app);
  rutasCuadernos(app);
  rutasVigilantes(app);
  rutasAlertas(app);
  rutasConceptos(app);
  rutasMapa(app);
  rutasGrafo(app);
  rutasEntidades(app);
  rutasPerspectivas(app);
  rutasCorpus(app);
  rutasPrivacidad(app);
}
