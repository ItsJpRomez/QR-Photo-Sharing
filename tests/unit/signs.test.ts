import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { newEventCode } from '@/lib/ids'
import { signInput, signPdf, signPng, type SignOptions, type SignSize, type SignStyle } from '@/modules/signs/render'
import { eventUrl } from '@/modules/signs/qr'
import { signSvg } from '@/modules/signs/templates'
import { layoutText, unsupportedGlyphs } from '@/modules/signs/text'
import { readQr } from '../helpers/qr'

const url = eventUrl(newEventCode())
const base: SignOptions = { size: 'a6', style: 'classic', headline: 'Share your photos', subtext: 'Scan with your phone camera. No app needed.', accent: '#4a2370', url }
const sizes: SignSize[] = ['a6', '4x6', 'a4', 'letter', 'screen']
const styles: SignStyle[] = ['classic', 'modern', 'bold']
const pairs = sizes.flatMap((size) => styles.map((style) => [size, style] as const))

const px: Record<SignSize, [number, number]> = { a6: [1240, 1748], '4x6': [1200, 1800], a4: [2480, 3508], letter: [2550, 3300], screen: [1920, 1080] }

describe.each(pairs)('%s %s', (size, style) => {
  test('scans, with and without a PIN, at the right size', async () => {
    for (const pin of [undefined, '4821']) {
      const png = await signPng({ ...base, size, style, pin })
      expect(await sharp(png).metadata()).toMatchObject({ width: px[size][0], height: px[size][1] })
      expect(await readQr(png)).toBe(url)
    }
  })
  test('still scans with the longest text and a pale color', async () => {
    const png = await signPng({ ...base, size, style, accent: '#ffe9a8', headline: 'W'.repeat(30) + ' ' + 'M'.repeat(29), subtext: 'Every one of your photos matters to us '.repeat(3), pin: '4821' })
    expect(await readQr(png)).toBe(url)
  })
  test('the preview is the same picture, smaller', async () => {
    const o = { ...base, size, style }
    const small = await signPng(o, { preview: true })
    const { width, height } = await sharp(small).metadata()
    expect(width).toBeLessThanOrEqual(700)
    const raw = (b: Buffer) => sharp(b).resize(300, null).removeAlpha().raw().toBuffer()
    const [a, b] = [await raw(small), await raw(await signPng(o))]
    let off = 0
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) if (Math.abs(a[i]! - b[i]!) > 48) off++
    expect(off / n).toBeLessThan(0.02)
    expect(Math.abs(width! / height! - px[size][0] / px[size][1])).toBeLessThan(0.01)
  })
})

test.each([
  ['a6', 298, 420],
  ['4x6', 288, 432],
  ['a4', 595, 842],
  ['letter', 612, 792],
] as [SignSize, number, number][])('the %s PDF page is the right size', async (size, w, h) => {
  const pdf = await PDFDocument.load(await signPdf({ ...base, size }))
  expect(pdf.getPageCount()).toBe(1)
  const page = pdf.getPage(0).getSize()
  expect(Math.abs(page.width - w)).toBeLessThanOrEqual(1)
  expect(Math.abs(page.height - h)).toBeLessThanOrEqual(1)
})

describe('text', () => {
  test('long headlines shrink and wrap inside the width', () => {
    for (const text of ['Hi', 'Share your photos with Ana and Marco tonight please everyone', 'W'.repeat(60)]) {
      const t = layoutText(text, { weight: 800, size: 180, maxWidth: 1000, maxLines: 3 })
      expect(t.width).toBeLessThanOrEqual(1000)
      expect(t.lines).toBeLessThanOrEqual(3)
      expect(t.fontSize).toBeLessThanOrEqual(180)
      expect(t.d).toMatch(/^M/)
    }
  })
  test('characters the font lacks are named, once each', () => {
    expect(unsupportedGlyphs('Ana 🎉 Niño 🎉 łódź Đặng 花')).toEqual(['🎉', '花'])
    expect(unsupportedGlyphs('Café & Co. “hello” — it’s 100%!')).toEqual([])
  })
  test('and left out of the sign without a gap or a box', () => {
    const o = { weight: 800 as const, size: 100, maxWidth: 2000, maxLines: 1 }
    expect(layoutText('Ana 🎉 Marco', o).d).toBe(layoutText('Ana Marco', o).d)
    expect(layoutText('🎉', o).d).toBe('')
  })
  test('every letter is really drawn, at every size', async () => {
    for (let size = 20; size < 200; size += 3.7) {
      const t = layoutText('Scan with your phone camera. Ana & Marco PIN 4821', { weight: 500, size, maxWidth: 9000, maxLines: 1 })
      expect(t.d.replace(/[MLHVQCTSAZ ,]|-?\d+(\.\d+)?/g, ''), `size ${size}`).toBe('')
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(t.width) + 40}" height="300"><rect width="100%" height="100%" fill="#fff"/><path d="${t.d}"/></svg>`
      const { info } = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true })
      expect(info.width / t.width, `size ${size}`).toBeGreaterThan(0.96)
    }
  })
  test('accents typed as two characters look the same as one', () => {
    const o = { weight: 800 as const, size: 100, maxWidth: 2000, maxLines: 1 }
    expect(layoutText('Niño', o).d).toBe(layoutText('Niño', o).d)
  })
})

describe('input', () => {
  test('60 characters, no more', () => {
    const ok = { size: 'a6', style: 'bold', headline: 'x'.repeat(60), subtext: '' }
    expect(signInput.safeParse(ok).success).toBe(true)
    expect(signInput.safeParse({ ...ok, headline: 'x'.repeat(61) }).success).toBe(false)
    expect(signInput.safeParse({ ...ok, subtext: 'x'.repeat(121) }).success).toBe(false)
    expect(signInput.safeParse({ ...ok, size: 'poster' }).success).toBe(false)
  })
  test('text can never become markup, or depend on installed fonts', () => {
    const svg = signSvg({ ...base, headline: '</path><script>alert(1)</script>', subtext: '"&<' })
    expect(svg).not.toMatch(/<script|<text|font-family/i)
  })
})
