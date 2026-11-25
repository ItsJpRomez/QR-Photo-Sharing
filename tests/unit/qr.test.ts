import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { newEventCode } from '@/lib/ids'
import { eventUrl, qrColor, qrPng, qrSvg } from '@/modules/signs/qr'
import { readQr } from '../helpers/qr'

const code = newEventCode()

test('the address is the event page', () => expect(eventUrl(code)).toBe(`http://localhost:3000/e/${code}`))

describe('the PNG', () => {
  test('is exactly as large as asked, and reads back', async () => {
    const png = await qrPng(eventUrl(code), 2048)
    expect(await sharp(png).metadata()).toMatchObject({ width: 2048, height: 2048, format: 'png' })
    expect(await readQr(png)).toBe(eventUrl(code))
  })
  test('has a quiet edge at least four modules wide', async () => {
    const png = await qrPng(eventUrl(code), 2048)
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
    const dark = (x: number, y: number) => data[(y * info.width + x) * info.channels]! < 128
    let first = 0
    while (!Array.from({ length: info.width }, (_, x) => dark(x, first)).some(Boolean)) first++
    // The top-left marker is 7 modules of solid dark on its first row.
    let left = 0
    while (!dark(left, first)) left++
    let run = 0
    while (dark(left + run, first)) run++
    const module = run / 7
    expect(first / module).toBeGreaterThanOrEqual(3.95)
    expect(left / module).toBeGreaterThanOrEqual(3.95)
  })
})

test('the SVG reads back and holds nothing but shapes', async () => {
  const svg = qrSvg(eventUrl(code))
  expect(svg).not.toMatch(/<script|href|on\w+=/i)
  expect(await readQr(await sharp(Buffer.from(svg), { density: 300 }).resize(1200).png().toBuffer())).toBe(eventUrl(code))
})

test.each([
  ['#4a2370', '#4a2370'],
  ['#ffd84d', '#000000'],
  ['#777777', '#000000'],
  ['not a color', '#000000'],
  ['#fff"/><script>', '#000000'],
])('the color %s is drawn as %s', (wanted, used) => expect(qrColor(wanted)).toBe(used))

test('every color we draw with can be scanned', async () => {
  for (const c of ['#4a2370', '#0a5c36', '#7a1f1f', '#005a9c']) expect(await readQr(await sharp(Buffer.from(qrSvg(eventUrl(code), { dark: c })), { density: 200 }).resize(800).png().toBuffer())).toBe(eventUrl(code))
})
