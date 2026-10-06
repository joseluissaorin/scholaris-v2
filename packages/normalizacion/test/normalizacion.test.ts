import { describe, expect, it } from 'vitest';
import {
  arreglarSLarga,
  detectarEpoca,
  lenguaDe,
  normalizarDetallado,
  normalizarParaBusqueda,
  normalizarPalabra,
  palabraLatin,
  plegadoBasico,
  raizNominal,
  raizVerbal,
  resolverEpoca,
  separarEnclitico,
  textoBusqueda,
  variantesConsulta,
} from '../src/index.js';

/** Clave castellana antigua de un texto. */
const es = (t: string) => normalizarParaBusqueda(t, 'es', 'antigua');
/** ¿Comparten clave el texto antiguo y la forma moderna? */
const casan = (antiguo: string, moderno: string) => expect(es(antiguo)).toBe(es(moderno));

// Versos reales de «El casamiento en la muerte» (Lope, ed. sevillana del s. XVIII),
// tal como están en bench/datos/salida/el-casamiento-en-la-.spdf.
const LOPE = {
  vientos: '*Al.* Mi Exercito, y el tuyo dando al viẽto\nlas Vanderas cruzadas, y las Lunas,\ntomaràn de este Valle el hondo assiento.',
  vengarse: 'y aunque para vengarfe no es disculpa,',
  roldan: '*Al.* Què Roldan como tu, sobrino mio,\ny el bravo Aragonès Brabonèl fuerte?',
  tilde: 'tengo por bien, q̃ en mis Vanderas ande\npor armas, por blason, y por trofeo.',
  conquistar: 'q̃ un Reyno, un Mundo cõquistar confio;',
  quantos: '*Al.* Quantos Castillos has ganado?',
  corazon: 'No estoy muy enamorado;\nque es pequeño el corazon,\ny un Padre con su prision\ntiene lo mas ocupado.',
  christiana: 'Pretendo libre à mi Padre;\nque solo estorva el ser Rey,\nla Christiana, y justa ley\nde estar por casar mi madre.',
  assi: 'Y assi, dice Brabonèl,\ny en lo que te ama Aragon,',
  alexado: '*Ber.* Alexado nos havemos\npara ir solos como vamos.',
  presso: 'sino el presso innocente Padre mio.',
  roxo: 'en roxo campo de sangrientas olas;',
  traygo: 'el que traygo pintado en la Vandera,',
  prission: 'basten los años que en prission le tienes.',
  caxas: '*Al.* Pues tocad essas caxas, y añasiles,',
};

describe('lengua y época', () => {
  it('reconoce los códigos de lengua', () => {
    expect(lenguaDe('es')).toBe('es');
    expect(lenguaDe('es-ES')).toBe('es');
    expect(lenguaDe('spa')).toBe('es');
    expect(lenguaDe('osp')).toBe('es');
    expect(lenguaDe('la')).toBe('la');
    expect(lenguaDe('lat')).toBe('la');
    expect(lenguaDe('fr-FR')).toBe('fr');
    expect(lenguaDe('ita')).toBe('it');
    expect(lenguaDe('en')).toBe('otra');
    expect(lenguaDe(undefined)).toBe('otra');
  });

  it('detecta la ortografía antigua en Lope y la moderna en prosa actual', () => {
    for (const v of [LOPE.vientos + '\n' + LOPE.roldan, LOPE.corazon + '\n' + LOPE.christiana + '\n' + LOPE.assi]) {
      expect(detectarEpoca(v, 'es')).toBe('antigua');
    }
    const moderno = 'Johnny Carter toca el saxo en un club de París y Bruno, su biógrafo, intenta entender qué es lo que persigue cuando improvisa. La novela habla del tiempo, de la música y de la muerte, y de cómo un crítico se queda siempre del lado de fuera.';
    expect(detectarEpoca(moderno, 'es')).toBe('moderna');
    expect(detectarEpoca('El panóptico es una máquina de disociar la pareja ver-ser visto.', 'es')).toBe('moderna');
  });

  it('el año manda sobre la detección; el latín es siempre «antiguo»', () => {
    expect(resolverEpoca('texto moderno', 'es', 1609)).toBe('antigua');
    expect(resolverEpoca(LOPE.vientos, 'es', 1990)).toBe('moderna');
    expect(resolverEpoca('lo que sea', 'la', 2020)).toBe('antigua');
    expect(resolverEpoca('lo que sea', 'en', 1600)).toBe('moderna');
    expect(resolverEpoca('Il estoit une fois', 'fr', 1650)).toBe('antigua');
  });
});

