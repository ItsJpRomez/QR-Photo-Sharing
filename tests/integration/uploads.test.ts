import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import { POST as reserveRoute } from '@/app/api/e/[code]/uploads/route'
import { POST as completeRoute } from '@/app/api/e/[code]/uploads/[photoId]/complete/route'
import { db } from '@/db/client'
import { events, hashtags, participants, photoContributors, photoHashtags, photos, type EventRow } from '@/db/schema'
import { createAlbum, deleteAlbum } from '@/modules/events/albums'
import { blockTag, suggestTag } from '@/modules/events/tags'
import { expireReservation } from '@/modules/photos/uploads'
import { completeUpload, uploadStates } from '@/modules/photos/uploads'
import { keys, storage } from '@/modules/storage'
import { resetDb } from '../helpers/db'
import { makeEvent, makeGuest, makePhoto } from '../helpers/factory'
import { asGuest, fresh, photoRow, reserve, send, uniqueJpeg, type Unlocked } from '../helpers/upload'

let e: EventRow
let guest: Unlocked
let buf: Buffer
beforeEach(async () => {
  await resetDb()
  e = await makeEvent()
  guest = asGuest(e.id, (await makeGuest(e.id)).id)
  buf = await uniqueJpeg()
})

const code = (p: Promise<unknown>) => p.then(() => 'ok', (err: { code: string }) => err.code)
const usage = async () => {
  const { usedPhotos, usedBytes } = await fresh(e)
  return [usedPhotos, usedBytes]
}
const jobs = async (photoId: string) =>
  (await db.execute(sql`select count(*)::int as n from pgboss.job where name = 'photo.process' and data->>'photoId' = ${photoId}`)).rows[0]!.n

