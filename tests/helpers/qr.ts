import jsQR from 'jsqr'
import sharp from 'sharp'

/** Reads a QR code out of a picture, as a phone would. */
export async function readQr(image: Buffer): Promise<string | null> {
  const { data, info } = await sharp(image, { limitInputPixels: false }).flatten({ background: '#fff' }).ensureAlpha().resize({ width: 1400, withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true })
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null
}