describe('castellano antiguo: grafías y abreviaturas', () => {
  it('ſ, tilde de abreviatura y q̃', () => {
    expect(es('aſsi')).toBe('asi');
    expect(es('q̃')).toBe('que');
    expect(es('viẽto')).toBe('biento');
    expect(es('cõquistar')).toBe('conquistar');
    expect(es('cõpañia')).toBe(es('compañía'));
    expect(es('tãbien')).toBe(es('también'));
    expect(es('Q̃')).toBe('que');
  });

  it('la ſ leída como f', () => {
    expect(arreglarSLarga('vengarfe')).toBe('vengarse');
    expect(arreglarSLarga('efte')).toBe('este');
    expect(arreglarSLarga('mifmo')).toBe('mismo');
    expect(arreglarSLarga('afsi')).toBe('assi');
    expect(arreglarSLarga('nafta')).toBe('nafta');
    expect(arreglarSLarga('oftalmologia')).toBe('oftalmologia');
    expect(arreglarSLarga('fiesta')).toBe('fiesta');
    casan('afsi', 'así');
    casan('vengarfe', 'vengarse');
    casan('fiempre', 'siempre');
  });

  it('acentos graves y agudos fuera, la ñ se queda', () => {
    expect(es('Què')).toBe('que');
    expect(es('tomaràn')).toBe('tomaran');
    expect(es('Brabonèl')).toBe('brabonel');
    expect(es('España')).toBe('españa');
    casan('Diòle', 'diole');
  });

  it('ç según la vocal que sigue', () => {
    expect(es('coraçon')).toBe('corazon');
    expect(es('plaça')).toBe('plaza');
    expect(es('hiço')).toBe(es('hizo'));
    casan('çiudad', 'ciudad');
    casan('coraçon', 'corazón');
  });

  it('u/v, i/j, y por posición y fusión b/v', () => {
    casan('vn', 'un');
    casan('vna', 'una');
    casan('cauallo', 'caballo');
    casan('Vanderas', 'banderas');
    casan('estorva', 'estorba');
    casan('bolver', 'volver');
    casan('iuez', 'juez');
    casan('traygo', 'traigo');
    casan('Reyno', 'reino');
    casan('ayre', 'aire');
    casan('oyr', 'oír');
    expect(es('yo')).toBe('yo');
    expect(es('mayor')).toBe('mayor');
  });

  it('h muda, g/j, c/z, qu/cu, rr, consonantes dobles', () => {
    casan('aora', 'ahora');
    casan('agora', 'ahora');
    casan('havemos', 'habemos');
    casan('aver', 'haber');
    casan('muger', 'mujer');
    casan('ageno', 'ajeno');
    casan('hazer', 'hacer');
    casan('dezir', 'decir');
    casan('Quantos', 'cuántos');
    casan('qual', 'cual');
    casan('quatro', 'cuatro');
    casan('frequente', 'frecuente');
    casan('honrra', 'honra');
    casan('Enrrique', 'Enrique');
    casan('assi', 'así');
    casan('presso', 'preso');
    casan('prission', 'prisión');
    casan('excesso', 'exceso');
    casan('effecto', 'efecto');
    casan('innocente', 'inocente');
    casan('summa', 'suma');
    casan('fuesse', 'fuese');
    expect(es('acción')).toBe('aczion');
    expect(es('calle')).toBe('calle');
    expect(es('perro')).toBe('perro');
  });

  it('x → j solo en las palabras de la lista', () => {
    casan('dixo', 'dijo');
    casan('dixeron', 'dijeron');
    casan('roxo', 'rojo');
    casan('caxas', 'cajas');
    casan('Alexado', 'alejado');
    casan('Exercito', 'ejército');
    casan('baxo', 'bajo');
    casan('dexar', 'dejar');
    casan('quexa', 'queja');
    casan('lexos', 'lejos');
    casan('Ximena', 'Jimena');
    expect(es('examen')).toBe('examen');
    expect(es('éxito')).toBe('exito');
    expect(es('texto')).toBe('texto');
  });

  it('grecismos y latinismos', () => {
    casan('Christiana', 'cristiana');
    casan('philosophia', 'filosofía');
    casan('theologia', 'teología');
    casan('thesoro', 'tesoro');
    casan('cathólico', 'católico');
    casan('monarcha', 'monarca');
    casan('charidad', 'caridad');
    casan('sancto', 'santo');
    casan('escripto', 'escrito');
    casan('obscuro', 'oscuro');
    casan('sciencia', 'ciencia');
    casan('spiritu', 'espíritu');
    casan('nascer', 'nacer');
    casan('conoscer', 'conocer');
    casan('efeto', 'efecto');
    casan('dotor', 'doctor');
  });

  it('formas arcaicas de la lista', () => {
    casan('fee', 'fe');
    casan('mesmo', 'mismo');
    casan('proprio', 'propio');
    casan('ansi', 'así');
    casan('truxo', 'trajo');
    casan('vido', 'vio');
    casan('recebir', 'recibir');
    casan('escrevir', 'escribir');
    casan('fermosa', 'hermosa');
    casan('fablar', 'hablar');
    casan('fizo', 'hizo');
    casan('fasta', 'hasta');
    casan('estonces', 'entonces');
    casan('vuessa merced', 'vuestra merced');
    expect(es('desta')).toBe(es('de esta'));
    expect(es('dellos')).toBe(es('de ellos'));
  });

  it('versos de Lope: la consulta moderna casa con el texto fiel', () => {
    const contiene = (texto: string, consulta: string) => {
      const n = ` ${es(texto)} `;
      for (const w of es(consulta).split(' ')) expect(n, `«${consulta}» en «${texto}»`).toContain(` ${w} `);
    };
    contiene(LOPE.vientos, 'ejército viento banderas asiento');
    contiene(LOPE.vengarse, 'vengarse');
    contiene(LOPE.roldan, 'qué Roldán Aragonés');
    contiene(LOPE.tilde, 'que banderas blasón');
    contiene(LOPE.conquistar, 'que reino conquistar confío');
    contiene(LOPE.quantos, 'cuántos castillos has');
    contiene(LOPE.corazon, 'corazón prisión más');
    contiene(LOPE.christiana, 'cristiana estorba rey');
    contiene(LOPE.assi, 'así dice');
    contiene(LOPE.alexado, 'alejado habemos');
    contiene(LOPE.presso, 'preso inocente');
    contiene(LOPE.roxo, 'rojo');
    contiene(LOPE.traygo, 'traigo bandera');
    contiene(LOPE.prission, 'prisión años');
    contiene(LOPE.caxas, 'esas cajas');
  });

  it('el texto normalizado no lleva puntuación ni marcas', () => {
    expect(es(LOPE.roldan)).toBe('al que roldan como tu sobrino mio i el brabo aragones brabonel fuerte');
  });
});

