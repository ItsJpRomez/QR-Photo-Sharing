import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as session from '@/auth/session'
import { getAuth } from '@/auth/server'
import { POST as deleteAccountRoute } from '@/app/api/host/account/delete/route'
import { DELETE as deleteRoute } from '@/app/api/host/events/[id]/route'
import { POST as restoreRoute } from '@/app/api/host/events/[id]/restore/route'
import { db } from '@/db/client'
import { account, session as sessions, user } from '@/db/auth-schema'
import { events, exports, participants, photos, rateLimits, type EventRow } from '@/db/schema'
import { runCleanup } from '@/jobs/cleanup'
import { resolveViewer } from '@/modules/access/viewer'
import { createEvent, deleteEvent, restoreEvent } from '@/modules/events/events'
import { usageLevel } from '@/modules/events/usage'
import { getHub } from '@/modules/live/hub'
import { reserveUpload } from '@/modules/photos/uploads'
import { keys, storage } from '@/modules/storage'
import { eventByTvToken } from '@/modules/tv/tv'
import { resetDb } from '../helpers/db'
import { makeEvent, makeGuest, makeUser } from '../helpers/factory'
import { asGuest, fixture, fresh, photoRow, reserve, send, uniqueJpeg, upload, type Unlocked } from '../helpers/upload'

let e: EventRow
let ana: Unlocked
beforeEach(async () => {
  vi.restoreAllMocks()
  await resetDb()
  e = await makeEvent()
  ana = asGuest(e.id, (await makeGuest(e.id)).id)
})
const HOUR = 3600_000
const DAY = 24 * HOUR
const later = (ms: number) => new Date(Date.now() + ms)
const code = (x: Promise<unknown>) => x.then(() => 'ok', (err: { code: string }) => err.code)
const guestReq = (token: string) => ({ headers: new Headers({ cookie: `qg=${token}` }) })

describe('unfinished uploads', () => {
  test('are let go after a day, and can be taken up again', async () => {
    const buf = await uniqueJpeg()
    const clientId = crypto.randomUUID()
    const r = await reserve(ana, e, buf, { clientId })
    await storage.put(keys.incoming(e.id, r.photoId), buf, 'image/jpeg')
    await runCleanup(later(23 * HOUR))
    expect((await photoRow(r.photoId)).status).toBe('reserved')
    await runCleanup(later(25 * HOUR))
    expect((await photoRow(r.photoId)).status).toBe('expired')
    expect(await fresh(e)).toMatchObject({ usedPhotos: 0, usedBytes: 0 })
    expect(await storage.head(keys.incoming(e.id, r.photoId))).toBeNull()
    expect(await reserveUpload(ana, await fresh(e), { clientId, size: buf.length, mime: 'image/jpeg' })).toMatchObject({ photoId: r.photoId, state: 'reserved' })
  })
  test('a photo stuck half way is failed, so its sender hears and can retry', async () => {
    const id = await send(ana, e, await uniqueJpeg())
    await db.update(photos).set({ status: 'processing' }).where(eq(photos.id, id))
    await runCleanup(later(1 * HOUR))
    expect((await photoRow(id)).status).toBe('processing')
    await runCleanup(later(3 * HOUR))
    expect(await photoRow(id)).toMatchObject({ status: 'failed', failureCode: 'internal' })
    expect((await fresh(e)).usedPhotos).toBe(0)
  })
  test('live photos are never touched', async () => {
    const p = await upload(ana, e, await uniqueJpeg())
    await runCleanup(later(400 * DAY))
    expect((await photoRow(p.id)).status).toBe('live')
    expect(await storage.head(keys.original(e.id, p.id, 'jpg'))).not.toBeNull()
  })
})

describe('a deleted event', () => {
  test('is gone for guests and the TV at once, and streams end', async () => {
    await getHub().ready()
    let closed = false
    getHub().subscribe(e.id, ana, { send: () => {}, close: () => (closed = true) })
    const g = await makeGuest(e.id)
    await deleteEvent(e.id)
    await vi.waitFor(() => expect(closed).toBe(true))
    expect(await code(resolveViewer({ code: e.code }, guestReq(g.token)))).toBe('not_found')
    expect(await code(eventByTvToken(e.tvToken))).toBe('not_found')
    await getHub().stop()
  })
  test('can come back on day six, not after purge on day eight', async () => {
    const p = await upload(ana, e, fixture('p3.jpg'))
    await deleteEvent(e.id)
    await runCleanup(later(6 * DAY))
    await restoreEvent(e.ownerId!, e.id)
    expect((await fresh(e)).deletedAt).toBeNull()
    expect((await photoRow(p.id)).status).toBe('live')

    const other = await makeEvent()
    const kept = await upload(asGuest(other.id, (await makeGuest(other.id)).id), other, fixture('p3.jpg'))
    await deleteEvent(e.id)
    await runCleanup(later(8 * DAY))
    expect(await db.select().from(events).where(eq(events.id, e.id))).toHaveLength(0)
    expect(await db.select().from(participants).where(eq(participants.eventId, e.id))).toHaveLength(0)
    expect(await storage.head(keys.original(e.id, p.id, 'jpg'))).toBeNull()
    expect(await storage.head(keys.thumb(e.id, p.id))).toBeNull()
    expect(await storage.head(keys.original(other.id, kept.id, 'jpg'))).not.toBeNull()
    expect(await code(restoreEvent(e.ownerId!, e.id))).toBe('not_found')
  })
  test('if its files cannot be removed yet, it is tried again next time', async () => {
    await upload(ana, e, await uniqueJpeg())
    await deleteEvent(e.id)
    const spy = vi.spyOn(storage, 'deletePrefix').mockRejectedValueOnce(new Error('down'))
    await runCleanup(later(8 * DAY))
    expect(await db.select().from(events)).toHaveLength(1)
    spy.mockRestore()
    await runCleanup(later(8 * DAY))
    expect(await db.select().from(events)).toHaveLength(0)
  })
  test('bringing one back still counts toward ten', async () => {
    const owner = await makeUser()
    const mine = await Promise.all(Array.from({ length: 10 }, () => makeEvent({ ownerId: owner.id })))
    await deleteEvent(mine[0]!.id)
    await createEvent(owner.id, { name: 'New', eventDate: '2026-06-12', timeZone: 'UTC' })
    expect(await code(restoreEvent(owner.id, mine[0]!.id))).toBe('event_limit')
  })
  test('only by its owner', async () => {
    vi.spyOn(session, 'getUser').mockResolvedValue({ ...(await makeUser()), emailVerified: true })
    const ctx = { params: Promise.resolve({ id: e.id }) }
    expect((await deleteRoute(new Request('http://localhost:3000/x', { method: 'DELETE' }), ctx)).status).toBe(404)
    await deleteEvent(e.id)
    expect((await restoreRoute(new Request('http://localhost:3000/x', { method: 'POST' }), ctx)).status).toBe(404)
  })
})

