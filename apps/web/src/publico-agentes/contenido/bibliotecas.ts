import type { Pagina } from './tipos';
import { latas } from '../../bocetos/dibujos/latas';

export const bibliotecas: Pagina = {
  clave: 'bibliotecas',
  rutas: { es: '/saber/bibliotecas', en: '/en/knowledge/libraries' },
  boceto: latas,
  es: {
    titulo: 'Bibliotecas que se llenan de golpe y se comparten',
    corto: 'Bibliotecas',
    descripcion: 'Llenar una biblioteca con carpetas, ZIP, listas de enlaces o un BibTeX de Zotero; exportarla como paquete .scholaris; compartirla, seguirla, copiarla o publicarla con un enlace, respetando sus derechos.',
    md: `## Llenar una biblioteca de una vez

Desde «Llenar biblioteca» se puede soltar una carpeta entera, muchos ficheros, un ZIP, una lista de enlaces, un BibTeX o RIS con la carpeta de Zotero al lado, o un montón de .spdf. Antes de empezar, Scholaris enseña cuánto va a tardar y cuánto va a costar, y deja elegir entre dos modos:

| Modo | Qué hace | Para qué |
| --- | --- | --- |
| Rápido | Lee en el momento | Cuando lo necesitas hoy |
| Económico | Las páginas difíciles van por el lote de Gemini, a mitad de precio, y las fáciles por un lector más barato; tarda horas | Para llenar una biblioteca grande |

Los ficheros repetidos (misma huella SHA-256) se detectan y no se leen dos veces. El lote se puede pausar y reanudar.

## Paquetes .scholaris

Una biblioteca entera se exporta como un fichero **.scholaris**: un ZIP con un [.spdf](/saber/spdf) por documento, un \`manifest.json\` con la biblioteca, sus derechos y sus documentos, y un \`LEEME.txt\`. Se puede incluir o no los originales y los vectores. Importarlo en otra cuenta, o en la versión local, no vuelve a leer nada.

## Compartir

- **Invitar** por correo, con permiso de lectura, de edición o de administración, y con caducidad (de un día a diez años).
- **Seguir** una biblioteca que te han compartido, y buscar en ella junto a las tuyas.
- **Copiar** a tu biblioteca: la copia es por referencia, así que no se duplican los ficheros ni se vuelve a leer nada.
- **Enlace público** de solo lectura, con contraseña opcional, caducidad, contador de visitas y posibilidad de revocarlo. Las páginas de esos enlaces piden a los buscadores que no las indexen.

## Derechos

Cada biblioteca declara sus derechos: sin indicar, dominio público, CC0, CC BY, CC BY-SA, CC BY-NC, CC BY-NC-SA, uso privado o con permiso. Para publicar con un enlace una biblioteca que no es abierta hay que confirmar que es para uso privado, y el paquete de una biblioteca no abierta lleva un aviso de no redistribuir. Compartir un libro con derechos con quien no debe es responsabilidad de quien lo comparte; Scholaris solo te pregunta antes.
`,
  },
  en: {
    titulo: 'Libraries that fill up at once and can be shared',
    corto: 'Libraries',
    descripcion: 'Fill a library with folders, ZIPs, lists of links or a Zotero BibTeX; export it as a .scholaris package; share it, follow it, copy it or publish it with a link, respecting its rights.',
    md: `## Filling a library in one go

From "Llenar biblioteca" (fill library) you can drop a whole folder, many files, a ZIP, a list of links, a BibTeX or RIS file with its Zotero folder beside it, or a pile of .spdf files. Before starting, Scholaris shows how long it will take and what it will cost, and lets you choose between two modes:

| Mode | What it does | For |
| --- | --- | --- |
| Fast | Reads right away | When you need it today |
| Economy | Hard pages go through Gemini's batch API at half price and easy ones through a cheaper reader; takes hours | Filling a large library |

Repeated files (same SHA-256 hash) are detected and not read twice. A batch can be paused and resumed.

## .scholaris packages

A whole library exports as a **.scholaris** file: a ZIP with one [.spdf](/en/knowledge/spdf) per document, a \`manifest.json\` with the library, its rights and its documents, and a \`LEEME.txt\` (read-me). Originals and vectors are optional. Importing it into another account, or into the home version, reads nothing again.

## Sharing

- **Invite** by email, with read, edit or admin permission, and an expiry (from one day to ten years).
- **Follow** a library shared with you, and search it alongside your own.
- **Copy** into your library: the copy is by reference, so no files are duplicated and nothing is read again.
- **Public read-only link**, with an optional password, expiry, visit counter and the option to revoke it. Those pages ask search engines not to index them.

## Rights

Every library declares its rights: unspecified, public domain, CC0, CC BY, CC BY-SA, CC BY-NC, CC BY-NC-SA, private use or with permission. To publish a library that is not open through a link you must confirm it is for private use, and the package of a non-open library carries a do-not-redistribute notice. Sharing a copyrighted book with someone who should not have it is the sharer's responsibility; Scholaris only asks you first.
`,
  },
};
