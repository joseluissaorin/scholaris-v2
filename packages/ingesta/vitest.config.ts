import { defineConfig } from 'vitest/config';

// En procesos y no en hilos: en los ejecutores pequeños de la CI, las pruebas
// largas de la ingesta bloqueaban el hilo y vitest perdía el aviso de progreso
// («Timeout calling onTaskUpdate»).
export default defineConfig({
  test: { pool: 'forks' },
});