describe('deleting the account', () => {
  const base = 'http://localhost:3000'
  async function signedIn() {
    const res = await getAuth().handler(new Request(`${base}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: 'ana@example.test', password: 'correct horse 9', name: 'Ana' }) }))
    const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    await db.update(user).set({ emailVerified: true })
    const [u] = await db.select().from(user).where(eq(user.email, 'ana@example.test'))
    return { cookie, id: u!.id }
  }
  const call = (cookie: string, body: object) =>
    deleteAccountRoute(new Request(`${base}/x`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({}) })

  test('needs the password; then events lock at once and go on day eight', async () => {
    const { cookie, id } = await signedIn()
    const mine = await createEvent(id, { name: 'Mine', eventDate: '2026-06-12', timeZone: 'UTC' })
    const p = await upload(asGuest(mine.id, (await makeGuest(mine.id)).id), mine, await uniqueJpeg())
    expect((await call(cookie, {})).status).toBe(403)
    expect((await call(cookie, { password: 'wrong password' })).status).toBe(403)
    expect(await db.select().from(user).where(eq(user.id, id))).toHaveLength(1)
    expect((await call(cookie, { password: 'correct horse 9' })).status).toBe(200)
    expect(await db.select().from(user).where(eq(user.id, id))).toHaveLength(0)
    expect(await db.select().from(sessions)).toHaveLength(0)
    expect(await code(resolveViewer({ code: mine.code }, guestReq('A'.repeat(43))))).toBe('not_found')
    expect((await fresh(mine)).ownerId).toBeNull()
    await runCleanup(later(8 * DAY))
    expect(await db.select().from(events).where(eq(events.id, mine.id))).toHaveLength(0)
    expect(await storage.head(keys.original(mine.id, p.id, 'jpg'))).toBeNull()
  })
  test('without a password, only right after signing in', async () => {
    const { cookie, id } = await signedIn()
    await db.update(account).set({ providerId: 'google', password: null })
    await db.update(sessions).set({ createdAt: new Date(Date.now() - 11 * 60_000) })
    expect((await call(cookie, {})).status).toBe(403)
    await db.update(sessions).set({ createdAt: new Date() })
    expect((await call(cookie, {})).status).toBe(200)
    expect(await db.select().from(user).where(eq(user.id, id))).toHaveLength(0)
  })
})

describe('limits', () => {
  test.each([
    [0.89, 0, 'ok'],
    [0.9, 0, 'near'],
    [0, 0.9, 'near'],
    [0.5, 0.89, 'ok'],
    [1, 0, 'full'],
    [0, 1, 'full'],
  ])('%f of photos and %f of space is %s', (p, b, level) =>
    expect(usageLevel({ usedPhotos: p * 1000, maxPhotos: 1000, usedBytes: b * 1000, maxBytes: 1000 })).toBe(level))
})

describe('tidying', () => {
  test('old counters go, current ones stay', async () => {
    await db.insert(rateLimits).values([
      { key: 'old', windowStart: new Date(Date.now() - 25 * HOUR), count: 1 },
      { key: 'new', windowStart: new Date(), count: 1 },
    ])
    await runCleanup(new Date())
    expect((await db.select().from(rateLimits)).map((r) => r.key)).toEqual(['new'])
  })
  test('an export that never finished is failed', async () => {
    await db.insert(exports).values({ eventId: e.id, options: { includeHidden: false, includePending: false }, photoIds: [], status: 'running', requestedAt: new Date(Date.now() - 25 * HOUR) })
    await runCleanup(new Date())
    expect((await db.select().from(exports))[0]!.status).toBe('failed')
  })
  test('twice, or two at once, is harmless', async () => {
    await upload(ana, e, await uniqueJpeg())
    await deleteEvent(e.id)
    await Promise.all([runCleanup(later(8 * DAY)), runCleanup(later(8 * DAY)), runCleanup(later(8 * DAY))])
    await runCleanup(later(8 * DAY))
    expect(await db.select().from(events)).toHaveLength(0)
  })
})
