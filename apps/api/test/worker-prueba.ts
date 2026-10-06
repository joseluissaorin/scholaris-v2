/** El Worker real con la inteligencia falsa: lo que arrancan las pruebas. */
import { establecerFabricaInteligencia } from '../src/cloudflare/puertos-cf.js';
import { inteligenciaFalsa } from './falsos.js';

establecerFabricaInteligencia(() => inteligenciaFalsa());

export { default, Estanteria, Tarea, Limitador, FlujoIngesta } from '../src/cloudflare/worker.js';
