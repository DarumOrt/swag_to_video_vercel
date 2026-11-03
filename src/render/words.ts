/**
 * Where lyric words are drawn in the current frame, so effects can aim at them (particles bursting
 * from the word, accents centered on it).
 *
 * Text layers report each word they draw with `frame.words.place(...)`, in frame pixels before the
 * camera; the engine maps them through the layer's camera into screen space. The set is rebuilt
 * on every frame from what the layers draw, so it is a pure function of the frame like everything
 * else. Filled while layers draw: overlays and post passes see the full set, `remapTime` and
 * `camera` hooks (which run before the layers) see an empty one.
 */

import { cameraScale, type CameraTransform } from './effectsHost'

/** A word as a text layer reports it: frame pixels, before the camera. */
export interface WordPlacement {
  wordId: string
  /** Center of the word. */
  x: number
  y: number
  /** Drawn size (scale included). */
  width: number
  height: number
  /** Word timing (seconds) — decides which word is active. */
  start: number
  end: number
}

/** A word in screen pixels, after the camera. Box is axis-aligned around the (rotated) word. */
export interface WordBox {
  wordId: string
  /** Layer that drew it. */
  layerId: string
  /** Center. */
  x: number
  y: number
  width: number
  height: number
  start: number
  end: number
}

export interface FrameWords {
  /** Report a drawn word (text layers only). */
  place(word: WordPlacement): void
  /** Screen box of a word in this frame; null if no layer drew it. Topmost layer wins. */
  get(wordId: string): WordBox | null
  /**
   * The word being sung at `time` (start ≤ time < end); else the last one that started; null when
   * no drawn word has started yet. Among layers drawing the same word, the topmost wins.
   */
  active(time: number): WordBox | null
  all(): readonly WordBox[]
}

/** Engine side: one per frame, `scope()` binds a layer id and its camera. */
export class WordCollector {
  private readonly boxes: WordBox[] = []
  private readonly byId = new Map<string, WordBox>()

  private readonly width: number
  private readonly height: number
  private readonly unit: number

  constructor(width: number, height: number, unit: number) {
    this.width = width
    this.height = height
    this.unit = unit
  }

  /** View for one layer: placements go through `camera` (null = layer ignores the camera). */
  scope(layerId: string, camera: Readonly<CameraTransform> | null): FrameWords {
    return {
      place: (w) => this.add(layerId, camera, w),
      get: (id) => this.get(id),
      active: (t) => this.active(t),
      all: () => this.boxes,
    }
  }

  /** Read-only view for effects. */
  view(): FrameWords {
    return this.scope('', null)
  }

  get(wordId: string): WordBox | null {
    return this.byId.get(wordId) ?? null
  }

  active(time: number): WordBox | null {
    let current: WordBox | null = null
    let last: WordBox | null = null
    // Later boxes are from higher layers, so `>=` keeps the topmost on ties.
    for (const b of this.boxes) {
      if (b.start > time) continue
      if (time < b.end && (!current || b.start >= current.start)) current = b
      if (!last || b.start >= last.start) last = b
    }
    return current ?? last
  }

  private add(layerId: string, camera: Readonly<CameraTransform> | null, w: WordPlacement): void {
    const box = projectWord(w, layerId, camera, this.width, this.height, this.unit)
    this.boxes.push(box)
    this.byId.set(w.wordId, box)
  }
}

/** Map a word through the camera (same math as `applyCamera`). */
export function projectWord(
  w: WordPlacement,
  layerId: string,
  camera: Readonly<CameraTransform> | null,
  width: number,
  height: number,
  unit: number,
): WordBox {
  let { x, y, width: bw, height: bh } = w
  const [zx, zy] = camera ? cameraScale(camera) : [1, 1]
  if (
    camera &&
    (zx !== 1 || zy !== 1 || camera.rotation !== 0 || camera.x !== 0 || camera.y !== 0)
  ) {
    const cx = width / 2
    const cy = height / 2
    const dx = (x - cx) * zx
    const dy = (y - cy) * zy
    const cos = Math.cos(camera.rotation)
    const sin = Math.sin(camera.rotation)
    x = cx + camera.x * unit + dx * cos - dy * sin
    y = cy + camera.y * unit + dx * sin + dy * cos
    const sw = bw * zx
    const sh = bh * zy
    bw = Math.abs(sw * cos) + Math.abs(sh * sin)
    bh = Math.abs(sw * sin) + Math.abs(sh * cos)
  }
  return { wordId: w.wordId, layerId, x, y, width: bw, height: bh, start: w.start, end: w.end }
}

/** A standalone set for contexts built outside the engine (tests, tools). */
export function emptyFrameWords(): FrameWords {
  return new WordCollector(1, 1, 1).view()
}