describe('reserving', () => {
  test('gives a place to send the photo', async () => {
    const r = await reserve(guest, e, buf)
    expect(r.state).toBe('reserved')
    expect(r.put!.url).toContain(`/incoming/${r.photoId}`)
    expect(r.put!.headers['content-type']).toBe('image/jpeg')
    expect(await usage()).toEqual([1, buf.length])
    expect(await db.select().from(photoContributors)).toMatchObject([{ photoId: r.photoId, participantId: guest.participantId }])
  })

  test('twice with one id is one photo and one charge', async () => {
    const clientId = crypto.randomUUID()
    const a = await reserve(guest, e, buf, { clientId })
    const b = await reserve(guest, e, buf, { clientId })
    expect(b.photoId).toBe(a.photoId)
    expect(b.put).toBeDefined()
    expect(await usage()).toEqual([1, buf.length])
  })

  test('twice at the same moment is still one', async () => {
    const clientId = crypto.randomUUID()
    const all = await Promise.all(Array.from({ length: 8 }, () => reserve(guest, e, buf, { clientId })))
    expect(new Set(all.map((r) => r.photoId)).size).toBe(1)
    expect(await usage()).toEqual([1, buf.length])
  })

  test('the same id with another size, or from another guest, is refused', async () => {
    const clientId = crypto.randomUUID()
    await reserve(guest, e, buf, { clientId })
    expect(await code(reserve(guest, e, buf, { clientId, size: 5 }))).toBe('conflict')
    const other = asGuest(e.id, (await makeGuest(e.id)).id)
    expect(await code(reserve(other, e, buf, { clientId }))).toBe('conflict')
  })

  test('an expired reservation is taken up again under the same id', async () => {
    const clientId = crypto.randomUUID()
    const a = await reserve(guest, e, buf, { clientId })
    await expireReservation(a.photoId)
    expect(await usage()).toEqual([0, 0])
    const b = await reserve(guest, e, buf, { clientId })
    expect(b).toMatchObject({ photoId: a.photoId, state: 'reserved' })
    expect(await usage()).toEqual([1, buf.length])
  })

  test('room for five of twenty arriving together', async () => {
    await db.update(events).set({ maxPhotos: 5 }).where(eq(events.id, e.id))
    const results = await Promise.all(Array.from({ length: 20 }, () => code(reserve(guest, e, buf))))
    expect(results.filter((r) => r === 'ok')).toHaveLength(5)
    expect(results.filter((r) => r === 'gallery_full')).toHaveLength(15)
    expect(await usage()).toEqual([5, buf.length * 5])
  })

  test('bytes count too', async () => {
    await db.update(events).set({ maxBytes: buf.length * 2 + 1 }).where(eq(events.id, e.id))
    const results = [await code(reserve(guest, e, buf)), await code(reserve(guest, e, buf)), await code(reserve(guest, e, buf))]
    expect(results).toEqual(['ok', 'ok', 'gallery_full'])
  })

  test('40 MB is fine, one byte more is not', async () => {
    const max = 40 * 1024 * 1024
    expect(await code(reserve(guest, e, buf, { size: max }))).toBe('ok')
    expect(await code(reserve(guest, e, buf, { size: max + 1 }))).toBe('too_large')
  })

  test('the 501st photo of one guest is refused; failed and deleted ones do not count', async () => {
    const mk = (n: number, status: 'live' | 'failed' | 'deleted') =>
      Promise.all(Array.from({ length: n }, () => makePhoto(e.id, guest.participantId, { status })))
    await mk(499, 'live')
    await mk(5, 'failed')
    await mk(5, 'deleted')
    expect(await code(reserve(guest, e, buf))).toBe('ok')
    expect(await code(reserve(guest, e, buf))).toBe('guest_limit')
  })

  test('the 61st in a minute is refused', async () => {
    const results: string[] = []
    for (let i = 0; i < 61; i++) results.push(await code(reserve(guest, e, buf)))
    expect(results.filter((r) => r === 'ok').length).toBeGreaterThanOrEqual(60) // a minute may turn over mid-test
    const second = asGuest(e.id, (await makeGuest(e.id)).id)
    const burst = await Promise.all(Array.from({ length: 75 }, () => code(reserve(second, e, buf))))
    expect(burst).toContain('rate_limited')
  })

  test('a deleted album, a foreign album or a removed hashtag never loses the photo', async () => {
    const gone = await createAlbum(e.id, 'Gone')
    await deleteAlbum(e.id, gone.id)
    const foreign = await createAlbum((await makeEvent()).id, 'Foreign')
    const tag = await suggestTag(e.id, 'Rude')
    await blockTag(e.id, tag.id)
    for (const albumId of [gone.id, foreign.id]) {
      const r = await reserve(guest, e, buf, { albumId, tags: ['#rude', '#nice', 'not a tag!'] })
      expect((await photoRow(r.photoId)).albumId).toBeNull()
    }
    const tags = await db.select({ norm: hashtags.norm }).from(photoHashtags).innerJoin(hashtags, eq(hashtags.id, photoHashtags.hashtagId))
    expect(tags.map((t) => t.norm)).toEqual(['nice', 'nice'])
  })

  test('a name given here is remembered, and a blank one changes nothing', async () => {
    await reserve(guest, e, buf, { name: ' Ana ' })
    await reserve(guest, e, buf, { name: '' })
    expect((await db.select().from(participants).where(eq(participants.id, guest.participantId)))[0]!.name).toBe('Ana')
  })

  test('an odd file type is sent as plain bytes, never as a page', async () => {
    const r = await reserve(guest, e, buf, { mime: 'text/html' })
    expect(r.put!.headers['content-type']).toBe('application/octet-stream')
  })
})

describe('completing', () => {
  test('needs the file, at the promised size', async () => {
    const r = await reserve(guest, e, buf)
    expect(await code(completeUpload(guest, e, r.photoId))).toBe('bad_input')
    await storage.put(keys.incoming(e.id, r.photoId), buf.subarray(1), 'image/jpeg')
    expect(await code(completeUpload(guest, e, r.photoId))).toBe('bad_input')
    await storage.put(keys.incoming(e.id, r.photoId), buf, 'image/jpeg')
    expect(await completeUpload(guest, e, r.photoId)).toMatchObject({ state: 'processing' })
  })

  test('twice queues one job', async () => {
    const r = await reserve(guest, e, buf)
    await storage.put(keys.incoming(e.id, r.photoId), buf, 'image/jpeg')
    await Promise.all(Array.from({ length: 5 }, () => completeUpload(guest, e, r.photoId)))
    expect(await jobs(r.photoId)).toBe(1)
  })

  test("only by the guest who reserved it, in the same event", async () => {
    const r = await reserve(guest, e, buf)
    const other = asGuest(e.id, (await makeGuest(e.id)).id)
    expect(await code(completeUpload(other, e, r.photoId))).toBe('not_found')
    const e2 = await makeEvent()
    expect(await code(completeUpload(asGuest(e2.id, guest.participantId), e2, r.photoId))).toBe('not_found')
  })

  test('states are given only for my own photos', async () => {
    const r = await reserve(guest, e, buf)
    expect(await uploadStates(guest, e, [r.photoId])).toEqual([{ photoId: r.photoId, state: 'reserved', reason: null }])
    const other = asGuest(e.id, (await makeGuest(e.id)).id)
    expect(await uploadStates(other, e, [r.photoId])).toEqual([])
  })
})

