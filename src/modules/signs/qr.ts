import QRCode from 'qrcode'
import sharp from 'sharp'
import { config } from '@/config'
import { contrast } from '@/lib/color'

const QUIET = 4

export function eventUrl(code: string): string {
  return `${config.appUrl}/e/${code}`
}

/** The event's color, or black when it's too pale to scan. */
export function qrColor(accent: string | undefined): string {
  return accent && /^#[0-9a-f]{6}$/i.test(accent) && contrast(accent, '#ffffff') >= 4.5 ? accent : '#000000'
}

/** Modules as one path, in a square `size` modules wide including the quiet edge. */
export function qrModules(url: string): { size: number; path: string } {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' })
  let path = ''
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (!modules.get(y, x)) continue
      let run = 1
      while (x + run < modules.size && modules.get(y, x + run)) run++
      path += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`
      x += run
    }
  }
  return { size: modules.size + QUIET * 2, path }
}

export function qrSvg(url: string, o: { dark?: string } = {}): string {
  const { size, path } = qrModules(url)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 10}" height="${size * 10}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#ffffff"/><path d="${path}" fill="${qrColor(o.dark)}"/></svg>`
}

export async function qrPng(url: string, px: number, o: { dark?: string } = {}): Promise<Buffer> {
  const { size } = qrModules(url)
  // Drawn at a whole number of pixels per module, then centered, so every edge is sharp.
  const each = Math.floor(px / size)
  const drawn = each * size
  const svg = qrSvg(url, o).replace(/width="\d+" height="\d+"/, `width="${drawn}" height="${drawn}"`)
  const before = Math.floor((px - drawn) / 2)
  const after = px - drawn - before
  return sharp(Buffer.from(svg))
    .extend({ top: before, left: before, bottom: after, right: after, background: '#ffffff' })
    .png()
    .toBuffer()
}
