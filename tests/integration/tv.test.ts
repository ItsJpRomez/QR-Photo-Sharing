import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as session from '@/auth/session'
import { GET } from '@/app/api/tv/[token]/route'
import { GET as streamRoute } from '@/app/api/tv/[token]/stream/route'
import { PUT as tvPinRoute } from '@/app/api/host/events/[id]/tv-pin/route'
import { db } from '@/db/client'
import { events, photos, photoStatus, type EventRow } from '@/db/schema'
import { createAlbum } from '@/modules/events/albums'
import { replaceTvToken, updateSettings } from '@/modules/events/events'
import { setPin } from '@/modules/events/pin'
import { getHub } from '@/modules/live/hub'
import { publish } from '@/modules/live/publish'
import { resetDb } from '../helpers/db'
import { makeEvent, makeGuest, makePhoto, makeUser } from '../helpers/factory'
import { fresh } from '../helpers/upload'

let e: EventRow
let by: string
beforeEach(async () => {
  vi.restoreAllMocks()
  await resetDb()
  e = await makeEvent()
  by = (await makeGuest(e.id, { name: 'Ana' })).id
})
const get = (token: string, q = '') => GET(new Request(`http://localhost:3000/x${q}`), { params: Promise.resolve({ token }) })
const body = async (q = '') => (await get(e.tvToken, q)).json()

test('only live photos, of any status', async () => {
  for (const status of photoStatus.enumValues) await makePhoto(e.id, by, { status })
  const { photos: shown } = await body()
  expect(shown).toHaveLength(1)
  const [live] = await db.select().from(photos).where(eq(photos.status, 'live'))
  expect(shown[0]).toMatchObject({ id: live!.id, uploader: 'Ana' })
  const all = (await db.select().from(photos)).map((p) => p.id)
  const some = await body(`?ids=${all.join(',')}`)
  expect(some.photos.map((p: { id: string }) => p.id)).toEqual([live!.id])
  expect(some.gone).toHaveLength(all.length - 1)
})

test('only the chosen album', async () => {
  const album = await createAlbum(e.id, 'Dance')
  const inside = await makePhoto(e.id, by, { albumId: album.id })
  const outside = await makePhoto(e.id, by)
  await updateSettings(e.id, { tv: { albumId: album.id } })
  expect((await body()).photos.map((p: { id: string }) => p.id)).toEqual([inside.id])
  expect((await body(`?ids=${outside.id}`)).photos).toEqual([])
})

test('if the chosen album is deleted, it shows everything again', async () => {
  const album = await createAlbum(e.id, 'Dance')
  await makePhoto(e.id, by)
  await updateSettings(e.id, { tv: { albumId: album.id } })
  const { deleteAlbum } = await import('@/modules/events/albums')
  await deleteAlbum(e.id, album.id)
  expect((await body()).photos).toHaveLength(1)
})

test('names and QR only when wanted; nothing private ever', async () => {
  const p = await makePhoto(e.id, by)
  expect(await body()).toMatchObject({ name: 'Ana & Marco', seconds: 7, pin: null, qr: expect.stringContaining('<svg') })
  await updateSettings(e.id, { tv: { showNames: false, showQr: false } })
  const after = await body()
  expect(after.photos[0]).toMatchObject({ id: p.id, uploader: null })
  expect(after.qr).toBeNull()
  const text = JSON.stringify(after)
  for (const secret of [e.tvToken, e.ownerId!, by, '/original/']) expect(text).not.toContain(secret)
})

test('no more than 200, newest first', async () => {
  await Promise.all(Array.from({ length: 205 }, (_, i) => makePhoto(e.id, by, { publishedAt: new Date(Date.now() - i * 1000) })))
  const { photos: shown } = await body()
  expect(shown).toHaveLength(200)
})

describe('the link', () => {
  test('wrong, replaced, or of a deleted event: not found', async () => {
    expect((await get('nope')).status).toBe(404)
    await replaceTvToken(e.id)
    expect((await get(e.tvToken)).status).toBe(404)
    e = await fresh(e)
    expect((await get(e.tvToken)).status).toBe(200)
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, e.id))
    expect((await get(e.tvToken)).status).toBe(404)
  })
  test('works without the PIN, which guests need and the TV does not', async () => {
    await setPin(db, e.id, '4821')
    expect((await get(e.tvToken)).status).toBe(200)
  })
  test('replacing it ends the old stream; a new PIN does not', async () => {
    await getHub().ready()
    const res = await streamRoute(new Request('http://localhost:3000/x'), { params: Promise.resolve({ token: e.tvToken }) })
    const reader = res.body!.getReader()
    const texts: string[] = []
    let done = false
    void (async () => {
      for (;;) {
        const r = await reader.read()
        if (r.done) break
        texts.push(new TextDecoder().decode(r.value))
      }
      done = true
    })()
    await setPin(db, e.id, '1111')
    await publish(db, { eventId: e.id, type: 'photos', ids: ['abc'], audience: 'everyone' })
    await publish(db, { eventId: e.id, type: 'photos', ids: ['secret'], audience: 'host' })
    await vi.waitFor(() => expect(texts.join('')).toContain('abc'))
    expect(done).toBe(false)
    await replaceTvToken(e.id)
    await vi.waitFor(() => expect(done).toBe(true))
    expect(texts.join('')).not.toContain('secret')
    await getHub().stop()
  })
})

describe('the PIN on the TV', () => {
  const put = async (b: object, owner = e.ownerId!) => {
    vi.spyOn(session, 'getUser').mockResolvedValue({ id: owner, email: 'x', name: 'x', emailVerified: true })
    return tvPinRoute(new Request('http://localhost:3000/x', { method: 'PUT', body: JSON.stringify(b) }), { params: Promise.resolve({ id: e.id }) })
  }
  beforeEach(async () => {
    await setPin(db, e.id, '4821')
    e = await fresh(e)
  })
  test('needs the right PIN, and is stored encrypted', async () => {
    expect((await put({ show: true, pin: '0000' })).status).toBe(400)
    expect((await put({ show: true })).status).toBe(400)
    expect((await put({ show: true, pin: '4821' })).status).toBe(200)
    const row = await fresh(e)
    expect(row.tvPinEncrypted).toBeTruthy()
    expect(JSON.stringify(row)).not.toContain('4821')
    expect((await body()).pin).toBe('4821')
  })
  test('turning it off, changing the PIN or removing it erases the copy', async () => {
    await put({ show: true, pin: '4821' })
    await put({ show: false })
    expect(await fresh(e)).toMatchObject({ tvPinEncrypted: null })
    expect((await body()).pin).toBeNull()
    await put({ show: true, pin: '4821' })
    await setPin(db, e.id, '9999')
    expect(await fresh(e)).toMatchObject({ tvPinEncrypted: null })
    expect((await body()).pin).toBeNull()
  })
  test('only for the owner', async () => {
    expect((await put({ show: true, pin: '4821' }, (await makeUser()).id)).status).toBe(404)
  })
  test('a damaged copy is simply not shown', async () => {
    await put({ show: true, pin: '4821' })
    await db.update(events).set({ tvPinEncrypted: 'garbage' }).where(eq(events.id, e.id))
    expect((await body()).pin).toBeNull()
  })
})