describe('latín', () => {
  it('u/v, i/j, æ, œ', () => {
    expect(normalizarPalabra('vita', 'la').p).toBe('uita');
    expect(normalizarPalabra('Iulius', 'la').p).toBe('iulius');
    expect(normalizarPalabra('Julius', 'la').p).toBe('iulius');
    expect(normalizarPalabra('cælum', 'la').p).toBe(normalizarPalabra('caelum', 'la').p);
    expect(normalizarPalabra('caelum', 'la').p).toBe(normalizarPalabra('celum', 'la').p);
    expect(normalizarPalabra('pœna', 'la').p).toBe(normalizarPalabra('poena', 'la').p);
    expect(normalizarPalabra('gracia', 'la').p).toBe(normalizarPalabra('gratia', 'la').p);
    expect(normalizarPalabra('michi', 'la').p).toBe('mihi');
  });

  it('enclíticos aparte', () => {
    expect(separarEnclitico('uirumque')).toEqual(['uirum', 'que']);
    expect(separarEnclitico('atque')).toEqual(['atque', null]);
    expect(separarEnclitico('quoque')).toEqual(['quoque', null]);
    expect(separarEnclitico('estne')).toEqual(['est', 'ne']);
    expect(separarEnclitico('nonne')).toEqual(['non', 'ne']);
    expect(separarEnclitico('bene')).toEqual(['bene', null]);
    expect(separarEnclitico('omne')).toEqual(['omne', null]);
    expect(separarEnclitico('plusue')).toEqual(['plus', 'ue']);
    expect(normalizarParaBusqueda('Arma virumque cano', 'la').startsWith('arma uirum que cano')).toBe(true);
  });

  it('raíces de Schinke', () => {
    expect(raizNominal('amoris')).toBe('amor');
    expect(raizNominal('rosarum')).toBe('rosar');
    expect(raizNominal('dominus')).toBe('domin');
    expect(raizNominal('domini')).toBe('domin');
    expect(raizNominal('dominorum')).toBe('dominor');
    expect(raizVerbal('amabant')).toBe('amaba');
    expect(raizVerbal('amauerunt')).toBe('amaui');
    expect(raizVerbal('legebatur')).toBe('legeba');
    expect(raizVerbal('amabo')).toBe('amabi');
  });

  it('formas distintas de un mismo nombre comparten raíz en el texto de búsqueda', () => {
    const tokens = (t: string) => new Set(normalizarParaBusqueda(t, 'la').split(' '));
    for (const forma of ['dominus', 'domini', 'domino', 'dominum', 'domine']) expect(tokens(forma).has('domin')).toBe(true);
    for (const forma of ['amor', 'amoris', 'amorem', 'amore']) expect(tokens(forma).has('amor') || tokens(forma).has('amo')).toBe(true);
  });

  it('las raíces van al final y no rompen las frases', () => {
    const r = normalizarDetallado('Gallia est omnis divisa in partes tres', 'la');
    expect(r.principal).toBe('gallia est omnis diuisa in partes tres');
    expect(r.extras).toContain('gall');
    expect(r.extras).toContain('part');
  });

  it('palabraLatin no saca raíces de palabras de la lista de -que', () => {
    expect(palabraLatin('itaque')).toEqual({ p: 'itaque', x: null });
  });
});

