import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import { GET } from '@/app/api/e/[code]/photos/route'
import { db } from '@/db/client'
import { comments, events, hearts, participants, photoContributors, photos, photoStatus, type EventRow, type PhotoStatus } from '@/db/schema'
import { createAlbum } from '@/modules/events/albums'
import { attachTags } from '@/modules/events/tags'
import { parseTags } from '@/modules/events/tag-text'
import { getPhotos, listPhotos, parseView, type View } from '@/modules/photos/query'
import { resetDb } from '../helpers/db'
import { makeEvent, makeGuest, makePhoto } from '../helpers/factory'
import { asGuest, fresh, type Unlocked } from '../helpers/upload'

let e: EventRow
let ana: Unlocked
let ben: Unlocked
let host: Unlocked
beforeEach(async () => {
  await resetDb()
  e = await makeEvent()
  ana = asGuest(e.id, (await makeGuest(e.id, { name: 'Ana' })).id)
  ben = asGuest(e.id, (await makeGuest(e.id)).id)
  host = { kind: 'host', eventId: e.id, participantId: (await makeGuest(e.id)).id, userId: 'u' }
})

const add = async (over: Parameters<typeof makePhoto>[2] = {}, by = ana) => {
  const p = await makePhoto(e.id, by.participantId, over)
  await db.insert(photoContributors).values({ photoId: p.id, participantId: by.participantId })
  return p
}
const list = async (v: Unlocked, view: View = { kind: 'all' }, order?: 'newest' | 'taken' | 'featured') =>
  (await listPhotos(v, await fresh(e), { view, order })).items
const ids = (items: { id: string }[]) => items.map((p) => p.id)
const settings = async (patch: Partial<EventRow['settings']>) => {
  e = await fresh(e)
  await db.update(events).set({ settings: { ...e.settings, ...patch } }).where(eq(events.id, e.id))
  e = await fresh(e)
}
const code = (p: Promise<unknown>) => p.then(() => 'ok', (err: { code: string }) => err.code)

describe('who sees what', () => {
  const sees: Record<PhotoStatus, [guest: boolean, uploader: boolean, host: boolean]> = {
    reserved: [false, false, true],
    uploaded: [false, true, true],
    processing: [false, true, true],
    pending: [false, true, true],
    live: [true, true, true],
    hidden: [false, false, true],
    failed: [false, false, true],
    duplicate: [false, false, false],
    expired: [false, false, false],
    deleted: [false, false, false],
  }
  test.each(photoStatus.enumValues)('%s', async (status) => {
    const p = await add({ status })
    const visible = async (v: Unlocked) => ids((await getPhotos(v, e, [p.id])).items).includes(p.id)
    expect([await visible(ben), await visible(ana), await visible(host)]).toEqual(sees[status])
  })

  test('lists agree: a guest never finds a photo in any view that they may not see', async () => {
    const album = await createAlbum(e.id, 'A')
    const tagged = parseTags(['x'])
    for (const status of photoStatus.enumValues) {
      const p = await add({ status, albumId: album.id, featured: true, heartCount: 3 })
      await attachTags(db, e.id, p.id, tagged)
    }
    const views: View[] = [{ kind: 'all' }, { kind: 'hearted' }, { kind: 'featured' }, { kind: 'mine' }, { kind: 'album', id: album.id }, { kind: 'tag', norm: 'x' }]
    for (const view of views) {
      const statuses = (await list(ben, view)).map((p) => p.status)
      expect(statuses).toEqual(view.kind === 'mine' ? [] : ['live'])
    }
    for (const kind of ['waiting', 'hidden', 'failed'] as const) expect(await code(list(ben, { kind }))).toBe('forbidden')
  })

  test('an invisible photo and one that never existed look the same', async () => {
    const hidden = await add({ status: 'hidden' })
    const nothing = crypto.randomUUID()
    expect(await getPhotos(ben, e, [hidden.id, nothing])).toEqual({ items: [], gone: [hidden.id, nothing] })
  })

  test('another event’s photos are never returned', async () => {
    const e2 = await makeEvent()
    const p = await makePhoto(e2.id, (await makeGuest(e2.id)).id)
    expect(await getPhotos(host, e, [p.id])).toEqual({ items: [], gone: [p.id] })
    const foreignAlbum = await createAlbum(e2.id, 'B')
    expect(await list(host, { kind: 'album', id: foreignAlbum.id })).toEqual([])
  })

  test('the host’s other views', async () => {
    const pending = await add({ status: 'pending', publishedAt: null })
    const hidden = await add({ status: 'hidden' })
    const failed = await add({ status: 'failed', failureCode: 'bad_type' })
    expect(ids(await list(host, { kind: 'waiting' }))).toEqual([pending.id])
    expect(ids(await list(host, { kind: 'hidden' }))).toEqual([hidden.id])
    expect(ids(await list(host, { kind: 'failed' }))).toEqual([failed.id])
  })
})

