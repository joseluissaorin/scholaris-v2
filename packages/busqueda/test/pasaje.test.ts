import { describe, expect, it } from 'vitest';
import { pasajeRelevante, resaltar, resaltarConPasaje, terminos } from '../src/index.js';

// Balzac, «Le Chef-d'œuvre inconnu» (dominio público): el fragmento entero, con el pie en medio.
const BALZAC = [
  '— Le vieux lansquenet se joue de nous, dit Poussin en revenant devant le prétendu tableau. Je ne vois là que des couleurs confusément amassées et contenues par une multitude de lignes bizarres qui forment une muraille de peinture.',
  '— Nous nous trompons, voyez ?... reprit Porbus.',
  'En s\'approchant, ils aperçurent dans un coin de la toile le bout d\'un pied nu qui sortait de ce chaos de couleurs, de tons, de nuances indécises, espèce de brume sans forme ; mais un pied délicieux, un pied vivant ! Ils restèrent pétrifiés d\'admiration devant ce fragment échappé à une incroyable, à une lente et progressive destruction. Ce pied apparaissait là comme le torse de quelque Vénus en marbre de Paros qui surgirait parmi les décombres d\'une ville incendiée.',
  '— Il y a une femme là-dessous, s\'écria Porbus en faisant remarquer à Poussin les couches de couleurs que le vieux peintre avait successivement superposées en croyant perfectionner sa peinture.',
].join('\n\n');

const ORACION_DEL_PIE = 'En s\'approchant, ils aperçurent dans un coin de la toile le bout d\'un pied nu qui sortait de ce chaos de couleurs, de tons, de nuances indécises, espèce de brume sans forme ; mais un pied délicieux, un pied vivant !';

describe('pasaje relevante de un resultado', () => {
  it('es la oración del pie, con sus desplazamientos en el fragmento', () => {
    const p = pasajeRelevante(BALZAC, terminos('un pied sort du tableau'));
    expect(p.texto).toBe(ORACION_DEL_PIE);
    expect(BALZAC.slice(p.desde, p.hasta)).toBe(ORACION_DEL_PIE);
  });

  it('lo que se ve es lo que se cita: el resaltado contiene el pasaje entero, marcado', () => {
    const { resaltado, pasaje } = resaltarConPasaje(BALZAC, terminos('un pied sort du tableau'));
    const sinEtiquetas = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&#39;|&apos;/g, "'");
    const marcado = /<span class="pasaje">([\s\S]*?)<\/span>/.exec(resaltado);
    expect(marcado).not.toBeNull();
    expect(sinEtiquetas(marcado![1]!)).toBe(pasaje.texto);
    expect(resaltado).toContain('<mark>pied</mark>');
    // Las etiquetas quedan bien anidadas: ningún <mark> abierto cruza el pasaje.
    expect(/<mark>[^<]*<span/.test(resaltado) || /<\/span>[^<]*<\/mark>/.test(resaltado)).toBe(false);
  });

  it('sin pasaje, el resaltado es el de siempre', () => {
    expect(resaltar('El <Panóptico> de Bentham', ['panoptico'])).toBe('El &lt;<mark>Panóptico</mark>&gt; de Bentham');
  });

  it('en una transcripción, el pasaje no lleva marcas y el resaltado conserva al hablante', () => {
    const t = '**Entrevistador:** ¿Y la guitarra? **Serrat:** Me la prestó un vecino. La guitarra era de su padre y sonaba fatal. Pero era mía.';
    const { resaltado, pasaje } = resaltarConPasaje(t, terminos('la guitarra del padre'));
    expect(pasaje.texto).toBe('La guitarra era de su padre y sonaba fatal.');
    expect(resaltado).toContain('<b class="hablante">Serrat</b>');
    expect(resaltado).toContain('<span class="pasaje">La <mark>guitarra</mark> era de su <mark>padre</mark> y sonaba fatal.</span>');
  });
});
