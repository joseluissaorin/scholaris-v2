/**
 * Nota al margen para la primera vez: «¡ojo!» en minio, con un óvalo que la
 * rodea sin llegar a cerrarse y dos rayitas de énfasis, como quien avisa con
 * el lápiz rojo del corrector.
 */
import { type Dibujo, rojo, lapiz, nota } from '../../dibujo/boceto';

export const notaOjo: Dibujo = {
  id: 'nota-ojo',
  ancho: 150,
  alto: 70,
  duracion: 1,
  titulo: 'Una nota a mano que dice «¡ojo!»',
  descripcion: 'La palabra «¡ojo!» escrita a mano en rojo, rodeada por un óvalo a pluma que no llega a cerrarse, con dos rayitas de énfasis al lado.',
  elementos: [
    lapiz([[44, 45], [104, 44]], { g: 0.6 }),
    nota(74, 42, '¡ojo!', { tam: 25, tinta: 'rojo', giro: -4, ancla: 'middle' }),
    rojo([[36, 50], [30, 36], [42, 21], [70, 13], [102, 15], [120, 27], [119, 44], [100, 56], [70, 60], [46, 57], [38, 48], [40, 40]], { g: 1.8 }),
    rojo([[124, 14], [133, 7]], { g: 1.6, recto: true }),
    rojo([[129, 23], [140, 19]], { g: 1.6, recto: true }),
  ],
};