describe('freezing', () => {
  const freeze = async (at: Date) => {
    await db.update(events).set({ frozenAt: at }).where(eq(events.id, e.id))
    e = await fresh(e)
  }
  const ready = async (viewer = guest) => {
    const r = await reserve(viewer, e, buf)
    await storage.put(keys.incoming(e.id, r.photoId), buf, 'image/jpeg')
    return r.photoId
  }
  test('a file reserved before gets ten minutes', async () => {
    const [a, b] = [await ready(), await ready()]
    const at = new Date(Date.now() + 1000)
    await freeze(at)
    const plus = (min: number, sec: number) => new Date(at.getTime() + min * 60_000 + sec * 1000)
    expect(await code(completeUpload(guest, e, a, plus(9, 59)))).toBe('ok')
    expect(await code(completeUpload(guest, e, b, plus(10, 1)))).toBe('frozen')
  })
  test('an upload link can still be renewed inside the grace time, not after', async () => {
    const clientId = crypto.randomUUID()
    await reserve(guest, e, buf, { clientId })
    await freeze(new Date(Date.now() + 1000))
    expect(await code(reserve(guest, e, buf, { clientId }))).toBe('ok')
    await freeze(new Date(Date.now() - 11 * 60_000))
    await db.update(photos).set({ reservedAt: new Date(Date.now() - 12 * 60_000) })
    expect(await code(reserve(guest, e, buf, { clientId }))).toBe('frozen')
  })
  test('new photos are refused, even if the freeze lands at the same moment', async () => {
    const stale = e
    await freeze(new Date())
    expect(await code(reserve(guest, e, buf))).toBe('frozen')
    expect(await code(reserve(guest, stale, buf))).toBe('frozen')
    expect(await usage()).toEqual([0, 0])
  })
  test('the host can still add photos', async () => {
    await freeze(new Date(Date.now() - 3600_000))
    const host: Unlocked = { kind: 'host', eventId: e.id, participantId: (await makeGuest(e.id)).id, userId: 'u' }
    expect(await code(send(host, e, buf))).toBe('ok')
  })
})

describe('routes', () => {
  const call = (token: string, body: unknown) =>
    new Request('http://localhost:3000/x', { method: 'POST', headers: { cookie: `qg=${token}` }, body: JSON.stringify(body) })
  test('a guest can reserve and complete over HTTP', async () => {
    const g = await makeGuest(e.id)
    const res = await reserveRoute(call(g.token, { clientId: crypto.randomUUID(), size: buf.length, mime: 'image/jpeg', tags: [] }), {
      params: Promise.resolve({ code: e.code }),
    })
    expect(res.status).toBe(200)
    const { photoId } = (await res.json()) as { photoId: string }
    await storage.put(keys.incoming(e.id, photoId), buf, 'image/jpeg')
    const done = await completeRoute(call(g.token, {}), { params: Promise.resolve({ code: e.code, photoId }) })
    expect(await done.json()).toMatchObject({ state: 'processing' })
  })
  test.each([{ clientId: 'x' }, { size: -1 }, { size: 1.5 }, { tags: 'a' }, { albumId: 'x' }, { name: 'x'.repeat(41) }])('%j is refused', async (bad) => {
    const g = await makeGuest(e.id)
    const good = { clientId: crypto.randomUUID(), size: 10, mime: 'image/jpeg', tags: [] }
    const res = await reserveRoute(call(g.token, { ...good, ...bad }), { params: Promise.resolve({ code: e.code }) })
    expect(res.status).toBe(400)
  })
  test('a photo id that is not an id is not found', async () => {
    const g = await makeGuest(e.id)
    const res = await completeRoute(call(g.token, {}), { params: Promise.resolve({ code: e.code, photoId: 'nope' }) })
    expect(res.status).toBe(404)
  })
})