describe('order and views', () => {
  const t = (min: number) => new Date(Date.UTC(2026, 5, 12, 10, min))
  test('newest, time taken, featured first', async () => {
    const a = await add({ publishedAt: t(1), takenAt: t(30), featured: true })
    const b = await add({ publishedAt: t(2), takenAt: t(10) })
    const c = await add({ publishedAt: t(3), takenAt: t(20) })
    expect(ids(await list(ben, { kind: 'all' }, 'newest'))).toEqual([c.id, b.id, a.id])
    expect(ids(await list(ben, { kind: 'all' }, 'taken'))).toEqual([b.id, c.id, a.id])
    expect(ids(await list(ben, { kind: 'all' }, 'featured'))).toEqual([a.id, c.id, b.id])
    await settings({ defaultOrder: 'taken' })
    expect(ids(await list(ben))).toEqual([b.id, c.id, a.id])
  })

  test('albums, tags, featured, hearted and mine', async () => {
    const album = await createAlbum(e.id, 'Dance')
    const inAlbum = await add({ albumId: album.id })
    const tagged = await add()
    await attachTags(db, e.id, tagged.id, parseTags(['#BrideSquad']))
    const featured = await add({ featured: true })
    const [two, five] = [await add({ heartCount: 2 }), await add({ heartCount: 5 })]
    const bens = await add({}, ben)
    expect(ids(await list(ben, { kind: 'album', id: album.id }))).toEqual([inAlbum.id])
    expect(ids(await list(ben, { kind: 'tag', norm: 'bridesquad' }))).toEqual([tagged.id])
    expect(ids(await list(ben, { kind: 'featured' }))).toEqual([featured.id])
    expect(ids(await list(ben, { kind: 'hearted' }))).toEqual([five.id, two.id])
    expect(ids(await list(ben, { kind: 'mine' }))).toEqual([bens.id])
  })

  test('hearts off hides counts and the hearted view', async () => {
    const p = await add({ heartCount: 5 })
    await db.insert(hearts).values({ photoId: p.id, participantId: ben.participantId })
    expect((await list(ben))[0]).toMatchObject({ heartCount: 5, hearted: true })
    await settings({ hearts: false })
    expect((await list(ben))[0]).not.toHaveProperty('heartCount')
    expect((await list(ben))[0]).not.toHaveProperty('hearted')
    expect(await code(list(ben, { kind: 'hearted' }))).toBe('feature_off')
  })

  test('comment counts leave out hidden and deleted ones, and vanish when off', async () => {
    const p = await add()
    const base = { eventId: e.id, photoId: p.id, participantId: ben.participantId, text: 'hi' }
    await db.insert(comments).values([base, { ...base, hidden: true }, { ...base, deletedAt: new Date() }])
    expect((await list(ben))[0]!.commentCount).toBe(1)
    await settings({ comments: false })
    expect((await list(ben))[0]).not.toHaveProperty('commentCount')
  })
})

