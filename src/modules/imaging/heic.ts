import path from 'node:path'
import { Worker } from 'node:worker_threads'
import zlib from 'node:zlib'
import sharp from 'sharp'

type Pixels = { width: number; height: number; data: Uint8ClampedArray }

const LIMIT_MS = 30_000

function decode(buf: Buffer): Promise<Pixels> {
  return new Promise((resolve, reject) => {
    const file = path.join(/* turbopackIgnore: true */ process.cwd(), 'workers', 'heic.mjs')
    const worker = new Worker(/* turbopackIgnore: true */ file, { workerData: new Uint8Array(buf), stderr: true, stdout: true })
    const timer = setTimeout(() => finish(() => reject(new Error('Decoding took too long'))), LIMIT_MS)
    const finish = (then: () => void) => {
      clearTimeout(timer)
      void worker.terminate()
      then()
    }
    worker.once('message', (m: Pixels) => finish(() => resolve(m)))
    worker.once('error', (err) => finish(() => reject(err)))
    worker.once('exit', () => finish(() => reject(new Error('The decoder stopped early'))))
  })
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const check = Buffer.alloc(4)
  check.writeUInt32BE(zlib.crc32(body))
  return Buffer.concat([size, body, check])
}

const PNG_HEADER_END = 33

/**
 * HEIC as a lossless PNG. The decoder hands back bare numbers without the
 * photo's color profile, so the profile is put back for sharp to convert from;
 * without it, iPhone photos come out dull.
 */
export async function heicToPng(buf: Buffer): Promise<Buffer> {
  const { width, height, data } = await decode(buf)
  const png = await sharp(Buffer.from(data.buffer), { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 0 })
    .toBuffer()
  const { icc } = await sharp(buf).metadata()
  if (!icc) return png
  const profile = pngChunk('iCCP', Buffer.concat([Buffer.from('icc\0\0', 'latin1'), zlib.deflateSync(icc)]))
  return Buffer.concat([png.subarray(0, PNG_HEADER_END), profile, png.subarray(PNG_HEADER_END)])
}
