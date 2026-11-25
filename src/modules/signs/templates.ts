import { textOn } from '@/lib/color'
import { qrColor, qrModules } from './qr'
import { layoutText, type TextLayout, type Weight } from './text'

export type SignSize = 'a6' | '4x6' | 'a4' | 'letter' | 'screen'
export type SignStyle = 'classic' | 'modern' | 'bold'
export type SignOptions = {
  size: SignSize
  style: SignStyle
  headline: string
  subtext: string
  accent: string
  url: string
  pin?: string
}

/** Pixels, at 300 per inch for paper. */
export const PIXELS: Record<SignSize, readonly [number, number]> = {
  a6: [1240, 1748],
  '4x6': [1200, 1800],
  a4: [2480, 3508],
  letter: [2550, 3300],
  screen: [1920, 1080],
}

type Box = { x: number; y: number; w: number; h: number }

const rect = (b: Box, fill: string, r = 0) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${r}" fill="${fill}"/>`

function shape(t: TextLayout, x: number, y: number, fill: string): string {
  return t.d ? `<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" d="${t.d}" fill="${fill}"/>` : ''
}

/** A QR code as large as fits, on white, with whole pixels per module so its edges stay sharp. */
function qr(url: string, accent: string, b: Box, align: 'left' | 'center'): string {
  const { size, path } = qrModules(url)
  const each = Math.floor(Math.min(b.w, b.h) / size)
  const side = each * size
  const x = Math.round(align === 'center' ? b.x + (b.w - side) / 2 : b.x)
  const y = Math.round(b.y + (b.h - side) / 2)
  return `${rect({ x, y, w: side, h: side }, '#ffffff')}<path transform="translate(${x} ${y}) scale(${each})" d="${path}" fill="${qrColor(accent)}" shape-rendering="crispEdges"/>`
}

type Words = { headline: TextLayout; subtext: TextLayout; pin: TextLayout }

function words(o: SignOptions, maxWidth: number, size: number, align: 'left' | 'center'): Words {
  const text = (value: string, weight: Weight, scale: number, maxLines: number) =>
    layoutText(value, { weight, size: size * scale, maxWidth, maxLines, align })
  return {
    headline: text(o.headline, 800, 1, 3),
    subtext: text(o.subtext, 500, 0.4, 3),
    pin: o.pin ? text(`PIN ${o.pin}`, 800, 0.6, 1) : text('', 800, 1, 1),
  }
}

/** Stacks text and the code down the page, centered in the height that's left. */
function stack(o: SignOptions, area: Box, ink: string, align: 'left' | 'center', unit: number): string {
  const t = words(o, area.w, unit * 0.115, align)
  const gap = unit * 0.035
  const texts = [t.headline, t.subtext, t.pin].filter((x) => x.d)
  const used = texts.reduce((sum, x) => sum + x.height + gap, 0)
  const side = Math.min(area.w, area.h - used)
  let y = area.y + Math.max(0, (area.h - used - side) / 2)
  let out = shape(t.headline, area.x, y, ink)
  if (t.headline.d) y += t.headline.height + gap
  out += qr(o.url, o.accent, { x: area.x, y, w: area.w, h: side }, align)
  y += side + gap
  out += shape(t.subtext, area.x, y, ink)
  if (t.subtext.d) y += t.subtext.height + gap
  return out + shape(t.pin, area.x, y, ink)
}

function portrait(o: SignOptions, w: number, h: number): string {
  const unit = Math.min(w, h)
  const page = { x: 0, y: 0, w, h }
  const inset = (by: number): Box => ({ x: by, y: by, w: w - by * 2, h: h - by * 2 })
  switch (o.style) {
    case 'classic': {
      const line = unit * 0.045
      const edge = unit * 0.022
      return rect(page, o.accent) + rect(inset(edge), '#ffffff', unit * 0.02) + stack(o, inset(line * 2), '#000000', 'center', unit)
    }
    case 'bold':
      return rect(page, o.accent) + stack(o, inset(unit * 0.075), textOn(o.accent), 'left', unit)
    case 'modern': {
      const pad = unit * 0.075
      const t = words(o, w - pad * 2, unit * 0.115, 'left')
      const top = Math.max(h * 0.2, t.headline.height + pad * 2)
      const gap = unit * 0.035
      const under = [t.subtext, t.pin].filter((x) => x.d)
      const below = under.reduce((sum, x) => sum + x.height + gap, 0)
      const room = h - top - pad * 2 - below
      let y = top + pad + room + gap
      let out = rect(page, '#ffffff') + rect({ x: 0, y: 0, w, h: top }, o.accent)
      out += shape(t.headline, pad, top - pad - t.headline.height, textOn(o.accent))
      out += qr(o.url, o.accent, { x: pad, y: top + pad, w: w - pad * 2, h: room }, 'left')
      out += shape(t.subtext, pad, y, '#000000')
      if (t.subtext.d) y += t.subtext.height + gap
      return out + shape(t.pin, pad, y, '#000000')
    }
  }
}

/** For projectors and TVs: words on the left, code on the right. */
function landscape(o: SignOptions, w: number, h: number): string {
  const pad = h * 0.09
  const split = w * 0.55
  const t = words(o, split - pad * 1.5, h * 0.17, 'left')
  const gap = h * 0.05
  const texts = [t.headline, t.subtext, t.pin].filter((x) => x.d)
  let y = (h - texts.reduce((sum, x) => sum + x.height, 0) - gap * Math.max(0, texts.length - 1)) / 2
  const page = { x: 0, y: 0, w, h }
  const back =
    o.style === 'classic'
      ? rect(page, '#ffffff') + rect({ x: 0, y: 0, w: h * 0.03, h }, o.accent)
      : o.style === 'modern'
        ? rect(page, '#ffffff') + rect({ x: 0, y: 0, w: split, h }, o.accent)
        : rect(page, o.accent)
  const ink = o.style === 'classic' ? '#000000' : textOn(o.accent)
  let out = back
  for (const x of texts) {
    out += shape(x, pad, y, ink)
    y += x.height + gap
  }
  return out + qr(o.url, o.accent, { x: split + pad / 2, y: pad, w: w - split - pad * 1.5, h: h - pad * 2 }, 'center')
}

/** Shapes only: no text elements, no fonts, nothing that could be read as markup. */
export function signSvg(o: SignOptions): string {
  const [w, h] = PIXELS[o.size]
  const body = o.size === 'screen' ? landscape(o, w, h) : portrait(o, w, h)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
}
