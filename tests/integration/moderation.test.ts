import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as session from '@/auth/session'
import { DELETE as deleteRoute } from '@/app/api/e/[code]/photos/[photoId]/route'
import { POST as moderateRoute } from '@/app/api/host/events/[id]/moderate/route'
import { db } from '@/db/client'
import { comments, hearts, photoContributors, type EventRow } from '@/db/schema'
import { handlePurgeJob } from '@/jobs/handlers'
import { createAlbum } from '@/modules/events/albums'
import { setFrozen, updateSettings } from '@/modules/events/events'
import { getHub, type Outgoing } from '@/modules/live/hub'
import { downloadUrl } from '@/modules/photos/downloads'
import { approveAll, deleteOwnPhoto, moderate } from '@/modules/photos/moderation'
import { processPhoto } from '@/modules/photos/process'
import { getPhotos } from '@/modules/photos/query'
import { addComment } from '@/modules/social/comments'
import { setHeart } from '@/modules/social/hearts'
import { keys, storage } from '@/modules/storage'
import { resetDb } from '../helpers/db'
import { makeEvent, makeGuest, makePhoto, makeUser } from '../helpers/factory'
import { asGuest, fixture, fresh, photoRow, send, uniqueJpeg, upload, type Unlocked } from '../helpers/upload'

let e: EventRow
let ana: Unlocked
let ben: Unlocked
let host: Unlocked
beforeEach(async () => {
  vi.restoreAllMocks()
  await resetDb()
  e = await makeEvent()
  ana = asGuest(e.id, (await makeGuest(e.id, { name: 'Ana' })).id)
  ben = asGuest(e.id, (await makeGuest(e.id, { name: 'Ben' })).id)
  host = { kind: 'host', eventId: e.id, participantId: (await makeGuest(e.id)).id, userId: 'u' }
})

const code = (x: Promise<unknown>) => x.then(() => 'ok', (err: { code: string }) => err.code)
const add = async (over: Parameters<typeof makePhoto>[2] = {}, by = ana) => {
  const p = await makePhoto(e.id, by.participantId, over)
  await db.insert(photoContributors).values({ photoId: p.id, participantId: by.participantId })
  return p
}
const status = async (id: string) => (await photoRow(id)).status
const jobs = async (photoId: string) =>
  (await db.execute(sql`select count(*)::int n from pgboss.job where name = 'photo.purge' and data->>'photoId' = ${photoId}`)).rows[0]!.n

describe('bulk changes', () => {
  test('one photo of another event stops everything', async () => {
    const mine = await add()
    const e2 = await makeEvent()
    const theirs = await makePhoto(e2.id, (await makeGuest(e2.id)).id)
    expect(await code(moderate(host, e, [mine.id, theirs.id], { kind: 'hide' }))).toBe('not_found')
    expect(await status(mine.id)).toBe('live')
    expect(await status(theirs.id)).toBe('live')
  })
  test('200 at a time, not 201', async () => {
    const all = await Promise.all(Array.from({ length: 201 }, () => add()))
    expect((await moderate(host, e, all.slice(0, 200).map((p) => p.id), { kind: 'hide' })).changed).toHaveLength(200)
    expect(await code(moderate(host, e, all.map((p) => p.id), { kind: 'hide' }))).toBe('bad_input')
    expect(await code(moderate(host, e, [], { kind: 'hide' }))).toBe('bad_input')
  })
  test('guests cannot', async () => {
    const p = await add()
    for (const kind of ['approve', 'hide', 'unhide', 'delete', 'feature', 'unfeature'] as const)
      expect(await code(moderate(ana, e, [p.id], { kind }))).toBe('forbidden')
    expect(await code(approveAll(ana, e))).toBe('forbidden')
    expect(await status(p.id)).toBe('live')
  })
  test('two hosts’ windows acting on the same photos do not deadlock', async () => {
    const ids = (await Promise.all(Array.from({ length: 20 }, () => add()))).map((p) => p.id)
    const r = await Promise.all([
      code(moderate(host, e, ids, { kind: 'hide' })),
      code(moderate(host, e, ids.toReversed(), { kind: 'feature' })),
      code(moderate(host, e, ids, { kind: 'delete' })),
      code(moderate(host, e, ids.toReversed(), { kind: 'unhide' })),
    ])
    for (const x of r) expect(['ok', 'not_found']).toContain(x)
  })
  test('moving', async () => {
    const p = await add()
    const album = await createAlbum(e.id, 'Dance')
    const foreign = await createAlbum((await makeEvent()).id, 'X')
    await moderate(host, e, [p.id], { kind: 'move', albumId: album.id })
    expect((await photoRow(p.id)).albumId).toBe(album.id)
    expect(await code(moderate(host, e, [p.id], { kind: 'move', albumId: foreign.id }))).toBe('bad_input')
    await moderate(host, e, [p.id], { kind: 'move', albumId: null })
    expect((await photoRow(p.id)).albumId).toBeNull()
  })
  test('featuring', async () => {
    const p = await add()
    await moderate(host, e, [p.id], { kind: 'feature' })
    expect((await photoRow(p.id)).featured).toBe(true)
    await moderate(host, e, [p.id], { kind: 'unfeature' })
    expect((await photoRow(p.id)).featured).toBe(false)
  })
})

