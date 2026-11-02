/**
 * Playback clock: one <audio> element + a rAF loop that pushes the playhead to subscribers.
 * Subscribers (canvas, time label, scrub bar) update the DOM directly — no React renders per frame.
 */

export type PlayheadListener = (timeSec: number) => void

class Playback {
  private element: HTMLAudioElement | null = null
  private readonly listeners = new Set<PlayheadListener>()
  private raf = 0
  private onPlayingChange: (playing: boolean) => void = () => {}

  /** Created on first use, so importing this module works outside the browser (tests). */
  private get audio(): HTMLAudioElement {
    if (this.element) return this.element
    const audio = new Audio()
    audio.preload = 'auto'
    audio.addEventListener('play', () => {
      this.onPlayingChange(true)
      this.loop()
    })
    audio.addEventListener('pause', () => {
      this.onPlayingChange(false)
      cancelAnimationFrame(this.raf)
      this.emit()
    })
    audio.addEventListener('seeked', () => this.emit())
    this.element = audio
    return audio
  }

  /** Called once by the app to mirror play/pause into the store. */
  bindPlayingState(callback: (playing: boolean) => void) {
    this.onPlayingChange = callback
  }

  /** Loads a new source; resolves with its duration once metadata is known. */
  load(url: string): Promise<number> {
    this.audio.pause()
    this.audio.src = url
    this.audio.currentTime = 0
    this.emit()
    return new Promise((resolve, reject) => {
      const done = () => {
        cleanup()
        resolve(this.audio.duration)
      }
      const fail = () => {
        cleanup()
        reject(new Error('Audio element failed to load the source'))
      }
      const cleanup = () => {
        this.audio.removeEventListener('loadedmetadata', done)
        this.audio.removeEventListener('error', fail)
      }
      this.audio.addEventListener('loadedmetadata', done)
      this.audio.addEventListener('error', fail)
    })
  }

  get time(): number {
    return this.element?.currentTime ?? 0
  }

  get duration(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0
  }

  get playing(): boolean {
    return this.element ? !this.element.paused : false
  }

  async play() {
    if (!this.audio.src) return
    if (this.audio.ended) this.audio.currentTime = 0
    await this.audio.play()
  }

  pause() {
    this.element?.pause()
  }

  toggle() {
    if (this.playing) this.pause()
    else void this.play()
  }

  seek(timeSec: number) {
    const clamped = Math.min(Math.max(timeSec, 0), this.duration)
    this.audio.currentTime = clamped
    // Emit immediately so scrubbing feels instant; `seeked` will emit again when the media settles.
    this.emit(clamped)
  }

  setVolume(volume: number, muted: boolean) {
    this.audio.volume = volume
    this.audio.muted = muted
  }

  /** Subscribes to playhead updates; the listener is called immediately with the current time. */
  subscribe(listener: PlayheadListener): () => void {
    this.listeners.add(listener)
    listener(this.time)
    return () => this.listeners.delete(listener)
  }

  private emit(time = this.time) {
    for (const listener of this.listeners) listener(time)
  }

  private loop = () => {
    this.emit()
    if (!this.audio.paused) this.raf = requestAnimationFrame(this.loop)
  }
}

export const playback = new Playback()
