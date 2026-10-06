# scholaris-sdk

Cliente de Python para [Scholaris](https://scholaris.joseluissaorin.com), la
biblioteca académica que lee tus fuentes (PDF, EPUB, webs, vídeos, pódcast) y
cita con el número de página impreso, verificado contra el texto. Incluye
además un lector de SPDF 4.0 que funciona sin conexión.

*Python client for Scholaris: upload sources, search them, ask questions and
get citations with verified printed page numbers; plus an offline reader for
SPDF 4.0 files. The API speaks Spanish identifiers; errors carry both a Spanish
`mensaje` and an English `message`.*

```bash
pip install scholaris-sdk                 # solo depende de requests
pip install "scholaris-sdk[vectores]"     # numpy, para la búsqueda vectorial sin conexión
```

El paquete se importa como `scholaris`. Requiere Python 3.9 o posterior.

## Primeros pasos con la instancia pública

Crea una clave en Scholaris (Ajustes → Claves de API) y guárdala en la
variable `SCHOLARIS_CLAVE` o pásala directamente:

```python
from scholaris.api import Scholaris

s = Scholaris("sch_…")                        # o la variable SCHOLARIS_CLAVE
doc = s.subir("articulo.pdf")                  # también una URL: web, PDF, YouTube, pódcast
for p in s.buscar("atención escalada", k=3):
    print(p["cita"], p["texto"][:80])          # «(Vaswani et al., 2017, p. 4)»
print(s.preguntar("¿Qué es la atención multicabeza?")["respuesta"])   # Markdown con notas [^n]
print(s.citar("La atención sustituye a la recurrencia.")["texto"])
print(s.verificar("El Transformer prescinde de la recurrencia.")["veredicto"])
print(s.texto(doc["id"], desde="23", hasta="25", markdown=True))       # páginas por su folio impreso
```

`scholaris.api` es la API pública v1 (`/api/v1`), pensada para lo más común.
La guía completa está en <https://scholaris.joseluissaorin.com/api>. Los errores
son `ErrorScholaris`, con `codigo`, `mensaje` (español) y `message` (inglés).

## Contra un servidor local

Scholaris también funciona en tu ordenador con SQLite y el disco. Desde el
repositorio:

```bash
pnpm install
pnpm --filter @scholaris/local start      # escucha en http://localhost:8790
```

```python
from scholaris.api import Scholaris

s = Scholaris(base="http://localhost:8790")   # sin clave si no defines SCHOLARIS_TOKEN
```

Si arrancas el servidor con `SCHOLARIS_TOKEN=…`, pasa ese mismo valor como
clave. La URL por defecto también se puede fijar con la variable `SCHOLARIS_URL`.

## La API completa (v2)

Bibliotecas compartidas, metadatos, autocitas de documentos enteros, paquetes
`.scholaris` y descarga de SPDF:

```python
from scholaris.v2 import Scholaris

s = Scholaris("https://scholaris.joseluissaorin.com", clave="sch_…")
doc = s.subir("articulo.pdf")                     # sube, convierte y espera a que esté listo
s.subir_url("https://www.youtube.com/watch?v=…")
for r in s.buscar("atención escalada", k=5):
    print(r["citaCorta"], r["fragmento"]["texto"][:80])
print(s.respuesta("¿Qué es la atención multicabeza?")["texto"])
s.descargar_spdf(doc["id"], "articulo.spdf")
autocita = s.autocitar("mi-trabajo.docx", estilo="apa")
s.exportar_autocita(autocita["id"], "mi-trabajo-citado.docx")
```

Los errores son `ErrorApi`, con `estado`, `codigo` y `mensaje`.

## SPDF 4.0 sin conexión

Un SPDF es el documento ya procesado (texto por páginas con su folio impreso,
fragmentos, metadatos y, si se quiere, el original) en un único fichero
SQLite. Se lee sin red ni clave:

```python
from scholaris.v2 import SPDF

with SPDF.abrir("vigilar.spdf") as s:
    print(s.documento["metadatos"]["titulo"])
    for f in s.buscar("panóptico", k=5):       # FTS5, insensible a acentos
        print(f.cita, f.texto[:80])            # «(Foucault, 1975, p. 23) …»
    print(s.pagina("145").texto)               # por número de página impreso
```

## La v1 local

La primera versión de Scholaris (procesado local con PyMuPDF y Gemini,
`CitationIndex`, SPDF 1.0 a 3.0 y la orden `scholaris`) sigue dentro del
paquete como extra opcional:

```bash
pip install "scholaris-sdk[v1]"
```

Su documentación está en <https://github.com/joseluissaorin/scholaris>.

## Nota sobre el nombre

En PyPI ya existe un proyecto distinto llamado `scholaris`, que también se
importa como `scholaris`. No instales los dos en el mismo entorno.

## Licencia

[EUPL-1.2](https://interoperable-europe.ec.europa.eu/collection/eupl/eupl-text-eupl-12).
Código fuente: <https://github.com/joseluissaorin/scholaris-v2>.
