// Regenerates the photo fixtures. Needs macOS (sips) for HEIC. Run: npx tsx tests/fixtures/make.ts
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const dir = import.meta.dirname
const f = (name: string) => path.join(dir, name)
const exif = {
  IFD0: { Make: 'TestCam', Model: 'One' },
  IFD2: { DateTimeOriginal: '2026:06:12 18:45:01' },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '14/1 35/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '120/1 58/1 0/1' },
}
const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 220, g: 60, b: 40 } } })
const heic = (from: string, to: string) => execFileSync('sips', ['-s', 'format', 'heic', f(from), '--out', f(to)])

// Two halves, so rotation can be seen: left half red, right half blue.
const halves = sharp({ create: { width: 4032, height: 3024, channels: 3, background: { r: 200, g: 30, b: 30 } } }).composite([
  { input: { create: { width: 2016, height: 3024, channels: 3, background: { r: 30, g: 30, b: 200 } } }, left: 2016, top: 0 },
])
await halves.withMetadata({ orientation: 6 }).withExifMerge(exif).jpeg({ quality: 80 }).toFile(f('rotated-gps.jpg'))
heic('rotated-gps.jpg', 'rotated-gps.heic')
await solid(800, 600).withIccProfile('p3').jpeg({ quality: 100 }).toFile(f('p3.jpg'))
heic('p3.jpg', 'p3.heic')
await solid(640, 480).png().toFile(f('plain.png'))
await solid(640, 480).webp().toFile(f('plain.webp'))
await solid(640, 480).avif().toFile(f('plain.avif'))
await solid(200, 100).jpeg().toFile(f('tiny.jpg'))
await sharp({ create: { width: 10_100, height: 10_000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toFile(f('huge.png'))
fs.writeFileSync(f('truncated.jpg'), fs.readFileSync(f('rotated-gps.jpg')).subarray(0, 30_000))
fs.writeFileSync(f('truncated.heic'), fs.readFileSync(f('rotated-gps.heic')).subarray(0, 8_000))
await solid(64, 64).gif().toFile(f('moving.gif'))
