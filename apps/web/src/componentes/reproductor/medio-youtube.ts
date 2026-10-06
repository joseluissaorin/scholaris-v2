/**
 * Un «elemento de medio» sobre el reproductor de YouTube (IFrame API): emite
 * los mismos eventos que <video> y expone lo que el motor usa (currentTime,
 * duration, paused, playbackRate, volume, muted, play, pause). El motor no
 * distingue: saltos al segundo de cada cita, karaoke y reproductor pequeño
 * funcionan igual, y no se descarga el vídeo.
 *
 * El reproductor de YouTube va sin sus controles (los pone Scholaris) y con
 * su marca, como piden sus condiciones.
 */

interface ReproductorYT {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, permitirBusqueda: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(r: number): void;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}

interface ApiYT {
  Player: new (nodo: HTMLElement, o: Record<string, unknown>) => ReproductorYT;
}

declare global {
  interface Window { YT?: ApiYT; onYouTubeIframeAPIReady?: () => void }
}

let cargaApi: Promise<ApiYT> | null = null;

/** Carga la IFrame API una sola vez. */
function apiYoutube(): Promise<ApiYT> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  cargaApi ??= new Promise<ApiYT>((res, rej) => {
    const previo = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previo?.(); res(window.YT!); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { cargaApi = null; rej(new Error('No se pudo cargar el reproductor de YouTube')); };
    document.head.appendChild(s);
  });
  return cargaApi;
}

/** El id de un vídeo de YouTube a partir de su URL (watch, youtu.be, shorts, embed). */
export function idYoutubeDeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      return /^\/(?:shorts|live|embed)\/([\w-]{6,})/.exec(u.pathname)?.[1] ?? null;
    }
  } catch { /* no es URL */ }
  return null;
}

const ESTADO = { terminado: 0, sonando: 1, pausa: 2, cargando: 3 } as const;

export class MedioYoutube extends EventTarget {
  /** El nodo que se pone en el marco del motor. */
  readonly nodo: HTMLDivElement;
  private yt: ReproductorYT | null = null;
  private listo = false;
  private t = 0;
  private dur: number;
  private sonando = false;
  private quiereSonar = false;
  private destruido = false;
  private rate = 1;
  private vol = 1;
  private silencio = false;
  private sondeo = 0;
  readyState = 0;
  error: MediaError | null = null;
  preservesPitch = true;
  textTracks = [] as unknown as TextTrackList;
  buffered: TimeRanges;

  constructor(readonly videoId: string, o: { inicio?: number; duracion?: number } = {}) {
    super();
    this.t = o.inicio ?? 0;
    this.dur = o.duracion ?? NaN;
    this.buffered = { length: 1, start: () => 0, end: () => (Number.isFinite(this.dur) ? this.dur : 0) } as TimeRanges;
    this.nodo = document.createElement('div');
    this.nodo.className = 'reproductor-video reproductor-youtube';
    this.crear();
  }

