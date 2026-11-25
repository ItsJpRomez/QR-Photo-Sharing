import sharp, { type Sharp } from 'sharp'
import { rgbaToThumbHash } from 'thumbhash'
import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { heicToPng } from './heic'
import type { PhotoFormat } from './inspect'

export const THUMB_PX = 480
export const DISPLAY_PX = 2048

export type Rendered = { thumb: Buffer; display: Buffer; thumbhash: string; width: number; height: number }

const open = (buf: Buffer): Sharp =>
  sharp(buf, { limitInputPixels: config.limits.maxPixels, failOn: 'error' }).timeout({ seconds: 30 })

const fitted = (s: Sharp, px: number) => s.resize(px, px, { fit: 'inside', withoutEnlargement: true })

/** Unreadable photos are the sender's problem; running out of time is ours, and worth another try. */
async function reading<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    if (err instanceof AppError || /time(d )?out|too long/i.test((err as Error).message)) throw err
    throw new AppError('bad_type')
  }
}

async function source(buf: Buffer, format: PhotoFormat): Promise<Buffer> {
  return format === 'heic' ? heicToPng(buf) : buf
}

/** Screen-size copies: upright, sRGB, with no metadata. */
export function render(buf: Buffer, format: PhotoFormat): Promise<Rendered> {
  return reading(async () => {
    const src = await source(buf, format)
    const display = await fitted(open(src).autoOrient(), DISPLAY_PX).webp({ quality: 82 }).toBuffer()
    const thumb = await fitted(open(src).autoOrient(), THUMB_PX).webp({ quality: 74 }).toBuffer()
    const { data, info } = await fitted(sharp(thumb), 100).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const { autoOrient } = await open(src).metadata()
    return {
      thumb,
      display,
      thumbhash: Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString('base64'),
      width: autoOrient.width,
      height: autoOrient.height,
    }
  })
}

/** A full-size JPEG that is safe to hand to other guests. */
export function renderDownload(buf: Buffer, format: PhotoFormat): Promise<Buffer> {
  return reading(async () =>
    open(await source(buf, format))
      .autoOrient()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
      .toBuffer(),
  )
}