describe('paging', () => {
  test.each(['newest', 'taken', 'featured'] as const)('150 photos with equal times come once each (%s)', async (order) => {
    const same = new Date()
    await db.insert(photos).values(
      Array.from({ length: 150 }, (_, i) => ({
        eventId: e.id, participantId: ana.participantId, clientId: crypto.randomUUID(), status: 'live' as const, sizeBytes: 1,
        publishedAt: same, takenAt: same, uploadedAt: same, featured: i % 3 === 0,
      })),
    )
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page: Awaited<ReturnType<typeof listPhotos>> = await listPhotos(ben, e, { view: { kind: 'all' }, order, cursor, limit: 40 })
      seen.push(...ids(page.items))
      cursor = page.next
      // Someone adds a photo between pages.
      if (seen.length === 40) await add({ publishedAt: new Date(Date.now() + 1000), takenAt: new Date(0), featured: true })
    } while (cursor)
    const original = new Set(seen)
    expect(original.size).toBe(seen.length)
    expect(seen.length).toBe(150)
  })

  test('microseconds are not lost', async () => {
    const { sql } = await import('drizzle-orm')
    for (let i = 0; i < 5; i++) {
      const p = await add()
      await db.update(photos).set({ publishedAt: sql.raw(`'2026-06-12 10:00:00.00010${i}+00'`) as unknown as Date }).where(eq(photos.id, p.id))
    }
    const a = await listPhotos(ben, e, { view: { kind: 'all' }, limit: 2 })
    const b = await listPhotos(ben, e, { view: { kind: 'all' }, limit: 2, cursor: a.next })
    const c = await listPhotos(ben, e, { view: { kind: 'all' }, limit: 2, cursor: b.next })
    expect(new Set(ids([...a.items, ...b.items, ...c.items])).size).toBe(5)
    expect(c.next).toBeNull()
  })

  test.each(['x', 'W10', Buffer.from('["1;drop","2","3"]').toString('base64url'), Buffer.from('{}').toString('base64url')])(
    'the cursor %j is refused',
    async (cursor) => expect(await code(listPhotos(ben, e, { view: { kind: 'all' }, cursor }))).toBe('bad_input'),
  )
})

describe('what a photo says', () => {
  test('names, tags, ownership', async () => {
    const p = await add()
    await attachTags(db, e.id, p.id, parseTags(['#B', '#a']))
    expect((await list(ana))[0]).toMatchObject({ uploader: 'Ana', tags: ['a', 'B'], mine: true, canDelete: true, canDownload: true })
    expect((await list(ben))[0]).toMatchObject({ mine: false, canDelete: false })
    expect((await list(host))[0]).toMatchObject({ mine: false, canDelete: true })
  })
  test('a blank name is Guest, and a new name changes earlier photos', async () => {
    await add({}, ben)
    expect((await list(ana))[0]!.uploader).toBe('Guest')
    await db.update(participants).set({ name: 'Ben' }).where(eq(participants.id, ben.participantId))
    expect((await list(ana))[0]!.uploader).toBe('Ben')
  })
  test('someone who sent the same photo also counts as its owner', async () => {
    const p = await add()
    await db.insert(photoContributors).values({ photoId: p.id, participantId: ben.participantId })
    expect((await list(ben))[0]).toMatchObject({ mine: true, canDelete: true })
  })
  test('unfinished photos have no image links', async () => {
    await add({ status: 'processing' })
    expect((await list(ana))[0]).toMatchObject({ thumbUrl: null, displayUrl: null, canDownload: false })
  })
  test('guests are told nothing about files, hashes or people’s ids', async () => {
    await add({ sha256: 'SECRETHASH' })
    const text = JSON.stringify(await list(ben))
    expect(text).not.toContain('SECRETHASH')
    expect(text).not.toContain(ana.participantId)
    expect(text).not.toContain('/original/')
  })
})

describe('the route', () => {
  test.each([
    ['all', { kind: 'all' }],
    ['tag:niño', { kind: 'tag', norm: 'niño' }],
    ['album:6f1a3c1e-0000-4000-8000-000000000000', { kind: 'album', id: '6f1a3c1e-0000-4000-8000-000000000000' }],
    ['album:nope', null],
    ['everything', null],
    ['', { kind: 'all' }],
  ])('view %j', (text, view) => expect(parseView(text)).toEqual(view))

  test('a locked guest gets nothing', async () => {
    const { setPin } = await import('@/modules/events/pin')
    await setPin(db, e.id, '1234')
    await add()
    const token = 'A'.repeat(43)
    const res = await GET(new Request('http://localhost:3000/x', { headers: { cookie: `qg=${token}` } }), { params: Promise.resolve({ code: e.code }) })
    expect(res.status).toBe(401)
  })
})
