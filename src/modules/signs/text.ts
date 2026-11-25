import fs from 'node:fs'
import path from 'node:path'
import * as opentype from 'opentype.js'
import type { Font, PathCommand } from 'opentype.js'

export type Weight = 500 | 800

// Plain Node sees this library as one default export; bundlers see named ones.
const { parse } = 'parse' in opentype ? opentype : (opentype as unknown as { default: typeof opentype }).default

const PARTS = ['latin', 'latin-ext', 'vietnamese']
const loaded = new Map<Weight, Font[]>()

/** The bundled fonts, so a sign looks the same whatever is installed on the server. */
function fonts(weight: Weight): Font[] {
  let list = loaded.get(weight)
  if (!list) {
    const dir = path.join(/* turbopackIgnore: true */ process.cwd(), 'assets', 'fonts')
    list = PARTS.map((part) => {
      const file = fs.readFileSync(path.join(dir, `bricolage-grotesque-${part}-${weight}-normal.woff`))
      return parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer)
    })
    loaded.set(weight, list)
  }
  return list
}

function fontFor(ch: string, weight: Weight): Font | undefined {
  return fonts(weight).find((f) => f.charToGlyphIndex(ch) > 0)
}

const n = (v: number) => String(Math.round(v * 100) / 100)

/** Written out here because the library's own version turns some tiny numbers into "NaN". */
function pathData(commands: PathCommand[]): string {
  return commands
    .map((c) => {
      switch (c.type) {
        case 'M':
        case 'L':
          return `${c.type}${n(c.x)} ${n(c.y)}`
        case 'Q':
          return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`
        case 'C':
          return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`
        case 'Z':
          return 'Z'
      }
    })
    .join('')
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

/** A letter with its accents, as separate code points if the font has no single glyph for it. */
function isDrawable(grapheme: string): boolean {
  return [...grapheme].every((ch) => /\s/.test(ch) || fontFor(ch, 800) !== undefined)
}

const graphemes = (text: string) => [...segmenter.segment(text.normalize('NFC'))].map((s) => s.segment)

/** Characters a sign can't print. */
export function unsupportedGlyphs(text: string): string[] {
  return [...new Set(graphemes(text).filter((g) => !isDrawable(g)))]
}

export function printable(text: string): string {
  return graphemes(text)
    .filter(isDrawable)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function measure(text: string, weight: Weight, size: number): number {
  let width = 0
  for (const ch of text) {
    const font = fontFor(ch, weight) ?? fonts(weight)[0]!
    width += ((font.charToGlyph(ch).advanceWidth ?? 0) / font.unitsPerEm) * size
  }
  return width
}

/** Breaks text into lines. Words are split only when allowed. Null when a word doesn't fit. */
function wrap(text: string, weight: Weight, size: number, maxWidth: number, split: boolean): string[] | null {
  const lines: string[] = []
  let line = ''
  for (let word of text.split(' ')) {
    const joined = line ? `${line} ${word}` : word
    if (measure(joined, weight, size) <= maxWidth) {
      line = joined
      continue
    }
    if (line) lines.push(line)
    line = ''
    while (measure(word, weight, size) > maxWidth) {
      if (!split) return null
      let fits = 1
      while (fits < word.length && measure(word.slice(0, fits + 1), weight, size) <= maxWidth) fits++
      lines.push(word.slice(0, fits))
      word = word.slice(fits)
    }
    line = word
  }
  if (line) lines.push(line)
  return lines
}

export type TextOptions = { weight: Weight; size: number; maxWidth: number; maxLines: number; align?: 'left' | 'center' }
export type TextLayout = { d: string; lines: number; fontSize: number; width: number; height: number }

const LEADING = 1.12
const SMALLEST = 0.4

/** Text as shapes, shrunk and wrapped to fit. The top left corner is at 0,0. */
export function layoutText(raw: string, o: TextOptions): TextLayout {
  const text = printable(raw)
  if (!text) return { d: '', lines: 0, fontSize: o.size, width: 0, height: 0 }

  let fontSize = o.size
  let lines: string[] | null = null
  for (const split of [false, true]) {
    for (fontSize = split ? o.size * SMALLEST : o.size; fontSize > (split ? 4 : o.size * SMALLEST); fontSize *= 0.95) {
      lines = wrap(text, o.weight, fontSize, o.maxWidth, split)
      if (lines && lines.length <= o.maxLines) break
      lines = null
    }
    if (lines) break
  }
  lines ??= [text]

  const widths = lines.map((l) => measure(l, o.weight, fontSize))
  const main = fonts(o.weight)[0]!
  const ascent = (main.ascender / main.unitsPerEm) * fontSize
  const step = fontSize * LEADING
  let d = ''
  for (const [i, line] of lines.entries()) {
    let x = o.align === 'center' ? (o.maxWidth - widths[i]!) / 2 : 0
    for (const ch of line) {
      const font = fontFor(ch, o.weight) ?? main
      const glyph = font.charToGlyph(ch)
      if (!/\s/.test(ch)) d += pathData(glyph.getPath(x, ascent + i * step, fontSize).commands)
      x += ((glyph.advanceWidth ?? 0) / font.unitsPerEm) * fontSize
    }
  }
  const descent = (-main.descender / main.unitsPerEm) * fontSize
  return { d, lines: lines.length, fontSize, width: Math.max(...widths), height: (lines.length - 1) * step + ascent + descent }
}
