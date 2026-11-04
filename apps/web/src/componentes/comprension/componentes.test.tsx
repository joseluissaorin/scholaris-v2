import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatosFicha } from './mapa';
import { RecorteRegion, TextoSenalado } from './material';
import { FormaCorrespondencia } from './alineaciones';

describe('componentes de la comprensión', () => {
  it('los datos de la lente, con sus etiquetas en castellano y sin lo interno', () => {
    const html = renderToStaticMarkup(<DatosFicha datos={{
      focalizacion: 'interna fija', escalas: ['plano medio', 'primer plano'], resumen: { es: 'no sale' }, huellaEntrada: 'x',
      sonido: { diegetico: ['lluvia'], extradiegetico: [], musica: ['Bolero del muelle'], silencio: '' },
      personajes: [{ nombre: 'Nieves', actor: 'Marta Quevedo', papel: 'vecina' }],
    }} />);
    expect(html).toContain('Focalización');
    expect(html).toContain('plano medio · primer plano');
    expect(html).toContain('Dentro de la historia');
    expect(html).toContain('Música');
    expect(html).not.toContain('Silencio');
    expect(html).toContain('Marta Quevedo');
    expect(html).not.toContain('no sale');
    expect(renderToStaticMarkup(<DatosFicha datos={{ resumen: { es: 'x' } }} />)).toBe('');
  });

  it('los caracteres subrayados en su contexto, sin el marcado de la transcripción', () => {
    const texto = '**Ernesto:** Media hora exacta. Ninguna conversación seria debería durar más.';
    const i = Array.from(texto).indexOf('M');
    const html = renderToStaticMarkup(<TextoSenalado texto={texto} caracteres={[i, i + 17]} />);
    expect(html).toContain('Ernesto: ');
    expect(html).toContain('<mark class="text-coffee-900">Media hora exacta</mark>');
    expect(html).not.toContain('**');
  });

  it('el recorte de una región: la caja con la proporción del trozo y la región rodeada', () => {
    const html = renderToStaticMarkup(<RecorteRegion src="data:," region={{ x: 0.5, y: 0.5, w: 0.25, h: 0.25 }} aspectoInicial={1} holgura={0} etiqueta="La región del fotograma de 1:02" />);
    expect(html).toContain('aria-label="La región del fotograma de 1:02"');
    expect(html).toContain('aspect-ratio:1');
    expect(html).toContain('width:400%');
    expect(html).toContain('left:-200%');
  });

  it('cada tipo de correspondencia con su forma (llena o hueca)', () => {
    expect(renderToStaticMarkup(<FormaCorrespondencia tipo="equivalente" />)).toContain('<circle');
    expect(renderToStaticMarkup(<FormaCorrespondencia tipo="condensado" />)).toContain('<path');
    expect(renderToStaticMarkup(<FormaCorrespondencia tipo="suprimido" />)).toContain('fill="none"');
  });
});
