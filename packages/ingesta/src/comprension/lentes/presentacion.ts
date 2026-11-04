/**
 * Lente presentación: diapositivas de una charla, una clase o un informe, leídas
 * con la retórica visual y la comunicación de datos (Tufte, Reynolds, Duarte):
 * título, mensaje principal, elementos visuales, datos, notas del orador e hilo argumental.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, lista, objeto } from './comun.js';

export const presentacion: DefinicionLente = {
  id: 'presentacion',
  version: 'presentacion@1',
  segmentos: ['parte', 'diapositiva'],
  conFicha: ['diapositiva'],
  guiaEstructura: `Partes: las secciones de la presentación, marcadas por diapositivas de título o de sección («Contexto», «Resultados»), o por el índice inicial.
Diapositivas: cada diapositiva es un segmento. Las de solo título o de transición se agrupan con la parte y no necesitan ficha propia si no dicen nada más.`,
  instrucciones: `Lente: análisis de una presentación.
- Título y mensaje principal de cada diapositiva: qué quiere que el público se lleve (a menudo distinto del título).
- Elementos visuales: gráficos (tipo, ejes, qué muestran y si lo muestran bien), imágenes, esquemas, iconos, tablas; jerarquía visual y densidad de texto.
- Datos: cifras exactas, fuentes citadas en la diapositiva.
- Notas del orador: lo que se dice y no se ve, si están en el material.
- Hilo argumental: cómo se encadenan las diapositivas (problema, propuesta, prueba, llamada a la acción), dónde está el clímax, qué se repite.
- Retórica visual: qué se destaca, qué se omite, coherencia entre texto e imagen.
Si solo tienes el texto extraído, no inventes lo visual: dilo.`,
  datosSegmento: objeto({
    titulo: cadena(),
    mensaje: cadena('Mensaje principal.'),
    puntos: cadenas('Texto de la diapositiva, en orden.'),
    visuales: lista(objeto({ elemento: cadena('Gráfico, imagen, esquema, tabla…'), muestra: cadena() }, ['elemento'])),
    datos: lista(objeto({ dato: cadena(), cifra: cadena('Cifra literal.'), fuente: cadena() }, ['dato'])),
    notas: cadena('Notas del orador, si las hay.'),
    funcion: cadena('Papel en el hilo de la presentación.'),
  }, ['titulo', 'mensaje', 'funcion']),
  datosGlobal: objeto({
    tema: cadena(),
    publico: cadena('Público y ocasión, si constan.'),
    tesis: cadena('Mensaje central.'),
    hilo: cadena('Hilo argumental de principio a fin.'),
    secciones: cadenas(),
    datosClave: lista(objeto({ dato: cadena(), cifra: cadena() }, ['dato'])),
    estiloVisual: cadena('Densidad, jerarquía, uso de gráficos e imágenes.'),
    llamada: cadena('Conclusión o llamada a la acción.'),
  }, ['tema', 'tesis', 'hilo', 'secciones']),
  entidades: ['concepto', 'organizacion', 'persona', 'obra', 'lugar', 'evento', 'fecha'],
};
