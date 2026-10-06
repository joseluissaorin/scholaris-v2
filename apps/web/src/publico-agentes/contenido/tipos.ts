import type { Dibujo } from '../../dibujo/boceto';

export type Lengua = 'es' | 'en';

export interface Version {
  /** El titular de la hoja (h1, <title>, og:title). */
  titulo: string;
  /** Una o dos frases: entradilla, meta description y resumen en llms.txt. */
  descripcion: string;
  /** Nombre corto para el índice lateral y las migas. */
  corto?: string;
  /** El cuerpo en Markdown, empezando por «## ». */
  md: string;
}

export interface Pagina {
  clave: string;
  rutas: Record<Lengua, string>;
  /** Tipo de schema.org de la hoja (por defecto, TechArticle). */
  tipo?: 'TechArticle' | 'FAQPage' | 'AboutPage' | 'CollectionPage' | 'WebPage';
  /** Un boceto pequeño para el margen. */
  boceto?: Dibujo;
  /** Una sección con pasos numerados que también se publica como HowTo. */
  comoSe?: { id: string; es: string; en: string };
  es: Version;
  en: Version;
}
