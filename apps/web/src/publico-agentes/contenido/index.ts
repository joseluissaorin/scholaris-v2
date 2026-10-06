/**
 * Las hojas de la base de conocimiento, en el orden en que se leen. Cada una
 * vive en su fichero, con su texto en castellano y en inglés.
 */
import type { Pagina } from './tipos';
import { indice } from './indice';
import { queEs } from './que-es';
import { formatos } from './formatos';
import { spdf } from './spdf';
import { busqueda } from './busqueda';
import { citas } from './citas';
import { investigacion } from './investigacion';
import { bibliotecas } from './bibliotecas';
import { reproductor } from './reproductor';
import { api } from './api';
import { local } from './local';
import { privacidad } from './privacidad';
import { planes } from './planes';
import { rendimiento } from './rendimiento';
import { preguntas } from './preguntas';
import { glosario } from './glosario';
import { alternativas } from './alternativas';
import { cambios } from './cambios';
import { agentes } from './agentes';

export type { Lengua, Pagina, Version } from './tipos';

export const PAGINAS: Pagina[] = [
  indice, queEs, formatos, spdf, busqueda, citas, investigacion, bibliotecas, reproductor,
  api, local, privacidad, planes, rendimiento, preguntas, glosario, alternativas, cambios, agentes,
];