  private crear() {
    const hueco = document.createElement('div');
    this.nodo.replaceChildren(hueco);
    const videoId = this.videoId;
    apiYoutube().then((YT) => {
      if (this.destruido) return;
      this.yt = new YT.Player(hueco, {
        videoId,
        width: '100%',
        height: '100%',
        host: 'https://www.youtube-nocookie.com',
        playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0, start: Math.floor(this.t), origin: location.origin },
        events: {
          onReady: () => this.alEstarListo(),
          onStateChange: (e: { data: number }) => this.alCambiar(e.data),
          onError: (e: { data: number }) => this.alFallar(e.data),
          onPlaybackRateChange: () => this.emitir('ratechange'),
        },
      });
    }).catch(() => this.alFallar(-1));
  }

  /**
   * El marco se movió de sitio y el navegador recargó el iframe (sin `moveBefore`):
   * se vuelve a crear el reproductor en el mismo instante, sonando si sonaba.
   */
  reanclar() {
    if (this.destruido) return;
    if (this.yt && this.listo) this.t = this.yt.getCurrentTime();
    this.quiereSonar = this.quiereSonar || this.sonando;
    clearInterval(this.sondeo);
    try { this.yt?.destroy(); } catch { /* ya no estaba */ }
    this.yt = null;
    this.listo = false;
    this.sonando = false;
    this.crear();
  }

  private alEstarListo() {
    if (this.destruido || !this.yt) return;
    this.listo = true;
    const d = this.yt.getDuration();
    if (d > 0) this.dur = d;
    this.readyState = 4;
    this.yt.setPlaybackRate(this.rate);
    this.yt.setVolume(Math.round(this.vol * 100));
    if (this.silencio) this.yt.mute(); else this.yt.unMute();
    if (this.t > 0) this.yt.seekTo(this.t, true);
    this.emitir('loadedmetadata');
    this.emitir('durationchange');
    this.emitir('canplay');
    if (this.quiereSonar) this.yt.playVideo();
  }

  private alCambiar(estado: number) {
    if (!this.yt) return;
    const d = this.yt.getDuration();
    if (d > 0 && d !== this.dur) { this.dur = d; this.emitir('durationchange'); }
    if (estado === ESTADO.sonando) {
      if (!this.sonando) { this.sonando = true; this.emitir('play'); }
      this.emitir('playing');
      this.vigilarTiempo();
    } else if (estado === ESTADO.pausa) {
      this.t = this.yt.getCurrentTime();
      if (this.sonando) { this.sonando = false; this.emitir('pause'); }
    } else if (estado === ESTADO.cargando) {
      this.emitir('waiting');
    } else if (estado === ESTADO.terminado) {
      this.t = this.dur;
      if (this.sonando) { this.sonando = false; this.emitir('pause'); }
      this.emitir('ended');
    }
  }

  private alFallar(codigo: number) {
    // 2: id no válido; 5: HTML5; 100: no existe o es privado; 101/150: el dueño no deja insertarlo.
    const mensaje = codigo === 101 || codigo === 150 ? 'El dueño del vídeo no deja verlo fuera de YouTube.'
      : codigo === 100 ? 'El vídeo ya no está en YouTube o es privado.' : 'No se pudo cargar el vídeo de YouTube.';
    this.error = { code: codigo === 100 || codigo === 101 || codigo === 150 ? 4 : 2, message: mensaje } as MediaError;
    this.emitir('error');
  }

  /** Mientras suena, el tiempo se lee del reproductor (no hay «timeupdate»). */
  private vigilarTiempo() {
    clearInterval(this.sondeo);
    this.sondeo = window.setInterval(() => {
      if (!this.yt || !this.sonando) { clearInterval(this.sondeo); return; }
      this.t = this.yt.getCurrentTime();
      this.emitir('timeupdate');
    }, 250);
  }

  get paused() { return !this.sonando; }
  get ended() { return Number.isFinite(this.dur) && this.t >= this.dur - 0.05; }
  get duration() { return this.dur; }
  get currentTime() { return this.yt && this.listo ? this.yt.getCurrentTime() : this.t; }
  set currentTime(v: number) {
    this.t = Math.max(0, Number.isFinite(this.dur) ? Math.min(this.dur, v) : v);
    this.emitir('seeking');
    if (this.yt && this.listo) this.yt.seekTo(this.t, true);
    queueMicrotask(() => { this.emitir('seeked'); this.emitir('timeupdate'); });
  }

  get playbackRate() { return this.rate; }
  set playbackRate(r: number) { this.rate = r; if (this.yt && this.listo) this.yt.setPlaybackRate(r); }
  get volume() { return this.vol; }
  set volume(v: number) { this.vol = v; if (this.yt && this.listo) this.yt.setVolume(Math.round(v * 100)); this.emitir('volumechange'); }
  get muted() { return this.silencio; }
  set muted(m: boolean) {
    this.silencio = m;
    if (this.yt && this.listo) { if (m) this.yt.mute(); else this.yt.unMute(); }
    this.emitir('volumechange');
  }

  play(): Promise<void> {
    this.quiereSonar = true;
    if (this.yt && this.listo) this.yt.playVideo();
    return Promise.resolve();
  }

  pause() {
    this.quiereSonar = false;
    if (this.yt && this.listo) this.yt.pauseVideo();
  }

  destruir() {
    this.destruido = true;
    clearInterval(this.sondeo);
    try { this.yt?.destroy(); } catch { /* ya no estaba */ }
    this.yt = null;
    this.nodo.remove();
  }

  private emitir(tipo: string) { this.dispatchEvent(new Event(tipo)); }
}