describe('approval', () => {
  test('approving publishes now', async () => {
    const p = await add({ status: 'pending', publishedAt: null })
    const live = await add()
    expect((await moderate(host, e, [p.id, live.id], { kind: 'approve' })).changed).toEqual([p.id])
    expect((await photoRow(p.id)).publishedAt!.getTime()).toBeGreaterThan(Date.now() - 5000)
  })
  test('hiding a waiting photo, then showing it, makes it live', async () => {
    const p = await add({ status: 'pending', publishedAt: null })
    await moderate(host, e, [p.id], { kind: 'hide' })
    expect(await status(p.id)).toBe('hidden')
    await moderate(host, e, [p.id], { kind: 'unhide' })
    expect(await photoRow(p.id)).toMatchObject({ status: 'live' })
    expect((await photoRow(p.id)).publishedAt).not.toBeNull()
  })
  test('turning approval off leaves photos waiting until approved', async () => {
    await updateSettings(e.id, { approval: true })
    const p = await upload(ana, await fresh(e), await uniqueJpeg())
    await updateSettings(e.id, { approval: false })
    expect(await status(p.id)).toBe('pending')
    expect(await approveAll(host, await fresh(e))).toEqual({ count: 1 })
    expect(await status(p.id)).toBe('live')
  })
  test('showing a photo again keeps its place in the gallery', async () => {
    const when = new Date(Date.now() - 3600_000)
    const p = await add({ publishedAt: when })
    await moderate(host, e, [p.id], { kind: 'hide' })
    await moderate(host, e, [p.id], { kind: 'unhide' })
    expect((await photoRow(p.id)).publishedAt).toEqual(when)
  })
})

describe('the host deletes', () => {
  test('the photo, its files, hearts and comments all go, and its room comes back', async () => {
    const p = await upload(ana, e, fixture('p3.jpg'))
    await setHeart(ben, e, p.id, true)
    await addComment(ben, e, p.id, { text: 'nice' })
    await downloadUrl(ben, e, p.id)
    expect((await fresh(e)).usedPhotos).toBe(1)
    await moderate(host, e, [p.id], { kind: 'delete' })
    expect(await photoRow(p.id)).toMatchObject({ status: 'deleted', deletedBy: 'host', heartCount: 0 })
    expect(await db.select().from(hearts)).toHaveLength(0)
    expect(await db.select().from(comments)).toHaveLength(0)
    expect(await fresh(e)).toMatchObject({ usedPhotos: 0, usedBytes: 0 })
    expect(await jobs(p.id)).toBe(1)
    await handlePurgeJob({ eventId: e.id, photoId: p.id })
    for (const key of [keys.original(e.id, p.id, 'jpg'), keys.thumb(e.id, p.id), keys.display(e.id, p.id), keys.download(e.id, p.id)])
      expect(await storage.head(key)).toBeNull()
  })
  test('twice does nothing more', async () => {
    const p = await upload(ana, e, await uniqueJpeg())
    const other = await upload(ana, e, await uniqueJpeg())
    await moderate(host, e, [p.id], { kind: 'delete' })
    expect(await code(moderate(host, e, [p.id], { kind: 'delete' }))).toBe('not_found')
    expect((await fresh(e)).usedPhotos).toBe(1)
    expect(await status(other.id)).toBe('live')
  })
  test('a failed photo can be cleared without giving back room twice', async () => {
    await upload(ana, e, await uniqueJpeg())
    const bad = await upload(ana, e, Buffer.from('nope'.repeat(50)))
    await moderate(host, e, [bad.id], { kind: 'delete' })
    expect((await fresh(e)).usedPhotos).toBe(1)
  })
})

