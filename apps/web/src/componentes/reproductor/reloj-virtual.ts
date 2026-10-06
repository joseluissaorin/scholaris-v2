/**
 * Un «elemento de medio» sin medio: avanza el tiempo y emite los mismos
 * eventos que <video>. Lo usa la demostración (no hay archivo) y lo usan las
 * pruebas del motor. El motor no distingue.
 */
export class RelojVirtual extends EventTarget {
  private t = 0;
  private sonando = false;
  private h = 0;
  private ultimo = 0;
  playbackRate = 1;
  volume = 1;
  muted = false;
  readyState = 4;
  error: MediaError | null = null;
  preservesPitch = true;
  textTracks = [] as unknown as TextTrackList;
  buffered: TimeRanges;

  constructor(readonly duration: number) {
    super();
    this.buffered = { length: 1, start: () => 0, end: () => duration } as TimeRanges;
    queueMicrotask(() => { this.emitir('loadedmetadata'); this.emitir('durationchange'); this.emitir('canplay'); });
  }

  get paused() { return !this.sonando; }
  get ended() { return this.t >= this.duration; }
  get currentTime() { return this.t; }
  set currentTime(v: number) {
    this.t = Math.max(0, Math.min(this.duration, v));
    this.emitir('seeking');
    queueMicrotask(() => { this.emitir('seeked'); this.emitir('timeupdate'); });
  }

  play(): Promise<void> {
    if (this.sonando) return Promise.resolve();
    if (this.t >= this.duration) this.t = 0;
    this.sonando = true;
    this.emitir('play');
    this.emitir('playing');
    this.ultimo = performance.now();
    const paso = (ahora: number) => {
      if (!this.sonando) return;
      this.t += ((ahora - this.ultimo) / 1000) * this.playbackRate;
      this.ultimo = ahora;
      if (this.t >= this.duration) { this.t = this.duration; this.sonando = false; this.emitir('pause'); this.emitir('ended'); return; }
      this.h = requestAnimationFrame(paso);
    };
    this.h = requestAnimationFrame(paso);
    return Promise.resolve();
  }

  pause() {
    if (!this.sonando) return;
    this.sonando = false;
    cancelAnimationFrame(this.h);
    this.emitir('pause');
  }

  private emitir(tipo: string) { this.dispatchEvent(new Event(tipo)); }
}
