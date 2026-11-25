import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as streamRoute } from '@/app/api/e/[code]/stream/route'
import { db, withTx } from '@/db/client'
import { events, photos, type EventRow } from '@/db/schema'
import { createAlbum } from '@/modules/events/albums'
import { replaceCode, setFrozen, updateSettings } from '@/modules/events/events'
import { setPin } from '@/modules/events/pin'
import { attachTags, blockTag } from '@/modules/events/tags'
import { parseTags } from '@/modules/events/tag-text'
import { getHub, HEARTS_MS, type Outgoing } from '@/modules/live/hub'
import { publish } from '@/modules/live/publish'
import { getPhotos } from '@/modules/photos/query'
import { resetDb } from '../helpers/db'
import { makeEvent, makeGuest, makePhoto } from '../helpers/factory'
import { asGuest, fresh, uniqueJpeg, upload, type Unlocked } from '../helpers/upload'

let e: EventRow
let ana: Unlocked
let ben: Unlocked
let host: Unlocked
const cleanups: (() => void)[] = []

beforeEach(async () => {
  await resetDb()
  await getHub().ready()
  e = await makeEvent()
  ana = asGuest(e.id, (await makeGuest(e.id)).id)
  ben = asGuest(e.id, (await makeGuest(e.id)).id)
  host = { kind: 'host', eventId: e.id, participantId: (await makeGuest(e.id)).id, userId: 'u' }
})
afterEach(() => cleanups.splice(0).forEach((f) => f()))
afterAll(() => getHub().stop())

function listen(v: Unlocked, eventId = e.id) {
  const got: Outgoing[] = []
  let closed = false
  cleanups.push(getHub().subscribe(eventId, v, { send: (m) => got.push(m), close: () => (closed = true) }))
  return { got, isClosed: () => closed, ids: (type = 'photos') => got.filter((m) => m.type === type).flatMap((m) => m.ids) }
}
const soon = (check: () => void) => vi.waitFor(check, { timeout: 3000, interval: 20 })
/** Long enough for anything already sent to have arrived. */
async function quiet() {
  const probe = listen(host, (await makeEvent()).id)
  void probe
  await new Promise((r) => setTimeout(r, 150))
}