describe('francés e italiano antiguos', () => {
  const fr = (t: string) => normalizarParaBusqueda(t, 'fr', 'antigua');
  const it_ = (t: string) => normalizarParaBusqueda(t, 'it', 'antigua');
  it('francés', () => {
    expect(fr('Il estoit une fois un roy')).toBe(fr('Il était une fois un roi'));
    expect(fr('elle avoit')).toBe(fr('elle avait'));
    expect(fr('le maistre')).toBe(fr('le maître'));
    expect(fr('la mesme nuict')).toBe(fr('la même nuit'));
    expect(fr('celuy')).toBe(fr('celui'));
    expect(fr('auoir')).toBe(fr('avoir'));
    expect(fr('vn homme')).toBe(fr('un homme'));
    expect(fr('il soit')).toBe('il soit');
    expect(fr('sçavoir')).toBe(fr('savoir'));
  });
  it('italiano', () => {
    expect(it_("L'huomo")).toBe(it_("L'uomo"));
    expect(it_('hauere')).toBe(it_('avere'));
    expect(it_('gratia')).toBe(it_('grazia'));
    expect(it_('operatione')).toBe(it_('operazione'));
    expect(it_('hoggi')).toBe(it_('oggi'));
    expect(it_('io ho')).toBe('io ho');
    expect(it_('historia')).toBe(it_('istoria'));
    expect(it_('et')).toBe('e');
  });
  it('detección francesa', () => {
    expect(detectarEpoca("Il estoit une fois un roy qui avoit une fille, et celuy qui la vouloit avoit la mesme foy.", 'fr')).toBe('antigua');
    expect(detectarEpoca("Il était une fois un roi qui avait une fille, et celui qui la voulait avait la même foi.", 'fr')).toBe('moderna');
  });
});

