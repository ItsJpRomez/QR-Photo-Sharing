import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as session from '@/auth/session'
import { DELETE as deleteAlbumRoute, PATCH as patchAlbumRoute } from '@/app/api/host/events/[id]/albums/[albumId]/route'
import { PUT as orderRoute } from '@/app/api/host/events/[id]/albums/order/route'
import { POST as addAlbumRoute } from '@/app/api/host/events/[id]/albums/route'
import { POST as codeRoute } from '@/app/api/host/events/[id]/code/route'
import { PUT as frozenRoute } from '@/app/api/host/events/[id]/frozen/route'
import { PUT as pinRoute } from '@/app/api/host/events/[id]/pin/route'
import { GET as getEventRoute, PATCH as patchEventRoute } from '@/app/api/host/events/[id]/route'
import { PATCH as settingsRoute } from '@/app/api/host/events/[id]/settings/route'
import { PATCH as patchTagRoute } from '@/app/api/host/events/[id]/tags/[tagId]/route'
import { POST as addTagRoute } from '@/app/api/host/events/[id]/tags/route'
import { POST as tvRoute } from '@/app/api/host/events/[id]/tv-token/route'
import { GET as listRoute, POST as createRoute } from '@/app/api/host/events/route'
import { db } from '@/db/client'
import { albums, events, hashtags, photoHashtags } from '@/db/schema'
import { AppError } from '@/lib/errors'
import { createAlbum, listAlbums, reorderAlbums } from '@/modules/events/albums'
import { createEvent } from '@/modules/events/events'
import { attachTags, blockTag, suggestTag, trendingTags } from '@/modules/events/tags'
import { parseTags } from '@/modules/events/tag-text'
import { resetDb } from '../helpers/db'
import { makeEvent, makeGuest, makePhoto, makeUser } from '../helpers/factory'

beforeEach(async () => {
  vi.restoreAllMocks()
  await resetDb()
})

const as = (u: { id: string; email: string; name: string; emailVerified?: boolean }) =>
  vi.spyOn(session, 'getUser').mockResolvedValue({ emailVerified: true, ...u })
const input = {
  name: 'Ana & Marco',
  eventDate: '2026-06-12',
  timeZone: 'Asia/Manila',
  welcome: 'Hi',
  accent: '#4a2370',
  albums: ['Ceremony', 'Dance Floor'],
  tags: ['#BrideSquad'],
  pin: null,
}
const body = (b: unknown, method = 'POST') => new Request('http://localhost:3000/x', { method, body: JSON.stringify(b) })
const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) })
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: AppError) => e.code)

describe('creating', () => {
  test('makes the event, its albums and suggested tags', async () => {
    const u = await makeUser()
    const e = await createEvent(u.id, input)
    expect(e).toMatchObject({ ownerId: u.id, name: 'Ana & Marco', maxPhotos: 5000, maxBytes: 25 * 1024 ** 3, pinHash: null })
    expect((await listAlbums(e.id)).map((a) => a.name)).toEqual(['Ceremony', 'Dance Floor'])
    expect(await db.select().from(hashtags)).toMatchObject([{ norm: 'bridesquad', suggested: true }])
  })

  test('with a PIN', async () => {
    expect((await createEvent((await makeUser()).id, { ...input, pin: '4821' })).pinHash).toBeTruthy()
  })

  test.each([
    ['time zone', { timeZone: 'Mars/Base' }],
    ['date', { eventDate: '2026-02-31' }],
    ['name', { name: '   ' }],
    ['long name', { name: 'x'.repeat(81) }],
    ['color', { accent: 'red;}' }],
    ['pin', { pin: '12' }],
    ['album', { albums: [''] }],
  ])('a bad %s is refused', async (_label, over) => {
    const u = await makeUser()
    as(u)
    const res = await createRoute(body({ ...input, ...over }), ctx({}))
    expect(res.status).toBe(400)
    expect(await db.select().from(events)).toHaveLength(0)
  })

  test('an unverified host cannot', async () => {
    as({ ...(await makeUser()), emailVerified: false })
    expect((await createRoute(body(input), ctx({}))).status).toBe(403)
  })

  test('ten events, even when requested all at once', async () => {
    const u = await makeUser()
    const results = await Promise.all(Array.from({ length: 14 }, () => code(createEvent(u.id, input))))
    expect(results.filter((r) => r === 'ok')).toHaveLength(10)
    expect(results.filter((r) => r === 'event_limit')).toHaveLength(4)
  })
})

