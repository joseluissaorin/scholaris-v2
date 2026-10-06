/**
 * El motor del reproductor: UN solo elemento de medio para toda la aplicación.
 *
 * - Vive fuera de React. El elemento va dentro de un «marco» que se cambia de
 *   sitio (el escenario del lector, el reproductor pequeño, o un aparcamiento
 *   invisible): moverlo dentro del documento no lo para, así que el audio sigue
 *   sonando al cambiar de sección.
 * - Las banderas pasan por la máquina pura (`maquina.ts`); el motor solo
 *   traduce eventos del elemento y ejecuta lo que la máquina decide (renovar
 *   la URL firmada y seguir en el mismo instante).
 * - El tiempo no pasa por el estado de React: quien lo necesita por fotograma
 *   (la línea, el karaoke, el reloj) se suscribe con `escucharTiempo` y toca
 *   el DOM directamente.
 */
import { estadoDe, INICIAL, transicion, puntoDePartida, type Banderas, type Estado, type Evento } from './maquina';
import { RelojVirtual } from './reloj-virtual';
import { MedioYoutube } from './medio-youtube';
import { ponerMini } from './estado-global';

export interface FuenteMedio {
  documento: string;
  tipo: 'audio' | 'video';
  titulo: string;
  autores?: string;
  portada?: string;
  /** Duración conocida (de la ficha), antes de que lleguen los metadatos. */
  duracion?: number;
  /**
   * URL firmada del archivo (null: no hay archivo; reloj virtual). Con `renovar`
   * hay que pedir una nueva (la anterior caducó o falló); sin él vale la de la caché.
   */
  url: (renovar?: boolean) => Promise<string | null>;
  /** Vídeo de YouTube: se reproduce con su reproductor insertado, sin descargar nada (la URL no se pide). */
  youtube?: string;
}

export interface Instantanea {
  estado: Estado;
  /** La persona quiere que suene (aunque esté esperando datos o buscando). */
  quiere: boolean;
  documento: string | null;
  tipo: 'audio' | 'video' | null;
  titulo: string;
  duracion: number;
  velocidad: number;
  volumen: number;
  silencio: boolean;
  subtitulos: boolean;
  hayPista: boolean;
  pip: boolean;
  pantallaCompleta: boolean;
  /** Dónde está el marco: el lector, el reproductor pequeño o ninguno. */
  lugar: 'lector' | 'mini' | null;
  mini: boolean;
  error: string | null;
  tipoError: 'red' | 'formato' | 'agotado' | null;
  /** Instante desde el que se retomó automáticamente (para ofrecer «Desde el principio»). */
  retomado: number | null;
  virtual: boolean;
  /** Ya sonó alguna vez desde que se cargó (el botón grande solo hace falta antes). */
  haSonado: boolean;
  /** Proporción del vídeo (ancho / alto) en cuanto se conoce. */
  aspecto: number | null;
  /** Mensaje breve sobre la imagen («+10 s», «1,25×»). `n` cambia en cada aviso. */
  osd: { texto: string; n: number } | null;
}

type ElementoMedio = HTMLVideoElement | RelojVirtual | MedioYoutube;

const CLAVE_POSICIONES = 'scholaris.reproductor.posiciones';
const CLAVE_PREFERENCIAS = 'scholaris.reproductor.preferencias';

interface Posicion { t: number; d?: number; cuando: number }

function leerPosiciones(): Record<string, Posicion> {
  try { return JSON.parse(localStorage.getItem(CLAVE_POSICIONES) ?? '{}') as Record<string, Posicion>; } catch { return {}; }
}

export function posicionGuardada(documento: string): Posicion | null {
  return leerPosiciones()[documento] ?? null;
}

function guardarPosicionDe(documento: string, t: number, d?: number) {
  try {
    const todas = leerPosiciones();
    todas[documento] = { t: Math.round(t * 10) / 10, ...(d ? { d: Math.round(d) } : {}), cuando: Date.now() };
    const claves = Object.keys(todas);
    if (claves.length > 300) {
      claves.sort((a, b) => todas[a]!.cuando - todas[b]!.cuando).slice(0, claves.length - 300).forEach((k) => delete todas[k]);
    }
    localStorage.setItem(CLAVE_POSICIONES, JSON.stringify(todas));
  } catch { /* sin almacenamiento */ }
}