describe('textoBusqueda (lo que se guarda)', () => {
  it('vacío en documentos modernos y en lenguas sin reglas', () => {
    expect(textoBusqueda('El panóptico es una máquina de disociar la pareja ver-ser visto.', 'es')).toBe('');
    expect(textoBusqueda('Attention is all you need. The Transformer allows for significantly more parallelization.', 'en')).toBe('');
    expect(textoBusqueda('', 'es')).toBe('');
    expect(textoBusqueda('Lo que sea', null)).toBe('');
  });
  it('lleno en textos antiguos y en latín', () => {
    expect(textoBusqueda(LOPE.corazon + '\n' + LOPE.assi + '\n' + LOPE.roldan, 'es')).toContain('asi');
    expect(textoBusqueda('Arma virumque cano', 'la')).toContain('uirum que');
  });
  it('el año fuerza la capa aunque el fragmento sea corto', () => {
    expect(textoBusqueda('Hazme obligado.', 'es', 1618)).toBe('azme obligado');
  });
});

describe('variantes de la consulta', () => {
  it('incluyen las claves antiguas, no la propia palabra', () => {
    expect(variantesConsulta('honra')).toContain('onra');
    expect(variantesConsulta('ahora')).toContain('aora');
    expect(variantesConsulta('vida')).toContain('bida');
    expect(variantesConsulta('vita')).toContain('uita');
    expect(variantesConsulta('así')).not.toContain('asi');
  });
  it('raíces latinas para palabras sueltas, sin enclíticos sueltos', () => {
    const v = variantesConsulta('virumque');
    expect(v).toContain('uirum');
    expect(v).not.toContain('que');
  });
  it('una frase da frases', () => {
    const v = variantesConsulta('así es la vida');
    expect(v).toContain('asi es la bida');
    expect(v.every((x) => x.split(' ').length === 4)).toBe(true);
  });
  it('plegado básico como FTS5', () => {
    expect(plegadoBasico('¿Qué?  Ñandú, «corazón»')).toBe('que nandu corazon');
  });
});

describe('rendimiento', () => {
  it('normaliza más de 5 MB/s', () => {
    const base = Object.values(LOPE).join('\n') + '\n';
    const texto = base.repeat(Math.ceil(2_000_000 / base.length));
    normalizarParaBusqueda(texto.slice(0, 50_000), 'es', 'antigua'); // calienta la memoria de palabras
    const t0 = performance.now();
    normalizarParaBusqueda(texto, 'es', 'antigua');
    const ms = performance.now() - t0;
    const mbs = texto.length / 1e6 / (ms / 1000);
    expect(mbs).toBeGreaterThan(5);
  });
});

describe('epocaDeDocumento', () => {
  it('año antiguo, código antiguo o señales en el texto', async () => {
    const { epocaDeDocumento } = await import('../src/index.js');
    expect(epocaDeDocumento('Texto moderno sin nada raro.', 'es', 1618)).toBe('antigua');
    expect(epocaDeDocumento([LOPE.vientos, LOPE.roldan, LOPE.assi], 'es', 1990)).toBe('antigua');
    expect(epocaDeDocumento(['Texto moderno sin nada raro.'], 'es', 1990)).toBe('moderna');
    expect(epocaDeDocumento(['lo que sea'], 'la')).toBe('antigua');
    expect(epocaDeDocumento(['whatever'], 'en', 1600)).toBe('moderna');
  });
});