describe('only the owner', () => {
  test('every host route hides the event from another host', async () => {
    const owner = await makeUser()
    const e = await makeEvent({ ownerId: owner.id })
    const album = await createAlbum(e.id, 'Ceremony')
    const tag = await suggestTag(e.id, 'Keynote')
    as(await makeUser())
    const p = ctx({ id: e.id })
    const pa = ctx({ id: e.id, albumId: album.id })
    const pt = ctx({ id: e.id, tagId: tag.id })
    const calls: Promise<Response>[] = [
      getEventRoute(new Request('http://localhost:3000/x'), p),
      patchEventRoute(body({ name: 'Hacked' }, 'PATCH'), p),
      settingsRoute(body({ hearts: false }, 'PATCH'), p),
      frozenRoute(body({ frozen: true }, 'PUT'), p),
      pinRoute(body({ pin: '1111' }, 'PUT'), p),
      codeRoute(body({}), p),
      tvRoute(body({}), p),
      addAlbumRoute(body({ name: 'x' }), p),
      orderRoute(body({ ids: [album.id] }, 'PUT'), p),
      patchAlbumRoute(body({ name: 'x' }, 'PATCH'), pa),
      deleteAlbumRoute(body({}, 'DELETE'), pa),
      addTagRoute(body({ tag: 'x' }), p),
      patchTagRoute(body({ blocked: true }, 'PATCH'), pt),
    ]
    for (const res of await Promise.all(calls)) expect(res.status).toBe(404)
    const [after] = await db.select().from(events).where(eq(events.id, e.id))
    expect(after).toEqual(e)
  })

  test('signed out is told to sign in', async () => {
    const e = await makeEvent()
    vi.spyOn(session, 'getUser').mockResolvedValue(null)
    expect((await getEventRoute(new Request('http://localhost:3000/x'), ctx({ id: e.id }))).status).toBe(401)
  })

  test("an album or tag of another event isn't found", async () => {
    const u = await makeUser()
    as(u)
    const mine = await makeEvent({ ownerId: u.id })
    const other = await makeEvent()
    const album = await createAlbum(other.id, 'Theirs')
    const tag = await suggestTag(other.id, 'theirs')
    expect((await patchAlbumRoute(body({ name: 'x' }, 'PATCH'), ctx({ id: mine.id, albumId: album.id }))).status).toBe(404)
    expect((await deleteAlbumRoute(body({}, 'DELETE'), ctx({ id: mine.id, albumId: album.id }))).status).toBe(404)
    expect((await patchTagRoute(body({ blocked: true }, 'PATCH'), ctx({ id: mine.id, tagId: tag.id }))).status).toBe(404)
    expect((await listAlbums(other.id)).map((a) => a.name)).toEqual(['Theirs'])
  })

  test('the list holds only my events, and no PIN hash', async () => {
    const u = await makeUser()
    as(u)
    const mine = await makeEvent({ ownerId: u.id, pinHash: 'hash-secret' })
    await makeEvent()
    const res = await (await listRoute(new Request('http://localhost:3000/x'), ctx({}))).json()
    expect(res.events.map((e: { id: string }) => e.id)).toEqual([mine.id])
    expect(JSON.stringify(res)).not.toContain('hash-secret')
    expect(res.events[0]).toMatchObject({ hasPin: true })
  })
})

describe('managing', () => {
  test('settings change one at a time and reject unknown keys', async () => {
    const u = await makeUser()
    as(u)
    const e = await makeEvent({ ownerId: u.id })
    expect((await settingsRoute(body({ hearts: false }, 'PATCH'), ctx({ id: e.id }))).status).toBe(200)
    expect((await settingsRoute(body({ tv: { seconds: 12 } }, 'PATCH'), ctx({ id: e.id }))).status).toBe(200)
    const [after] = await db.select().from(events)
    expect(after!.settings).toMatchObject({ hearts: false, comments: true, tv: { seconds: 12, showNames: true } })
    expect((await settingsRoute(body({ admin: true }, 'PATCH'), ctx({ id: e.id }))).status).toBe(400)
    expect((await settingsRoute(body({ tv: { seconds: 0 } }, 'PATCH'), ctx({ id: e.id }))).status).toBe(400)
    expect((await settingsRoute(body({ tv: { showPin: true } }, 'PATCH'), ctx({ id: e.id }))).status).toBe(400)
  })

  test('the owner, limits and code cannot be patched', async () => {
    const u = await makeUser()
    as(u)
    const e = await makeEvent({ ownerId: u.id })
    await patchEventRoute(body({ name: 'New', maxPhotos: 999999, ownerId: 'x', code: 'x' }, 'PATCH'), ctx({ id: e.id }))
    const [after] = await db.select().from(events)
    expect(after).toMatchObject({ maxPhotos: e.maxPhotos, ownerId: u.id, code: e.code })
  })

  test('a new link replaces the old one', async () => {
    const u = await makeUser()
    as(u)
    const e = await makeEvent({ ownerId: u.id })
    await codeRoute(body({}), ctx({ id: e.id }))
    await tvRoute(body({}), ctx({ id: e.id }))
    const [after] = await db.select().from(events)
    expect(after!.code).not.toBe(e.code)
    expect(after!.tvToken).not.toBe(e.tvToken)
  })

  test('freezing keeps the first time', async () => {
    const u = await makeUser()
    as(u)
    const e = await makeEvent({ ownerId: u.id })
    await frozenRoute(body({ frozen: true }, 'PUT'), ctx({ id: e.id }))
    const [first] = await db.select().from(events)
    await frozenRoute(body({ frozen: true }, 'PUT'), ctx({ id: e.id }))
    const [second] = await db.select().from(events)
    expect(second!.frozenAt).toEqual(first!.frozenAt)
    await frozenRoute(body({ frozen: false }, 'PUT'), ctx({ id: e.id }))
    expect((await db.select().from(events))[0]!.frozenAt).toBeNull()
  })
})

