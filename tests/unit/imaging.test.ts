import fs from 'node:fs'
import path from 'node:path'
import exifr from 'exifr'
import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { inspect } from '@/modules/imaging/inspect'
import { render, renderDownload } from '@/modules/imaging/render'
import { resolveTakenAt } from '@/modules/imaging/taken-at'

const load = (name: string) => fs.readFileSync(path.join('tests/fixtures', name))
const centre = async (buf: Buffer, x = 0.5, y = 0.5) => {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const i = (Math.floor(info.height * y) * info.width + Math.floor(info.width * x)) * info.channels
  return [...data.subarray(i, i + 3)]
}
const near = (a: number[], b: number[], by: number) => a.every((v, i) => Math.abs(v - b[i]!) <= by)
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code)

describe('inspect', () => {
  test.each([
    ['rotated-gps.jpg', 'jpeg', 'image/jpeg', 'jpg', 3024, 4032],
    ['rotated-gps.heic', 'heic', 'image/heic', 'heic', 3024, 4032],
    ['plain.png', 'png', 'image/png', 'png', 640, 480],
    ['plain.webp', 'webp', 'image/webp', 'webp', 640, 480],
    ['plain.avif', 'avif', 'image/avif', 'avif', 640, 480],
  ])('%s is %s', async (file, format, mime, ext, width, height) => {
    expect(await inspect(load(file))).toMatchObject({ format, mime, ext, width, height })
  })

  test.each([
    ['a PDF', Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj')],
    ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>')],
    ['a web page named .jpg', Buffer.from('<!doctype html><script>alert(1)</script>')],
    ['an empty file', Buffer.alloc(0)],
    ['a GIF', load('moving.gif')],
    ['random bytes', Buffer.from('\xff\xd8\xff\xe0 not really a photo', 'latin1')],
  ])('%s is refused', async (_name, buf) => {
    expect(await code(inspect(buf))).toBe('bad_type')
  })

  test('more than 100 megapixels is refused without decoding', async () => {
    const before = process.memoryUsage().rss
    expect(await code(inspect(load('huge.png')))).toBe('bad_type')
    expect(process.memoryUsage().rss - before).toBeLessThan(100 * 1024 ** 2)
  })

  test('the camera time is read without shifting it', async () => {
    for (const f of ['rotated-gps.jpg', 'rotated-gps.heic'])
      expect((await inspect(load(f))).takenLocal).toBe('2026:06:12 18:45:01')
    expect((await inspect(load('plain.png'))).takenLocal).toBeNull()
  })
})

test('extra bytes some phones add after a HEIC are fine', async () => {
  const buf = Buffer.concat([load('rotated-gps.heic'), Buffer.from('SEFT trailer from a phone \xff\xff\xff\xff', 'latin1')])
  expect(await inspect(buf)).toMatchObject({ format: 'heic' })
})

describe('render', () => {
  test.each(['p3.jpg', 'p3.heic'])('%s keeps its true color', async (file) => {
    const buf = load(file)
    const out = await render(buf, (await inspect(buf)).format)
    expect(near(await centre(out.display), [220, 59, 40], 3)).toBe(true)
    expect(near(await centre(out.thumb), [220, 59, 40], 3)).toBe(true)
  })

  test.each(['rotated-gps.jpg', 'rotated-gps.heic'])('%s is turned the right way up', async (file) => {
    const buf = load(file)
    const out = await render(buf, (await inspect(buf)).format)
    expect(await sharp(out.thumb).metadata()).toMatchObject({ width: 360, height: 480, format: 'webp' })
    expect(await sharp(out.display).metadata()).toMatchObject({ width: 1536, height: 2048, format: 'webp' })
    expect(out).toMatchObject({ width: 3024, height: 4032 })
    // Stored left half red, shot with the camera turned: red ends up on top.
    expect(near(await centre(out.display, 0.5, 0.1), [200, 30, 30], 12)).toBe(true)
    expect(near(await centre(out.display, 0.5, 0.9), [30, 30, 200], 12)).toBe(true)
  })

  test('small photos are not enlarged', async () => {
    const out = await render(load('tiny.jpg'), 'jpeg')
    for (const b of [out.thumb, out.display]) expect(await sharp(b).metadata()).toMatchObject({ width: 200, height: 100 })
  })

  test.each(['rotated-gps.jpg', 'rotated-gps.heic'])('nothing personal is left in the copies of %s', async (file) => {
    const buf = load(file)
    expect((await exifr.gps(buf))?.latitude).toBeCloseTo(14.583, 2) // the original does hold it
    const { format } = await inspect(buf)
    const out = await render(buf, format)
    for (const b of [out.thumb, out.display, await renderDownload(buf, format)]) {
      const m = await sharp(b).metadata()
      expect([m.exif, m.icc, m.xmp, m.iptc]).toEqual([undefined, undefined, undefined, undefined])
      expect(b.includes('TestCam')).toBe(false)
    }
  })

  test('a download keeps every pixel', async () => {
    for (const f of ['rotated-gps.jpg', 'rotated-gps.heic'] as const) {
      const buf = load(f)
      const { format } = await inspect(buf)
      expect(await sharp(await renderDownload(buf, format)).metadata()).toMatchObject({ width: 3024, height: 4032, format: 'jpeg' })
    }
  })

  test('a placeholder is made', async () => {
    const { thumbhash } = await render(load('p3.jpg'), 'jpeg')
    expect(Buffer.from(thumbhash, 'base64').length).toBeGreaterThan(4)
    expect(thumbhash.length).toBeLessThan(60)
  })

  test.each(['truncated.jpg', 'truncated.heic'])('%s is refused', async (file) => {
    const buf = load(file)
    expect(await code(inspect(buf).then((i) => render(buf, i.format)))).toBe('bad_type')
  })
})

describe('resolveTakenAt', () => {
  const uploadedAt = new Date('2026-06-12T11:00:00Z')
  const at = (takenLocal: string | null, offset: string | null = null, timeZone = 'Asia/Manila') =>
    resolveTakenAt({ takenLocal, offset, timeZone, uploadedAt }).toISOString()

  test('camera time is read in the event time zone', () => expect(at('2026:06:12 18:45:01')).toBe('2026-06-12T10:45:01.000Z'))
  test('an offset in the photo wins', () => expect(at('2026:06:12 18:45:01', '+09:00')).toBe('2026-06-12T09:45:01.000Z'))
  test.each([null, '', 'garbage', '0000:00:00 00:00:00', '2026:13:45 99:99:99'])('%j falls back to the upload time', (v) =>
    expect(at(v)).toBe(uploadedAt.toISOString()))
  test('a clock more than a day ahead is not believed', () => {
    expect(at('2026:06:13 19:00:01')).toBe(uploadedAt.toISOString())
    expect(at('2026:06:13 18:59:59')).toBe('2026-06-13T10:59:59.000Z')
  })
  test('a bad offset is ignored', () => expect(at('2026:06:12 18:45:01', '+99:99')).toBe('2026-06-12T10:45:01.000Z'))
  test('a time skipped by daylight saving still resolves', () => {
    const t = new Date(at('2026:03:08 02:30:00', null, 'America/New_York')).getTime()
    expect(Math.abs(t - Date.parse('2026-03-08T07:00:00Z'))).toBeLessThanOrEqual(3600_000)
  })
})
