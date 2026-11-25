import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { z } from 'zod'
import { plainText } from '@/lib/text'
import { pin } from '@/modules/events/input'
import { PIXELS, signSvg, type SignOptions, type SignSize } from './templates'

export type { SignOptions, SignSize, SignStyle } from './templates'

export const signInput = z.object({
  size: z.enum(['a6', '4x6', 'a4', 'letter', 'screen']),
  style: z.enum(['classic', 'modern', 'bold']),
  headline: plainText(60),
  subtext: plainText(120),
  pin: pin.optional(),
})

const PREVIEW_WIDTH = 640

/** Page sizes in points. A6 and A4 are exact; the others are in inches. */
const POINTS: Record<SignSize, readonly [number, number]> = {
  a6: [297.64, 419.53],
  '4x6': [288, 432],
  a4: [595.28, 841.89],
  letter: [612, 792],
  screen: [960, 540],
}

export async function signPng(o: SignOptions, { preview = false } = {}): Promise<Buffer> {
  const picture = sharp(Buffer.from(signSvg(o)))
  return (preview ? picture.resize({ width: Math.min(PREVIEW_WIDTH, PIXELS[o.size][0]) }) : picture).flatten({ background: '#ffffff' }).png().toBuffer()
}

/** One page holding the same picture as the PNG, so preview, image and print always match. */
export async function signPdf(o: SignOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const [width, height] = POINTS[o.size]
  const page = pdf.addPage([width, height])
  page.drawImage(await pdf.embedPng(await signPng(o)), { x: 0, y: 0, width, height })
  return pdf.save()
}