describe('albums', () => {
  test('reorder needs exactly the existing albums', async () => {
    const e = await makeEvent()
    const other = await createAlbum((await makeEvent()).id, 'Other')
    const [a, b, c] = [await createAlbum(e.id, 'A'), await createAlbum(e.id, 'B'), await createAlbum(e.id, 'C')]
    await reorderAlbums(e.id, [c!.id, a!.id, b!.id])
    const names = async () => (await listAlbums(e.id)).map((x) => x.name)
    expect(await names()).toEqual(['C', 'A', 'B'])
    for (const ids of [[a!.id, b!.id], [a!.id, b!.id, other.id], [a!.id, a!.id, b!.id], [a!.id, b!.id, c!.id, other.id]])
      expect(await code(reorderAlbums(e.id, ids))).toBe('bad_input')
    expect(await names()).toEqual(['C', 'A', 'B'])
  })

  test('at most 30', async () => {
    const e = await makeEvent()
    await db.insert(albums).values(Array.from({ length: 30 }, (_, i) => ({ eventId: e.id, name: `A${i}`, position: i })))
    expect(await code(createAlbum(e.id, 'One more'))).toBe('bad_input')
  })
})

describe('hashtags', () => {
  test('blocking removes a tag everywhere and stops it coming back', async () => {
    const e = await makeEvent()
    const g = await makeGuest(e.id)
    const p = await makePhoto(e.id, g.id)
    await attachTags(db, e.id, p.id, parseTags(['#Rude', '#Nice']))
    expect(await db.select().from(photoHashtags)).toHaveLength(2)
    const [rude] = await db.select().from(hashtags).where(eq(hashtags.norm, 'rude'))
    await blockTag(e.id, rude!.id)
    expect(await db.select().from(photoHashtags)).toHaveLength(1)
    await attachTags(db, e.id, p.id, parseTags(['#rude', '#RUDE']))
    expect(await db.select().from(photoHashtags)).toHaveLength(1)
    expect((await trendingTags(e.id, new Date())).map((t) => t.norm)).toEqual(['nice'])
  })

  test('trending favors the last two hours, then the total', async () => {
    const e = await makeEvent()
    const g = await makeGuest(e.id)
    const now = new Date()
    const old = new Date(now.getTime() - 3 * 3600_000)
    const add = async (tag: string, publishedAt: Date, n: number, status: 'live' | 'hidden' = 'live') => {
      for (let i = 0; i < n; i++)
        await attachTags(db, e.id, (await makePhoto(e.id, g.id, { publishedAt, status })).id, parseTags([tag]))
    }
    await add('old', old, 5)
    await add('hot', now, 2)
    await add('warm', now, 1)
    await add('warm', old, 1)
    await add('cool', now, 1)
    await add('secret', now, 9, 'hidden')
    expect((await trendingTags(e.id, now)).map((t) => [t.norm, t.count])).toEqual([
      ['hot', 2],
      ['warm', 2],
      ['cool', 1],
      ['old', 5],
    ])
  })

  test('suggesting a blocked tag allows it again', async () => {
    const e = await makeEvent()
    const t = await suggestTag(e.id, 'Fun')
    await blockTag(e.id, t.id)
    expect(await suggestTag(e.id, '#fun')).toMatchObject({ id: t.id, blocked: false, suggested: true })
    expect(await code(suggestTag(e.id, 'no spaces!'))).toBe('bad_input')
  })
})