function leerPreferencias(): { velocidad: number; volumen: number; silencio: boolean; subtitulos: boolean } {
  const base = { velocidad: 1, volumen: 1, silencio: false, subtitulos: false };
  try { return { ...base, ...(JSON.parse(localStorage.getItem(CLAVE_PREFERENCIAS) ?? '{}') as object) }; } catch { return base; }
}

const numeroCorto = (v: number) => String(v).replace('.', ',');

export class Motor {
  private b: Banderas = INICIAL;
  private fuente: FuenteMedio | null = null;
  private video: HTMLVideoElement | null = null;
  private virtual: RelojVirtual | null = null;
  private externo: MedioYoutube | null = null;
  readonly marco: HTMLDivElement | null = null;
  private aparcamiento: HTMLDivElement | null = null;
  private anfitrion: HTMLElement | null = null;
  private lugar: 'lector' | 'mini' | null = null;
  private miniActivo = false;
  private pendiente: number | null = null;
  /** Pausas que provoca el propio motor al soltar un medio: su evento «pause» llega tarde y no es de la persona. */
  private pausasPropias = 0;
  private ficha = 0;
  private oyentes = new Set<() => void>();
  private oyentesTiempo = new Set<(t: number) => void>();
  private inst: Instantanea;
  private bucle = 0;
  private ultimoGuardado = 0;
  private ultimaPosicionSesion = 0;
  private esperandoDesde = 0;
  private vigilante: ReturnType<typeof setInterval> | null = null;
  private retomado: number | null = null;
  private osd: Instantanea['osd'] = null;
  private nOsd = 0;
  private pistaUrl: string | null = null;
  /** Los subtítulos del documento en curso (se ponen en cuanto exista el elemento). */
  private vtt: string | null = null;
  private pref = leerPreferencias();
  private pantalla = false;
  private pip = false;
  private error: string | null = null;
  private haSonado = false;
  /** Soltar el medio al salir del lector se aplaza un instante: si otro escenario lo acoge enseguida (un remontaje), no se suelta. */
  private soltar: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.inst = this.calcular();
    if (typeof document === 'undefined') return;
    const marco = document.createElement('div');
    marco.className = 'reproductor-marco';
    (this as { marco: HTMLDivElement | null }).marco = marco;
    const ap = document.createElement('div');
    ap.setAttribute('aria-hidden', 'true');
    ap.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;overflow:hidden;pointer-events:none;';
    document.body.appendChild(ap);
    ap.appendChild(marco);
    this.aparcamiento = ap;
    document.addEventListener('fullscreenchange', () => { this.pantalla = !!document.fullscreenElement; this.emitir(); });
    window.addEventListener('pagehide', () => this.guardarPosicion(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.guardarPosicion(true); });
  }

  // ------------------------------------------------------------------ estado

  suscribir = (o: () => void) => { this.oyentes.add(o); return () => { this.oyentes.delete(o); }; };
  instantanea = () => this.inst;

  private calcular(): Instantanea {
    const el = this.medio();
    const dur = el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (this.fuente?.duracion ?? 0);
    return {
      estado: estadoDe(this.b),
      quiere: this.b.quiere,
      documento: this.fuente?.documento ?? null,
      tipo: this.fuente?.tipo ?? null,
      titulo: this.fuente?.titulo ?? '',
      duracion: dur,
      velocidad: this.pref.velocidad,
      volumen: this.pref.volumen,
      silencio: this.pref.silencio,
      subtitulos: this.pref.subtitulos,
      hayPista: !!this.pistaUrl,
      pip: this.pip,
      pantallaCompleta: this.pantalla,
      lugar: this.lugar,
      mini: this.miniActivo && !!this.fuente && this.lugar !== 'lector',
      error: this.b.error?.mensaje ?? this.error,
      tipoError: this.b.error?.tipo ?? null,
      retomado: this.retomado,
      virtual: !!this.virtual,
      haSonado: this.haSonado,
      aspecto: this.externo ? 16 / 9 : this.video && !this.virtual && this.video.videoWidth ? this.video.videoWidth / this.video.videoHeight : null,
      osd: this.osd,
    };
  }

  private emitir() {
    const n = this.calcular();
    const v = this.inst;
    let cambia = false;
    for (const k of Object.keys(n) as Array<keyof Instantanea>) if (n[k] !== v[k]) { cambia = true; break; }
    if (!cambia) return;
    this.inst = n;
    ponerMini(n.mini);
    for (const o of this.oyentes) o();
  }

  /** Los últimos eventos y decisiones (para diagnosticar; en desarrollo, en `window.__motor`). */
  readonly registro: string[] = [];

  private despachar(e: Evento) {
    const { banderas, accion } = transicion(this.b, e);
    this.registro.push(`${Math.round(performance.now())} ${e.tipo}${'codigo' in e ? `:${e.codigo}` : ''} → ${estadoDe(banderas)}${banderas.quiere ? ' (quiere)' : ''}${accion ? ` · ${accion.tipo} ${accion.esperaMs} ms` : ''}`);
    if (this.registro.length > 80) this.registro.shift();
    this.b = banderas;
    if (accion?.tipo === 'renovar') this.renovar(accion.esperaMs);
    this.vigilar();
    this.emitir();
  }

  // ------------------------------------------------------------------ tiempo

  /** Tiempo actual (el pedido, si aún no hay metadatos). */
  tiempo(): number {
    if (this.pendiente != null) return this.pendiente;
    return this.medio()?.currentTime ?? 0;
  }

  /** Rangos ya descargados, como fracciones [0-1]. */
  cargado(): Array<[number, number]> {
    const el = this.medio();
    const d = this.inst.duracion;
    if (!el || !d) return [];
    const out: Array<[number, number]> = [];
    for (let i = 0; i < el.buffered.length; i++) out.push([el.buffered.start(i) / d, el.buffered.end(i) / d]);
    return out;
  }

  escucharTiempo(fn: (t: number) => void): () => void {
    this.oyentesTiempo.add(fn);
    fn(this.tiempo());
    return () => { this.oyentesTiempo.delete(fn); };
  }

  private avisarTiempo() {
    const t = this.tiempo();
    for (const o of this.oyentesTiempo) o(t);
  }

  private arrancarBucle() {
    if (this.bucle) return;
    const paso = () => {
      const el = this.medio();
      this.avisarTiempo();
      const ahora = performance.now();
      if (ahora - this.ultimoGuardado > 5000) { this.ultimoGuardado = ahora; this.guardarPosicion(); }
      if (ahora - this.ultimaPosicionSesion > 1000) { this.ultimaPosicionSesion = ahora; this.posicionSesion(); }
      if (el && !el.paused) this.bucle = requestAnimationFrame(paso);
      else this.bucle = 0;
    };
    this.bucle = requestAnimationFrame(paso);
  }

  // ------------------------------------------------------------------ fuente

  private medio(): ElementoMedio | null { return this.virtual ?? this.externo ?? this.video; }

  private crearVideo(): HTMLVideoElement {
    if (this.video) { this.video.hidden = false; return this.video; }
    const v = document.createElement('video');
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto';
    v.className = 'reproductor-video';
    v.disablePictureInPicture = false;
    this.escucharElemento(v);
    this.marco!.appendChild(v);
    this.video = v;
    if (this.vtt) this.ponerPista(this.vtt);
    return v;
  }

  private escucharElemento(el: ElementoMedio) {
    const en = (tipo: string, fn: () => void) => el.addEventListener(tipo, fn);
    en('loadedmetadata', () => {
      if (this.medio() !== el) return;
      if (this.pendiente != null) {
        const t = Math.min(this.pendiente, Math.max(0, (el.duration || Infinity) - 0.25));
        el.currentTime = t;
        this.pendiente = null;
      }
      this.aplicarPreferencias();
      this.despachar({ tipo: 'metadatos' });
      if (this.b.quiere && el.paused) this.reproducirElemento();
      this.avisarTiempo();
    });
    en('durationchange', () => this.emitir());
    en('resize', () => this.emitir());
    en('canplay', () => this.medio() === el && this.despachar({ tipo: 'datos' }));
    en('play', () => { if (this.medio() === el) { this.despachar({ tipo: 'play' }); this.arrancarBucle(); } });
    en('playing', () => { if (this.medio() === el) { this.haSonado = true; this.despachar({ tipo: 'avanza' }); this.arrancarBucle(); } });
    en('pause', () => {
      if (this.pausasPropias > 0) { this.pausasPropias--; return; }
      if (this.medio() !== el) return;
      // Chrome pausa el elemento tras un error de red: no es la persona, y la intención de sonar se conserva para la recarga.
      if ((el as HTMLVideoElement).error) return;
      this.despachar({ tipo: 'pausa' });
      this.guardarPosicion(true);
      this.avisarTiempo();
    });
    en('waiting', () => this.medio() === el && this.despachar({ tipo: 'espera' }));
    en('seeking', () => { if (this.medio() === el) { this.despachar({ tipo: 'buscar' }); this.avisarTiempo(); } });
    en('seeked', () => { if (this.medio() === el) { this.despachar({ tipo: 'buscado' }); this.avisarTiempo(); } });
    en('timeupdate', () => { if (this.medio() === el && el.paused) this.avisarTiempo(); });
    en('progress', () => this.medio() === el && el.paused && this.avisarTiempo());
    en('ended', () => { if (this.medio() === el) { this.despachar({ tipo: 'fin' }); this.borrarPosicion(); } });
    en('ratechange', () => this.emitir());
    en('volumechange', () => this.emitir());
    en('error', () => {
      if (this.medio() !== el) return;
      const codigo = (el as HTMLVideoElement).error?.code ?? 0;
      if (!this.fuente || !codigo) return;
      this.despachar({ tipo: 'error', codigo });
    });
    en('enterpictureinpicture', () => { this.pip = true; this.emitir(); });
    en('leavepictureinpicture', () => { this.pip = false; this.emitir(); });
  }

  /**
   * Carga un documento. Si ya es el que suena, no recarga: solo salta al
   * instante pedido (si se pidió uno distinto) y, si se pide, suena.
   */
  async cargar(fuente: FuenteMedio, o: { t?: number; sonar?: boolean } = {}): Promise<void> {
    if (this.fuente?.documento === fuente.documento && this.b.fuente && !this.b.error) {
      this.fuente = { ...fuente, url: fuente.url };
      if (o.t != null && Math.abs(o.t - this.tiempo()) > 2) this.irA(o.t);
      if (o.sonar) this.sonar();
      this.emitir();
      return;
    }
    this.guardarPosicion(true);
    this.descargarElemento();
    this.ponerPista(null);
    const ficha = ++this.ficha;
    this.fuente = fuente;
    this.b = INICIAL;
    this.error = null;
    this.haSonado = false;
    const inicio = puntoDePartida(o.t, posicionGuardada(fuente.documento), fuente.duracion);
    this.retomado = inicio.retomado ? inicio.t : null;
    this.pendiente = inicio.t;
    this.despachar({ tipo: 'cargar' });
    if (o.sonar) this.despachar({ tipo: 'pedirSonar' });
    this.sesionMedios();
    if (fuente.youtube) {
      // YouTube: su reproductor insertado hace de elemento; el instante pendiente se aplica al estar listo.
      if (this.video) this.video.hidden = true;
      const y = new MedioYoutube(fuente.youtube, { inicio: this.pendiente ?? 0, ...(fuente.duracion ? { duracion: fuente.duracion } : {}) });
      this.externo = y;
      this.escucharElemento(y);
      this.marco!.appendChild(y.nodo);
      if (this.b.quiere) this.reproducirElemento();
      this.emitir();
      return;
    }
    let url: string | null;
    try { url = await fuente.url(); } catch { url = null; if (ficha === this.ficha) this.error = 'No se pudo pedir el archivo al servidor.'; }
    if (ficha !== this.ficha) return;
    if (!url) {
      if (this.error) { this.despachar({ tipo: 'error', codigo: 2 }); return; }
      // Sin archivo (demostración): reloj virtual con la duración de la ficha.
      const r = new RelojVirtual(fuente.duracion || 600);
      this.virtual = r;
      this.escucharElemento(r);
      this.emitir();
      return;
    }
    const v = this.crearVideo();
    // Fragmento de medio (#t=): el navegador pide el rango de ese instante en cuanto lee el índice, sin esperar a este código.
    v.src = this.pendiente ? `${url}#t=${this.pendiente.toFixed(2)}` : url;
    v.load();
    if (this.b.quiere) this.reproducirElemento();
    this.avisarTiempo();
  }

  /** Quita el medio (cierra el reproductor pequeño, o se abre otro). */
  descargar() {
    this.guardarPosicion(true);
    this.ficha++;
    this.descargarElemento();
    this.fuente = null;
    this.miniActivo = false;
    this.retomado = null;
    this.pendiente = null;
    this.ponerPista(null);
    this.despachar({ tipo: 'descargar' });
    this.avisarTiempo();
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  }

  private descargarElemento() {
    if (this.virtual) { this.virtual.pause(); this.virtual = null; }
    if (this.externo) { this.externo.destruir(); this.externo = null; }
    if (this.video) {
      if (!this.video.paused) { this.pausasPropias++; this.video.pause(); }
      this.video.removeAttribute('src');
      this.video.load();
    }
    cancelAnimationFrame(this.bucle);
    this.bucle = 0;
  }

  /** Pide otra URL firmada y sigue en el mismo instante (la máquina decide cuándo). */
  private renovar(esperaMs: number) {
    const fuente = this.fuente;
    const v = this.video;
    if (!fuente || !v) return;
    const ficha = this.ficha;
    const t = this.pendiente ?? v.currentTime;
    setTimeout(async () => {
      if (ficha !== this.ficha) return;
      let url: string | null = null;
      try { url = await fuente.url(true); } catch { /* se reintenta abajo */ }
      if (ficha !== this.ficha) return;
      if (!url) { this.despachar({ tipo: 'error', codigo: 2 }); return; }
      this.pendiente = t;
      this.despachar({ tipo: 'cargar' });
      v.src = url;
      v.load();
      if (this.b.quiere) this.reproducirElemento();
    }, esperaMs);
  }

  /** Vigilante de atascos: esperando datos más de 15 s con la intención de sonar. */
  private vigilar() {
    const estado = estadoDe(this.b);
    if (estado === 'esperando' || estado === 'cargando') {
      if (!this.esperandoDesde) this.esperandoDesde = performance.now();
      this.vigilante ??= setInterval(() => {
        const e = estadoDe(this.b);
        if (e !== 'esperando' && e !== 'cargando') { this.esperandoDesde = 0; clearInterval(this.vigilante!); this.vigilante = null; return; }
        if (this.b.quiere && performance.now() - this.esperandoDesde > 15_000) {
          this.esperandoDesde = performance.now();
          this.despachar({ tipo: 'atasco' });
        }
      }, 1000);
    } else {
      this.esperandoDesde = 0;
      if (this.vigilante) { clearInterval(this.vigilante); this.vigilante = null; }
    }
  }

  // ------------------------------------------------------------------ órdenes

  private reproducirElemento() {
    const el = this.medio();
    if (!el) return;
    const p = el.play();
    p?.catch((e: unknown) => {
      const nombre = (e as { name?: string })?.name;
      // El navegador no deja sonar sin un gesto: se queda en pausa, sin error.
      if (nombre === 'NotAllowedError') this.despachar({ tipo: 'pedirPausa' });
    });
  }

  sonar() {
    if (!this.fuente) return;
    if (this.b.error) { this.reintentar(); return; }
    this.despachar({ tipo: 'pedirSonar' });
    // Dentro del gesto, aunque aún no haya metadatos: Safari solo deja sonar así.
    if (this.medio()) this.reproducirElemento();
  }

  pausar() {
    this.despachar({ tipo: 'pedirPausa' });
    this.medio()?.pause();
  }

  alternar() {
    if (this.b.quiere && !this.b.error) this.pausar();
    else this.sonar();
  }

  reintentar() { this.despachar({ tipo: 'reintentar' }); }

  irA(t: number, o: { sonar?: boolean; osd?: string } = {}) {
    const el = this.medio();
    const dur = this.inst.duracion || Infinity;
    const x = Math.max(0, Math.min(dur - 0.05, t));
    this.retomado = null;
    if (!el || !this.b.metadatos) this.pendiente = x;
    else el.currentTime = x;
    if (o.osd) this.avisar(o.osd);
    this.avisarTiempo();
    if (o.sonar) this.sonar();
    this.emitir();
  }

  saltar(d: number) {
    this.irA(this.tiempo() + d, { osd: `${d > 0 ? '+' : '−'}${Math.abs(d)} s` });
  }

  ponerVelocidad(v: number) {
    this.pref.velocidad = v;
    this.aplicarPreferencias();
    this.guardarPreferencias();
    this.avisar(`${numeroCorto(v)}×`);
  }

  ponerVolumen(v: number) {
    this.pref.volumen = Math.max(0, Math.min(1, v));
    this.pref.silencio = this.pref.volumen === 0;
    this.aplicarPreferencias();
    this.guardarPreferencias();
  }

  alternarSilencio() {
    this.pref.silencio = !this.pref.silencio;
    if (!this.pref.silencio && this.pref.volumen === 0) this.pref.volumen = 1;
    this.aplicarPreferencias();
    this.guardarPreferencias();
    this.avisar(this.pref.silencio ? 'Sin sonido' : 'Con sonido');
  }

  alternarSubtitulos() {
    this.pref.subtitulos = !this.pref.subtitulos;
    this.aplicarPista();
    this.guardarPreferencias();
    this.avisar(this.pref.subtitulos ? 'Subtítulos activados' : 'Subtítulos desactivados');
  }

  async alternarPip() {
    const v = this.video;
    if (!v || this.virtual) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (v.requestPictureInPicture) await v.requestPictureInPicture();
      else (v as unknown as { webkitSetPresentationMode?: (m: string) => void }).webkitSetPresentationMode?.('picture-in-picture');
    } catch { this.avisar('Este navegador no admite la imagen dentro de imagen'); }
  }

  get pipDisponible(): boolean {
    return typeof document !== 'undefined' && (document.pictureInPictureEnabled || 'webkitSetPresentationMode' in HTMLVideoElement.prototype);
  }

  async alternarPantallaCompleta(contenedor: HTMLElement | null) {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      if (contenedor?.requestFullscreen) { await contenedor.requestFullscreen({ navigationUI: 'hide' }); return; }
      // iOS: solo el propio vídeo puede ir a pantalla completa (con sus controles).
      (this.video as unknown as { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.();
    } catch { /* el navegador lo negó */ }
  }

  /** «Desde el principio» después de retomar. */
  desdeElPrincipio() { this.irA(0); this.retomado = null; this.emitir(); }
  olvidarRetomado() { this.retomado = null; this.emitir(); }

  avisar(texto: string) {
    this.osd = { texto, n: ++this.nOsd };
    this.emitir();
  }

  private aplicarPreferencias() {
    const el = this.medio();
    if (!el) return;
    el.playbackRate = this.pref.velocidad;
    // Velocidad sin voz de ardilla: se conserva el tono.
    el.preservesPitch = true;
    (el as unknown as { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
    el.volume = this.pref.volumen;
    el.muted = this.pref.silencio;
    this.emitir();
  }

  private guardarPreferencias() {
    try { localStorage.setItem(CLAVE_PREFERENCIAS, JSON.stringify(this.pref)); } catch { /* sin almacenamiento */ }
    this.emitir();
  }

  // ------------------------------------------------------------------ subtítulos

  /** Pone los subtítulos (WebVTT) generados de la transcripción. */
  ponerPista(vtt: string | null) {
    this.vtt = vtt;
    const v = this.video;
    if (this.pistaUrl) URL.revokeObjectURL(this.pistaUrl);
    this.pistaUrl = null;
    v?.querySelectorAll('track').forEach((t) => t.remove());
    if (vtt && v) {
      this.pistaUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      const t = document.createElement('track');
      t.kind = 'subtitles';
      t.srclang = 'es';
      t.label = 'Transcripción';
      t.src = this.pistaUrl;
      v.appendChild(t);
      this.aplicarPista();
    }
    this.emitir();
  }

  private aplicarPista() {
    const v = this.video;
    if (!v) { this.emitir(); return; }
    for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i]!.mode = this.pref.subtitulos ? 'showing' : 'hidden';
    this.emitir();
  }

  // ------------------------------------------------------------------ lugares

  /**
   * Cambia el marco de sitio. Con `moveBefore` (Chrome 133+) el iframe de YouTube no
   * se recarga; sin él, se recarga y el reproductor de YouTube se vuelve a crear donde iba.
   */
  private mover(destino: HTMLElement) {
    const m = this.marco!;
    const mb = (destino as HTMLElement & { moveBefore?: (n: Node, r: Node | null) => void }).moveBefore;
    if (this.externo && mb && m.isConnected && destino.isConnected) { try { mb.call(destino, m, null); return; } catch { /* sigue abajo */ } }
    destino.appendChild(m);
    if (this.externo) this.externo.reanclar();
  }

  /** El escenario del lector o del reproductor pequeño acoge el marco. */
  alojar(nodo: HTMLElement, lugar: 'lector' | 'mini') {
    if (!this.marco) return;
    if (this.soltar) { clearTimeout(this.soltar); this.soltar = null; }
    if (this.marco.parentElement !== nodo) this.mover(nodo);
    this.anfitrion = nodo;
    this.lugar = lugar;
    if (lugar === 'lector') this.miniActivo = false;
    this.emitir();
  }

  /**
   * El anfitrión se va. Si el lector se va mientras suena, sigue sonando en
   * el reproductor pequeño; si estaba en pausa, se guarda la posición y se suelta.
   */
  desalojar(nodo: HTMLElement) {
    if (this.anfitrion !== nodo || !this.marco) return;
    const lugar = this.lugar;
    if (this.aparcamiento) this.mover(this.aparcamiento);
    this.anfitrion = null;
    this.lugar = null;
    if (lugar === 'lector') {
      if (this.fuente && this.b.quiere && !this.b.error && !this.pip) this.miniActivo = true;
      else if (this.fuente && !this.pip) this.soltar = setTimeout(() => { this.soltar = null; if (!this.anfitrion) this.descargar(); }, 0);
    }
    this.emitir();
  }

  cerrarMini() {
    this.pausar();
    this.descargar();
  }

  // ------------------------------------------------------------------ posición y sistema

  private guardarPosicion(forzar = false) {
    const el = this.medio();
    if (!this.fuente || !el || this.virtual) return;
    if (!this.b.metadatos && !forzar) return;
    const t = this.pendiente ?? el.currentTime;
    if (!Number.isFinite(t) || (t < 1 && !forzar)) return;
    if (!this.b.conocida) return;
    guardarPosicionDe(this.fuente.documento, t, Number.isFinite(el.duration) ? el.duration : undefined);
  }

  private borrarPosicion() {
    if (!this.fuente) return;
    try {
      const todas = leerPosiciones();
      delete todas[this.fuente.documento];
      localStorage.setItem(CLAVE_POSICIONES, JSON.stringify(todas));
    } catch { /* sin almacenamiento */ }
  }

  /** La pantalla de bloqueo y los mandos del sistema (Media Session). */
  private sesionMedios() {
    if (!('mediaSession' in navigator) || !this.fuente) return;
    const f = this.fuente;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: f.titulo, artist: f.autores ?? '', album: 'Scholaris', ...(f.portada ? { artwork: [{ src: f.portada }] } : {}) });
      const m = navigator.mediaSession;
      m.setActionHandler('play', () => this.sonar());
      m.setActionHandler('pause', () => this.pausar());
      m.setActionHandler('seekbackward', (d) => this.saltar(-(d.seekOffset ?? 10)));
      m.setActionHandler('seekforward', (d) => this.saltar(d.seekOffset ?? 10));
      m.setActionHandler('seekto', (d) => d.seekTime != null && this.irA(d.seekTime));
    } catch { /* navegador sin alguna acción */ }
  }

  private posicionSesion() {
    const el = this.medio();
    if (!('mediaSession' in navigator) || !el || !Number.isFinite(el.duration) || !el.duration) return;
    try { navigator.mediaSession.setPositionState({ duration: el.duration, playbackRate: el.playbackRate, position: Math.min(el.currentTime, el.duration) }); } catch { /* ignorado */ }
  }
}

let unico: Motor | null = null;

/** El motor de la aplicación (uno solo, creado al primer uso). */
export function motor(): Motor {
  if (!unico) {
    unico = new Motor();
    if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __motor: Motor }).__motor = unico;
  }
  return unico;
}