describe('announcements', () => {
  test('arrive once, only if the change was kept', async () => {
    const l = listen(ben)
    await withTx(async (tx) => {
      await publish(tx, { eventId: e.id, type: 'event', ids: ['kept'], audience: 'everyone' })
    })
    await withTx(async (tx) => {
      await publish(tx, { eventId: e.id, type: 'event', ids: ['undone'], audience: 'everyone' })
      tx.rollback()
    }).catch(() => {})
    await soon(() => expect(l.got).toHaveLength(1))
    await quiet()
    expect(l.ids('event')).toEqual(['kept'])
  })

  test('stay inside their event', async () => {
    const other = await makeEvent()
    const l = listen(asGuest(other.id, (await makeGuest(other.id)).id), other.id)
    await publish(db, { eventId: e.id, type: 'photos', ids: ['x'], audience: 'everyone' })
    await quiet()
    expect(l.got).toEqual([])
  })

  test('250 ids come in three parts', async () => {
    const l = listen(ben)
    const ids = Array.from({ length: 250 }, () => crypto.randomUUID())
    await publish(db, { eventId: e.id, type: 'photos', ids, audience: 'everyone' })
    await soon(() => expect(l.ids()).toHaveLength(250))
    expect(l.got).toHaveLength(3)
    expect(new Set(l.ids())).toEqual(new Set(ids))
  })

  test('reach only the people they are for', async () => {
    const [a, b, h] = [listen(ana), listen(ben), listen(host)]
    await publish(db, { eventId: e.id, type: 'photos', ids: ['mine'], audience: [ana.participantId] })
    await publish(db, { eventId: e.id, type: 'photos', ids: ['hosts'], audience: 'host' })
    await soon(() => expect(h.ids()).toEqual(['mine', 'hosts']))
    expect(a.ids()).toEqual(['mine'])
    expect(b.ids()).toEqual([])
  })

  test('many hearts make one message', async () => {
    const l = listen(ben)
    for (let i = 0; i < 50; i++) await publish(db, { eventId: e.id, type: 'hearts', ids: [`p${i % 5}`], audience: 'everyone' })
    await vi.waitFor(() => expect(l.got).toHaveLength(1), { timeout: HEARTS_MS + 2000 })
    expect(l.got[0]!.ids.toSorted()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
    expect(l.got[0]).not.toHaveProperty('audience')
  })
})

describe('photos', () => {
  test('a new photo reaches everyone', async () => {
    const l = listen(ben)
    const p = await upload(ana, e, await uniqueJpeg())
    await soon(() => expect(l.ids()).toContain(p.id))
  })

  test('a waiting photo reaches its sender and the host, not other guests', async () => {
    await updateSettings(e.id, { approval: true })
    e = await fresh(e)
    const [a, b, h] = [listen(ana), listen(ben), listen(host)]
    const p = await upload(ana, e, await uniqueJpeg())
    await soon(() => {
      expect(a.ids()).toContain(p.id)
      expect(h.ids()).toContain(p.id)
    })
    await quiet()
    expect(JSON.stringify(b.got)).not.toContain(p.id)
  })

  test('a photo that fails reaches its sender and the host only', async () => {
    const [a, b, h] = [listen(ana), listen(ben), listen(host)]
    const p = await upload(ana, e, Buffer.from('not a photo'.repeat(20)))
    await soon(() => {
      expect(a.ids()).toContain(p.id)
      expect(h.ids()).toContain(p.id)
    })
    await quiet()
    expect(JSON.stringify(b.got)).not.toContain(p.id)
  })

  test('sending the same photo tells the second guest about the first one', async () => {
    const buf = await uniqueJpeg()
    const first = await upload(ana, e, buf)
    const l = listen(ben)
    await upload(ben, e, buf)
    await soon(() => expect(l.ids()).toContain(first.id))
  })

  test('an id that is no longer visible comes back as gone', async () => {
    const p = await makePhoto(e.id, ana.participantId)
    await db.update(photos).set({ status: 'hidden' }).where(eq(photos.id, p.id))
    expect(await getPhotos(ben, e, [p.id])).toEqual({ items: [], gone: [p.id] })
  })

  test('removing a hashtag refreshes the photos that had it', async () => {
    const p = await makePhoto(e.id, ana.participantId)
    await attachTags(db, e.id, p.id, parseTags(['rude']))
    const [tag] = (await db.execute<{ id: string }>(sql`select id from hashtags`)).rows
    const l = listen(ben)
    await blockTag(e.id, tag!.id)
    await soon(() => expect(l.ids()).toEqual([p.id]))
  })
})

describe('the event', () => {
  test('settings, freezing and albums are announced', async () => {
    const l = listen(ben)
    await updateSettings(e.id, { hearts: false })
    await setFrozen(e.id, true)
    await createAlbum(e.id, 'Dance')
    await soon(() => expect(l.got.filter((m) => m.type === 'event')).toHaveLength(3))
  })

  test.each([
    ['a new PIN', () => setPin(db, e.id, '4821')],
    ['a new link', () => replaceCode(e.id)],
  ])('%s ends guests’ streams, not the host’s', async (_n, change) => {
    const [g, h] = [listen(ben), listen(host)]
    await change()
    await soon(() => expect(g.isClosed()).toBe(true))
    expect(g.got.at(-1)!.type).toBe('access')
    expect(h.isClosed()).toBe(false)
  })

  test('deleting ends every stream', async () => {
    const [g, h] = [listen(ben), listen(host)]
    await publish(db, { eventId: e.id, type: 'deleted', ids: [], audience: 'everyone' })
    await soon(() => expect([g.isClosed(), h.isClosed()]).toEqual([true, true]))
  })
})

test('losing the database connection ends the streams, so everyone reconnects and catches up', async () => {
  const l = listen(ben)
  await db.execute(sql`select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'event-photos-live' and datname = current_database()`)
  await soon(() => expect(l.isClosed()).toBe(true))
  await getHub().ready()
  const again = listen(ben)
  await publish(db, { eventId: e.id, type: 'event', ids: ['back'], audience: 'everyone' })
  await soon(() => expect(again.ids('event')).toEqual(['back']))
})

describe('the stream', () => {
  const open = async (token: string) => {
    const abort = new AbortController()
    const res = await streamRoute(new Request('http://localhost:3000/x', { headers: { cookie: `qg=${token}` }, signal: abort.signal }), {
      params: Promise.resolve({ code: e.code }),
    })
    return { res, abort }
  }

  test('sends messages and forgets a visitor who leaves', async () => {
    const g = await makeGuest(e.id)
    const { res, abort } = await open(g.token)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toContain('no-transform')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
    expect(getHub().count(e.id)).toBe(1)
    const reader = res.body!.getReader()
    const read = async () => new TextDecoder().decode((await reader.read()).value)
    let text = await read()
    await publish(db, { eventId: e.id, type: 'photos', ids: ['abc'], audience: 'everyone' })
    while (!text.includes('data:')) text += await read()
    expect(text).toContain('data: {"type":"photos","ids":["abc"]}\n\n')
    abort.abort()
    await soon(() => expect(getHub().count(e.id)).toBe(0))
  })

  test('is refused without the PIN', async () => {
    await setPin(db, e.id, '1234')
    const g = await makeGuest(e.id, { pinVersion: 0 })
    expect((await open(g.token)).res.status).toBe(401)
  })

  test('a deleted event has no stream', async () => {
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, e.id))
    const g = await makeGuest(e.id)
    expect((await open(g.token)).res.status).toBe(404)
  })
})
