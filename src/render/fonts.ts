/**
 * Embedded OFL fonts (see fonts/README.md). Loaded with the FontFace API, which works both in the
 * window (document.fonts) and in workers (self.fonts), so preview and export draw the same glyphs
 * on any machine. The renderer awaits the fonts a scene uses before its first frame.
 */

export const FONT_FAMILY = {
  grotesk: 'STV Inter',
  display: 'STV Unbounded',
  condensed: 'STV Oswald',
  mono: 'STV JetBrains Mono',
} as const

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,' +
  'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'

interface FontFile {
  url: string
  unicodeRange: string
}

interface EmbeddedFont {
  family: string
  /** Weight axis range of the variable font. */
  weight: string
  files: FontFile[]
}

// `new URL(literal, import.meta.url)` lets Vite emit the files as assets, in the window and in workers.
export const EMBEDDED_FONTS: EmbeddedFont[] = [
  {
    family: FONT_FAMILY.grotesk,
    weight: '100 900',
    files: [
      { url: new URL('./fonts/inter-latin-wght.woff2', import.meta.url).href, unicodeRange: LATIN },
      {
        url: new URL('./fonts/inter-cyrillic-wght.woff2', import.meta.url).href,
        unicodeRange: CYRILLIC,
      },
    ],
  },
  {
    family: FONT_FAMILY.display,
    weight: '200 900',
    files: [
      {
        url: new URL('./fonts/unbounded-latin-wght.woff2', import.meta.url).href,
        unicodeRange: LATIN,
      },
      {
        url: new URL('./fonts/unbounded-cyrillic-wght.woff2', import.meta.url).href,
        unicodeRange: CYRILLIC,
      },
    ],
  },
  {
    family: FONT_FAMILY.condensed,
    weight: '200 700',
    files: [
      {
        url: new URL('./fonts/oswald-latin-wght.woff2', import.meta.url).href,
        unicodeRange: LATIN,
      },
      {
        url: new URL('./fonts/oswald-cyrillic-wght.woff2', import.meta.url).href,
        unicodeRange: CYRILLIC,
      },
    ],
  },
  {
    family: FONT_FAMILY.mono,
    weight: '100 800',
    files: [
      {
        url: new URL('./fonts/jetbrains-mono-latin-wght.woff2', import.meta.url).href,
        unicodeRange: LATIN,
      },
      {
        url: new URL('./fonts/jetbrains-mono-cyrillic-wght.woff2', import.meta.url).href,
        unicodeRange: CYRILLIC,
      },
    ],
  },
]

/** CSS font-family list with a generic fallback (only for glyphs outside the embedded subsets). */
export function fontStack(family: string): string {
  return `"${family}", sans-serif`
}

/** Embedded families mentioned in CSS font-family lists. */
export function embeddedFamiliesIn(fontFamilies: string[]): string[] {
  const used = new Set<string>()
  for (const list of fontFamilies) {
    for (const f of EMBEDDED_FONTS) if (list.includes(f.family)) used.add(f.family)
  }
  return [...used]
}

const loading = new Map<string, Promise<void>>()

function fontSet(): FontFaceSet | null {
  if (typeof FontFace === 'undefined') return null
  if (typeof document !== 'undefined') return document.fonts
  return (globalThis as unknown as { fonts?: FontFaceSet }).fonts ?? null
}

/**
 * Load embedded families (all of them by default) into the current window or worker.
 * Idempotent; a no-op where FontFace is unavailable (Node tests).
 */
export function loadEmbeddedFonts(families?: string[]): Promise<void> {
  const set = fontSet()
  if (!set) return Promise.resolve()
  const wanted = EMBEDDED_FONTS.filter((f) => !families || families.includes(f.family))
  return Promise.all(
    wanted.flatMap((font) =>
      font.files.map((file) => {
        let p = loading.get(file.url)
        if (!p) {
          const face = new FontFace(font.family, `url(${file.url}) format("woff2")`, {
            weight: font.weight,
            unicodeRange: file.unicodeRange,
            display: 'block',
          })
          p = face.load().then((loaded) => {
            set.add(loaded)
          })
          p.catch(() => loading.delete(file.url))
          loading.set(file.url, p)
        }
        return p
      }),
    ),
  ).then(() => undefined)
}
