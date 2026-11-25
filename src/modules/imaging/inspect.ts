import exifr from 'exifr'
import sharp from 'sharp'
import { config } from '@/config'
import { AppError } from '@/lib/errors'

export type PhotoFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'avif'

export type Inspected = {
  format: PhotoFormat
  mime: string
  ext: string
  /** As seen, after rotation. */
  width: number
  height: number
  takenLocal: string | null
  offset: string | null
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis'])
const EXT: Record<PhotoFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', heic: 'heic', avif: 'avif' }

/** Looks only at the first bytes, so nothing else ever reaches the image library. */
function family(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'heif' | null {
  if (buf.length < 16) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  const tag = (at: number) => buf.toString('latin1', at, at + 4)
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP') return 'webp'
  if (tag(4) === 'ftyp' && HEIF_BRANDS.has(tag(8))) return 'heif'
  return null
}

/** HEIC and AVIF list the size of each part, so a file that was cut short gives itself away. */
function isComplete(buf: Buffer): boolean {
  let at = 0
  while (at + 8 <= buf.length) {
    let size = buf.readUInt32BE(at)
    if (size === 0) return true // runs to the end of the file
    if (size === 1) {
      if (at + 16 > buf.length) return false
      size = Number(buf.readBigUInt64BE(at + 8))
    }
    if (size < 8) return false
    at += size
  }
  return at === buf.length
}

async function cameraTime(exif: Buffer | undefined): Promise<Pick<Inspected, 'takenLocal' | 'offset'>> {
  if (!exif) return { takenLocal: null, offset: null }
  try {
    const tiff = exif.toString('latin1', 0, 4) === 'Exif' ? exif.subarray(6) : exif
    // reviveValues would turn the camera's clock into this server's time zone.
    const tags = (await exifr.parse(tiff, { pick: ['DateTimeOriginal', 'OffsetTimeOriginal'], reviveValues: false })) as
      | { DateTimeOriginal?: unknown; OffsetTimeOriginal?: unknown }
      | undefined
    const text = (v: unknown) => (typeof v === 'string' && v ? v : null)
    return { takenLocal: text(tags?.DateTimeOriginal), offset: text(tags?.OffsetTimeOriginal) }
  } catch {
    return { takenLocal: null, offset: null }
  }
}

export async function inspect(buf: Buffer): Promise<Inspected> {
  const kind = family(buf)
  if (!kind || (kind === 'heif' && !isComplete(buf))) throw new AppError('bad_type')
  const meta = await sharp(buf, { limitInputPixels: config.limits.maxPixels })
    .metadata()
    .catch(() => {
      throw new AppError('bad_type')
    })
  const format: PhotoFormat | null =
    kind !== 'heif' ? kind : meta.compression === 'hevc' ? 'heic' : meta.compression === 'av1' ? 'avif' : null
  const { width, height } = meta.autoOrient
  if (!format || !width || !height || width * height > config.limits.maxPixels) throw new AppError('bad_type')
  return { format, mime: `image/${format}`, ext: EXT[format], width, height, ...(await cameraTime(meta.exif)) }
}