describe('a guest deletes their own', () => {
  test('sent by two people: it stays under the other name', async () => {
    const buf = await uniqueJpeg()
    const p = await upload(ana, e, buf)
    await upload(ben, e, buf)
    await deleteOwnPhoto(ana, e, p.id)
    expect(await photoRow(p.id)).toMatchObject({ status: 'live', participantId: ben.participantId })
    expect((await getPhotos(ana, e, [p.id])).items[0]).toMatchObject({ uploader: 'Ben', mine: false, canDelete: false })
    expect((await fresh(e)).usedPhotos).toBe(1)

    await deleteOwnPhoto(ben, e, p.id)
    expect(await photoRow(p.id)).toMatchObject({ status: 'deleted', deletedBy: 'uploader' })
    expect(await fresh(e)).toMatchObject({ usedPhotos: 0, usedBytes: 0 })
    expect(await jobs(p.id)).toBe(1)
  })
  test('the second sender can leave without changing whose it is', async () => {
    const buf = await uniqueJpeg()
    const p = await upload(ana, e, buf)
    await upload(ben, e, buf)
    await deleteOwnPhoto(ben, e, p.id)
    expect(await photoRow(p.id)).toMatchObject({ status: 'live', participantId: ana.participantId })
  })
  test('both at once: it goes exactly once', async () => {
    const buf = await uniqueJpeg()
    const p = await upload(ana, e, buf)
    await upload(ben, e, buf)
    await Promise.all([deleteOwnPhoto(ana, e, p.id), deleteOwnPhoto(ben, e, p.id)])
    expect(await status(p.id)).toBe('deleted')
    expect((await fresh(e)).usedPhotos).toBe(0)
    expect(await jobs(p.id)).toBe(1)
  })
  test('at the very moment someone else sends the same one: theirs is never lost', async () => {
    for (let i = 0; i < 12; i++) {
      const buf = await uniqueJpeg()
      const first = await upload(ana, e, buf)
      const second = await send(ben, e, buf)
      await Promise.all([processPhoto(second), new Promise((r) => setTimeout(r, i * 4)).then(() => deleteOwnPhoto(ana, e, first.id))])
      const mine = (await getPhotos(ben, e, [first.id, second])).items.filter((p) => p.mine && p.status === 'live')
      expect(mine).toHaveLength(1)
    }
  })
  test('not someone else’s', async () => {
    const p = await add()
    expect(await code(deleteOwnPhoto(ben, e, p.id))).toBe('forbidden')
    const hidden = await add({ status: 'hidden' })
    expect(await code(deleteOwnPhoto(ben, e, hidden.id))).toBe('not_found')
    expect(await code(deleteOwnPhoto(ben, e, crypto.randomUUID()))).toBe('not_found')
  })
  test('also when the event is closed', async () => {
    const p = await add()
    await setFrozen(e.id, true)
    expect(await code(deleteOwnPhoto(ana, await fresh(e), p.id))).toBe('ok')
  })
  test('while it is still being processed, and it stays gone', async () => {
    const id = await send(ana, e, await uniqueJpeg())
    await deleteOwnPhoto(ana, e, id)
    await processPhoto(id)
    expect(await status(id)).toBe('deleted')
    expect((await fresh(e)).usedPhotos).toBe(0)
  })
})

describe('what others hear about it', () => {
  test('hiding a waiting photo tells only its sender and the host', async () => {
    await getHub().ready()
    const p = await add({ status: 'pending', publishedAt: null })
    const heard = { ana: [] as Outgoing[], ben: [] as Outgoing[], host: [] as Outgoing[] }
    const off = (Object.entries({ ana, ben, host }) as [keyof typeof heard, Unlocked][]).map(([k, v]) =>
      getHub().subscribe(e.id, v, { send: (m) => heard[k].push(m), close: () => {} }))
    await moderate(host, e, [p.id], { kind: 'hide' })
    await vi.waitFor(() => expect(heard.ana.flatMap((m) => m.ids)).toContain(p.id))
    expect(heard.host.flatMap((m) => m.ids)).toContain(p.id)
    await new Promise((r) => setTimeout(r, 100))
    expect(JSON.stringify(heard.ben)).not.toContain(p.id)
    off.forEach((f) => f())
    await getHub().stop()
  })
})

describe('routes', () => {
  test('moderating needs the owner', async () => {
    const owner = await makeUser()
    const mine = await makeEvent({ ownerId: owner.id })
    const p = await makePhoto(mine.id, (await makeGuest(mine.id)).id)
    const call = (b: unknown) => moderateRoute(new Request('http://localhost:3000/x', { method: 'POST', body: JSON.stringify(b) }), { params: Promise.resolve({ id: mine.id }) })
    vi.spyOn(session, 'getUser').mockResolvedValue({ ...(await makeUser()), emailVerified: true })
    expect((await call({ ids: [p.id], op: { kind: 'delete' } })).status).toBe(404)
    vi.spyOn(session, 'getUser').mockResolvedValue({ ...owner, emailVerified: true })
    expect((await call({ ids: [p.id], op: { kind: 'explode' } })).status).toBe(400)
    expect(await (await call({ ids: [p.id], op: { kind: 'hide' } })).json()).toEqual({ changed: [p.id] })
  })
  test('DELETE removes a guest’s own photo', async () => {
    const g = await makeGuest(e.id)
    const p = await add({}, asGuest(e.id, g.id))
    const res = await deleteRoute(new Request('http://localhost:3000/x', { method: 'DELETE', headers: { cookie: `qg=${g.token}` } }), { params: Promise.resolve({ code: e.code, photoId: p.id }) })
    expect(res.status).toBe(200)
    expect(await status(p.id)).toBe('deleted')
    expect(await db.select().from(photoContributors).where(eq(photoContributors.photoId, p.id))).toHaveLength(0)
  })
})
