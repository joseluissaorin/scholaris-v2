"""Rehace apps/web/public/portada/mano.woff2: «Nothing You Could Do» (OFL) con la «í» y la «ï» redibujadas
(el asta de la «i» sin punto + el acento agudo de la propia fuente, el de «é» y
«á»; la tilde original de la «í» es un trazo finísimo que no se ve) y el
subconjunto con todo el repertorio español.

Uso (la fuente original, OFL, de github.com/google/fonts/tree/main/ofl/nothingyoucoulddo):
    python3 scripts/rehacer-mano.py NothingYouCouldDo.ttf public/portada/mano.woff2
Comprobación: python3 scripts/rehacer-mano.py --comprobar public/portada/mano.woff2
"""
import sys, copy

ESPANOL = 'áéíóúüñÁÉÍÓÚÜÑ¿¡«»—'

def comprobar(ruta):
    from fontTools.ttLib import TTFont
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    f = TTFont(ruta); cm = f.getBestCmap(); gs = f.getGlyphSet()
    faltan = [c for c in ESPANOL if ord(c) not in cm]
    def dibujo(n):
        p = DecomposingRecordingPen(gs); gs[n].draw(p); return p.value
    i, ii = cm[ord('i')], cm.get(ord('í'))
    propio = ii is not None and ii != i and dibujo(ii) != dibujo(i)
    con_acento = ii is not None and f['glyf'][ii].isComposite() and any(c.glyphName == 'acute.i' for c in f['glyf'][ii].components)
    print(f'faltan: {faltan or "ninguno"} · í -> {ii} (glifo propio: {propio}, con acento: {con_acento})')
    return not faltan and propio and con_acento

if len(sys.argv) > 2 and sys.argv[1] == '--comprobar':
    sys.exit(0 if comprobar(sys.argv[2]) else 1)
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent, GlyphCoordinates
from fontTools.subset import Subsetter, Options

orig, salida = sys.argv[1], sys.argv[2]
DX = int(sys.argv[3]) if len(sys.argv) > 3 else -40
DY = int(sys.argv[4]) if len(sys.argv) > 4 else 10
f = TTFont(orig)
glyf, hmtx = f['glyf'], f['hmtx']

# 1. «dotlessi»: el primer contorno de la «i» (el asta), sin el punto.
i = glyf['i']
fin = i.endPtsOfContours[0]
asta = Glyph()
asta.numberOfContours = 1
asta.coordinates = GlyphCoordinates(list(i.coordinates)[: fin + 1])
asta.flags = bytearray(i.flags[: fin + 1])
asta.endPtsOfContours = [fin]
asta.program = copy.deepcopy(i.program) if hasattr(i, 'program') else None
if asta.program is None:
    from fontTools.ttLib.tables import ttProgram
    asta.program = ttProgram.Program(); asta.program.fromBytecode(b'')
orden = f.getGlyphOrder()
if 'dotlessi' not in glyf:
    orden.append('dotlessi')
    f.setGlyphOrder(orden)
glyf.glyphs['dotlessi'] = asta
glyf.glyphOrder = orden
asta.recalcBounds(glyf)
hmtx['dotlessi'] = (hmtx['i'][0], asta.xMin)

def compuesto(nombre, partes):
    g = Glyph(); g.numberOfContours = -1; g.components = []
    for base, x, y in partes:
        c = GlyphComponent(); c.glyphName = base; c.x = x; c.y = y; c.flags = 0x4 if base == partes[0][0] else 0
        g.components.append(c)
    glyf.glyphs[nombre] = g
    g.recalcBounds(glyf)
    hmtx[nombre] = (hmtx['i'][0], g.xMin)

# 2. «í» = asta + un acento propio. El de la fuente es un trazo corto en la misma
#    dirección que el asta inclinada: sobre la «i» se lee como asta alargada o como
#    el punto. Este se separa del asta, sube hacia la derecha y engorda al final,
#    como los acentos de «é» y «á» trazados con la misma pluma.
from fontTools.pens.ttGlyphPen import TTGlyphPen
p = TTGlyphPen(None)
x0, y0 = DX, DY
p.moveTo((112 + x0, 432 + y0))
p.qCurveTo((210 + x0, 492 + y0), (300 + x0, 566 + y0))
p.qCurveTo((326 + x0, 588 + y0), (346 + x0, 566 + y0))
p.qCurveTo((360 + x0, 546 + y0), (334 + x0, 524 + y0))
p.qCurveTo((236 + x0, 452 + y0), (140 + x0, 406 + y0))
p.qCurveTo((110 + x0, 394 + y0), (112 + x0, 432 + y0))
p.closePath()
acento = p.glyph()
orden = f.getGlyphOrder(); orden.append('acute.i'); f.setGlyphOrder(orden); glyf.glyphOrder = orden
glyf.glyphs['acute.i'] = acento; acento.recalcBounds(glyf)
hmtx['acute.i'] = (hmtx['i'][0], acento.xMin)
compuesto('iacute', [('dotlessi', 0, 0), ('acute.i', 0, 0)])
# «ï» igual: asta + diéresis de la fuente, centrada sobre el asta.
compuesto('idieresis', [('dotlessi', 0, 0), ('dieresis', -110, 0)])

cmap_es = set(range(0x20, 0x7F)) | {ord(c) for c in '¡¿«»°·ÁÉÍÓÚÜÑáéíóúüñ—–‘’“”…ïÏ'}
o = Options(); o.flavor = 'woff2'; o.layout_features = ['*']; o.name_IDs = ['*']; o.notdef_outline = True
o.glyph_names = True; o.hinting = False; o.desubroutinize = True
s = Subsetter(o); s.populate(unicodes=sorted(cmap_es)); s.subset(f)
f.flavor = 'woff2'; f.save(salida)
sys.exit(0 if comprobar(salida) else 1)
