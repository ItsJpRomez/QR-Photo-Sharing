import { Readable } from 'node:stream'
import { beforeAll, describe, expect, test } from 'vitest'
import type { ObjectStorage } from '@/modules/storage/types'

/** `send` lets the disk driver be exercised through its route without a running server. */
export type Send = (url: string, init?: RequestInit) => Promise<Response>

export function storageContract(name: string, make: () => ObjectStorage, send: Send) {
  describe(`${name} storage`, () => {
    const prefix = `ev/contract-${crypto.randomUUID()}`
    let s: ObjectStorage
    beforeAll(() => {
      s = make()
    })

    test('what goes in comes out unchanged', async () => {
      const body = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256))
      expect(await s.put(`${prefix}/a.bin`, body, 'application/octet-stream')).toEqual({ size: 5000 })
      expect((await s.read(`${prefix}/a.bin`)).equals(body)).toBe(true)
      expect(await s.head(`${prefix}/a.bin`)).toEqual({ size: 5000 })
    })

    test('streams in and out', async () => {
      const chunks = Array.from({ length: 50 }, (_, i) => Buffer.alloc(100_000, i))
      const { size } = await s.put(`${prefix}/stream.bin`, Readable.from(chunks), 'application/octet-stream')
      expect(size).toBe(5_000_000)
      const got: Buffer[] = []
      for await (const c of await s.readStream(`${prefix}/stream.bin`)) got.push(c as Buffer)
      expect(Buffer.concat(got).equals(Buffer.concat(chunks))).toBe(true)
    })

    test('a failing stream rejects and leaves no object behind', async () => {
      const bad = Readable.from(
        (async function* () {
          yield Buffer.alloc(1000)
          throw new Error('source broke')
        })(),
      )
      await expect(s.put(`${prefix}/broken.bin`, bad, 'application/octet-stream')).rejects.toThrow('source broke')
      expect(await s.head(`${prefix}/broken.bin`)).toBeNull()
    })

    test('missing objects', async () => {
      expect(await s.head(`${prefix}/nope`)).toBeNull()
      await expect(s.delete([`${prefix}/nope`])).resolves.toBeUndefined()
      await expect(s.delete([])).resolves.toBeUndefined()
    })

    test('a signed upload accepts exactly the promised size', async () => {
      const ok = await s.signPut({ key: `${prefix}/up1`, size: 10, contentType: 'image/jpeg' })
      expect((await send(ok.url, { method: 'PUT', headers: ok.headers, body: 'x'.repeat(10) })).ok).toBe(true)
      expect(await s.head(`${prefix}/up1`)).toEqual({ size: 10 })

      const no = await s.signPut({ key: `${prefix}/up2`, size: 10, contentType: 'image/jpeg' })
      const res = await send(no.url, { method: 'PUT', headers: no.headers, body: 'x'.repeat(11) })
      expect(res.ok).toBe(false)
      expect(await s.head(`${prefix}/up2`)).toBeNull()
    })

    test('a read link is the same for the hour', async () => {
      const at = (time: string) => s.signGet(`${prefix}/a.bin`, { now: new Date(`2026-06-12T${time}:00Z`) })
      expect(await at('10:05')).toBe(await at('10:55'))
      expect(await at('11:05')).not.toBe(await at('10:55'))
    })

    test('a read link serves the bytes, with ranges', async () => {
      await s.put(`${prefix}/range.txt`, Buffer.from('0123456789'), 'text/plain')
      const url = await s.signGet(`${prefix}/range.txt`)
      expect(await (await send(url)).text()).toBe('0123456789')
      const part = await send(url, { headers: { range: 'bytes=5-9' } })
      expect(part.status).toBe(206)
      expect(part.headers.get('content-range')).toBe('bytes 5-9/10')
      expect(await part.text()).toBe('56789')
      const tail = await send(url, { headers: { range: 'bytes=7-' } })
      expect(tail.status).toBe(206)
      expect(await tail.text()).toBe('789')
    })

    test('a download name is sent as an attachment, safely encoded', async () => {
      const url = await s.signGet(`${prefix}/a.bin`, { downloadName: 'Ana "x"\r\n Niño.jpg' })
      const res = await send(url)
      const cd = res.headers.get('content-disposition') ?? ''
      expect(cd).toMatch(/^attachment;/)
      expect(cd).toContain("filename*=UTF-8''Ana%20")
    })

    test('an altered signature is refused', async () => {
      const url = await s.signGet(`${prefix}/a.bin`)
      const other = url.replace(/a\.bin/, 'range.txt')
      expect((await send(other)).ok).toBe(false)
    })

    test('deleting a prefix leaves look-alikes alone', async () => {
      await s.put(`${prefix}/A/1`, Buffer.from('1'), 'text/plain')
      await s.put(`${prefix}/AB/1`, Buffer.from('1'), 'text/plain')
      await s.deletePrefix(`${prefix}/A/`)
      expect(await s.head(`${prefix}/A/1`)).toBeNull()
      expect(await s.head(`${prefix}/AB/1`)).toEqual({ size: 1 })
      await s.deletePrefix(`${prefix}/`)
      expect(await s.head(`${prefix}/AB/1`)).toBeNull()
    })
  })
}
