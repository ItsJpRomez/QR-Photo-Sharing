import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PUT as storagePut } from '@/app/api/storage/[...key]/route'
import * as dbModule from '@/db/client'
import { db } from '@/db/client'
import { events, participants, photoContributors, photos, type EventRow } from '@/db/schema'
import { sha256Hex } from '@/lib/ids'
import { handleCoverJob, handleProcessJob } from '@/jobs/handlers'
import { coverState, createCoverUpload, finishCover, queueCover } from '@/modules/events/cover'
import { processPhoto } from '@/modules/photos/process'
import { uploadStates } from '@/modules/photos/uploads'
import { keys, storage } from '@/modules/storage'
import { resetDb } from '../helpers/db'
import { makeEvent, makeGuest, makeUser } from '../helpers/factory'
import { asGuest, fixture, fresh, photoRow, reserve, send, uniqueJpeg, upload, type Unlocked } from '../helpers/upload'

let e: EventRow
let ana: Unlocked
let ben: Unlocked
beforeEach(async () => {
  vi.restoreAllMocks()
  await resetDb()
  e = await makeEvent()
  ana = asGuest(e.id, (await makeGuest(e.id)).id)
  ben = asGuest(e.id, (await makeGuest(e.id)).id)
})

const usage = async () => {
  const { usedPhotos, usedBytes } = await fresh(e)
  return [usedPhotos, usedBytes]
}
const stateOf = async (v: Unlocked, id: string) => (await uploadStates(v, e, [id]))[0]?.state
const live = () => db.select().from(photos).where(and(eq(photos.eventId, e.id), eq(photos.status, 'live')))

describe('processing', () => {
  test.each(['rotated-gps.jpg', 'rotated-gps.heic'])('%s is kept byte for byte, with screen copies', async (file) => {
    const buf = fixture(file)
    const p = await upload(ana, e, buf)
    expect(p).toMatchObject({ status: 'live', width: 3024, height: 4032, sha256: sha256Hex(buf) })
    expect(p.publishedAt).toBeTruthy()
    expect(p.takenAt!.toISOString()).toBe('2026-06-12T10:45:01.000Z')
    expect(sha256Hex(await storage.read(keys.original(e.id, p.id, p.ext!)))).toBe(sha256Hex(buf))
    expect(await storage.head(keys.thumb(e.id, p.id))).toBeTruthy()
    expect(await storage.head(keys.display(e.id, p.id))).toBeTruthy()
    expect(await storage.head(keys.incoming(e.id, p.id))).toBeNull()
  })

  test('the old upload link cannot change a photo afterwards', async () => {
    const buf = await uniqueJpeg()
    const r = await reserve(ana, e, buf)
    const putTo = async (body: Buffer) => {
      const u = new URL(r.put!.url)
      const key = u.pathname.replace('/api/storage/', '').split('/')
      return storagePut(new Request(u, { method: 'PUT', headers: r.put!.headers, body: new Uint8Array(body) }), { params: Promise.resolve({ key }) })
    }
    expect((await putTo(buf)).status).toBe(200)
    const { completeUpload } = await import('@/modules/photos/uploads')
    await completeUpload(ana, e, r.photoId)
    await processPhoto(r.photoId)
    await putTo(Buffer.alloc(buf.length, 7))
    await processPhoto(r.photoId)
    const p = await photoRow(r.photoId)
    expect(sha256Hex(await storage.read(keys.original(e.id, p.id, p.ext!)))).toBe(sha256Hex(buf))
  })

  test('running it again changes nothing', async () => {
    const p = await upload(ana, e, await uniqueJpeg())
    await processPhoto(p.id)
    expect(await photoRow(p.id)).toEqual(p)
    expect(await live()).toHaveLength(1)
  })

  test('a crash after the files are written is picked up where it left off', async () => {
    const id = await send(ana, e, await uniqueJpeg())
    // The files are written, then the database goes away.
    const spy = vi.spyOn(dbModule, 'withTx').mockRejectedValueOnce(new Error('power cut'))
    await expect(processPhoto(id)).rejects.toThrow('power cut')
    expect(spy).toHaveBeenCalled()
    expect(await storage.head(keys.thumb(e.id, id))).toBeTruthy()
    spy.mockRestore()
    expect((await photoRow(id)).status).toBe('processing')
    await processPhoto(id)
    expect((await photoRow(id)).status).toBe('live')
    expect(await live()).toHaveLength(1)
  })

  test('two workers on one photo make one photo', async () => {
    const id = await send(ana, e, await uniqueJpeg())
    await Promise.allSettled([processPhoto(id), processPhoto(id)])
    const p = await photoRow(id)
    expect(p.status).toBe('live')
    expect(await storage.head(keys.original(e.id, id, p.ext!))).toBeTruthy()
    expect(await storage.head(keys.thumb(e.id, id))).toBeTruthy()
  })

  test('a photo deleted while being processed does not come back', async () => {
    const id = await send(ana, e, await uniqueJpeg())
    await db.update(photos).set({ status: 'deleted', deletedBy: 'uploader' }).where(eq(photos.id, id))
    await processPhoto(id)
    expect((await photoRow(id)).status).toBe('deleted')
    expect(await storage.head(keys.thumb(e.id, id))).toBeNull()
  })

  test('a file that is not a photo fails, with its space given back', async () => {
    const p = await upload(ana, e, Buffer.from('<script>alert(1)</script>'.repeat(10)))
    expect(p).toMatchObject({ status: 'failed', failureCode: 'bad_type' })
    expect(await stateOf(ana, p.id)).toBe('failed')
    expect(await usage()).toEqual([0, 0])
    expect(await storage.head(keys.incoming(e.id, p.id))).toBeNull()
  })

  test('trouble on our side is retried, then shown as failed', async () => {
    const id = await send(ana, e, await uniqueJpeg())
    vi.spyOn(storage, 'read').mockRejectedValue(new Error('storage is down'))
    for (let retryCount = 0; retryCount < 3; retryCount++) {
      await expect(handleProcessJob({ photoId: id }, { retryCount, retryLimit: 3 })).rejects.toThrow()
      expect((await photoRow(id)).status).toBe('processing')
    }
    await handleProcessJob({ photoId: id }, { retryCount: 3, retryLimit: 3 })
    expect(await photoRow(id)).toMatchObject({ status: 'failed', failureCode: 'internal' })
    expect(await usage()).toEqual([0, 0])
    expect(await storage.head(keys.incoming(e.id, id))).not.toBeNull() // kept until the reservation would have expired
  })
})

describe('approval', () => {
  test('guests wait, the host does not', async () => {
    const owner = await makeUser()
    e = await makeEvent({ ownerId: owner.id })
    await db.update(events).set({ settings: { ...e.settings, approval: true } }).where(eq(events.id, e.id))
    e = await fresh(e)
    const [h] = await db.insert(participants).values({ eventId: e.id, userId: owner.id, name: 'Host' }).returning()
    const g = asGuest(e.id, (await makeGuest(e.id)).id)
    const waiting = await upload(g, e, await uniqueJpeg())
    expect(waiting).toMatchObject({ status: 'pending', publishedAt: null })
    expect(await stateOf(g, waiting.id)).toBe('pending')
    const mine = await upload({ kind: 'host', eventId: e.id, participantId: h!.id, userId: owner.id }, e, await uniqueJpeg())
    expect(mine.status).toBe('live')
  })
})

describe('the same photo again', () => {
  test('from the same guest', async () => {
    const buf = await uniqueJpeg()
    const first = await upload(ana, e, buf)
    const again = await upload(ana, e, buf)
    expect(again).toMatchObject({ status: 'duplicate', duplicateOf: first.id })
    expect(await stateOf(ana, again.id)).toBe('already_added')
    expect(await usage()).toEqual([1, buf.length])
    expect(await storage.head(keys.thumb(e.id, again.id))).toBeNull()
  })

  test('from another guest, who becomes a contributor', async () => {
    const buf = await uniqueJpeg()
    const first = await upload(ana, e, buf)
    const again = await upload(ben, e, buf)
    expect(await stateOf(ben, again.id)).toBe('received')
    const who = await db.select().from(photoContributors).where(eq(photoContributors.photoId, first.id))
    expect(who.map((c) => c.participantId).sort()).toEqual([ana.participantId, ben.participantId].sort())
    expect((await photoRow(first.id)).participantId).toBe(ana.participantId)
    expect(await usage()).toEqual([1, buf.length])
  })

  test.each(['hidden', 'pending'] as const)('the answer is the same when the first is %s', async (status) => {
    const buf = await uniqueJpeg()
    const first = await upload(ana, e, buf)
    await db.update(photos).set({ status }).where(eq(photos.id, first.id))
    expect(await stateOf(ben, (await upload(ben, e, buf)).id)).toBe('received')
  })

  test('two arriving together make one photo with two contributors', async () => {
    const buf = await uniqueJpeg()
    const ids = [await send(ana, e, buf), await send(ben, e, buf)]
    await Promise.all(ids.map((id) => processPhoto(id)))
    const [winner, ...rest] = await live()
    expect(rest).toHaveLength(0)
    expect(await db.select().from(photoContributors).where(eq(photoContributors.photoId, winner!.id))).toHaveLength(2)
    expect(await usage()).toEqual([1, buf.length])
    expect(sha256Hex(await storage.read(keys.original(e.id, winner!.id, 'jpg')))).toBe(sha256Hex(buf))
  })

  test('removed by the host: refused', async () => {
    const buf = await uniqueJpeg()
    const first = await upload(ana, e, buf)
    await db.update(photos).set({ status: 'deleted', deletedBy: 'host' }).where(eq(photos.id, first.id))
    const again = await upload(ben, e, buf)
    expect(await stateOf(ben, again.id)).toBe('removed_by_host')
    expect(await live()).toHaveLength(0)
  })

  test('deleted by its uploader: welcome back', async () => {
    const buf = await uniqueJpeg()
    const first = await upload(ana, e, buf)
    await db.update(photos).set({ status: 'deleted', deletedBy: 'uploader' }).where(eq(photos.id, first.id))
    expect((await upload(ana, e, buf)).status).toBe('live')
  })

  test('in another event: not a duplicate', async () => {
    const buf = await uniqueJpeg()
    await upload(ana, e, buf)
    const e2 = await makeEvent()
    expect((await upload(asGuest(e2.id, (await makeGuest(e2.id)).id), e2, buf)).status).toBe('live')
  })
})

describe('covers', () => {
  const put = async (buf: Buffer) => {
    const c = await createCoverUpload(e, { size: buf.length, mime: 'image/jpeg' })
    await storage.put(keys.incoming(e.id, c.uploadId), buf, 'image/jpeg')
    return c.uploadId
  }
  test('are checked and resized, and use none of the limits', async () => {
    await finishCover(e, await put(fixture('rotated-gps.heic')))
    e = await fresh(e)
    const { default: sharp } = await import('sharp')
    const cover = await storage.read(e.coverKey!)
    expect(await sharp(cover).metadata()).toMatchObject({ format: 'webp', width: 1536, height: 2048 })
    expect(cover.includes('TestCam')).toBe(false)
    expect(await usage()).toEqual([0, 0])
    expect(await db.select().from(photos)).toHaveLength(0)
  })
  test('a new one replaces the old file', async () => {
    await finishCover(e, await put(fixture('plain.png')))
    const old = (await fresh(e)).coverKey!
    await finishCover(await fresh(e), await put(fixture('tiny.jpg')))
    expect((await fresh(e)).coverKey).not.toBe(old)
    expect(await storage.head(old)).toBeNull()
  })
  test('a bad file is refused and the old cover stays', async () => {
    await finishCover(e, await put(fixture('plain.png')))
    const before = await fresh(e)
    await expect(finishCover(before, await put(Buffer.from('not a photo at all, sorry')))).rejects.toMatchObject({ code: 'bad_type' })
    expect((await fresh(e)).coverKey).toBe(before.coverKey)
  })
  test('are opened by the worker, and the host hears how it went', async () => {
    const uploadId = await put(fixture('p3.jpg'))
    const job = await queueCover(e, uploadId)
    expect(await coverState(e, job)).toEqual({ state: 'working' })
    const other = await makeEvent()
    await expect(coverState(other, job)).rejects.toMatchObject({ code: 'not_found' })
    expect(await handleCoverJob({ eventId: e.id, uploadId })).toEqual({ ok: true })
    expect(await handleCoverJob({ eventId: e.id, uploadId: await put(Buffer.from('not a photo at all, sorry')) })).toEqual({ ok: false, code: 'bad_type' })
    await expect(queueCover(e, 'cover-nope')).rejects.toMatchObject({ code: 'bad_input' })
  })
  test('too large is refused', async () => {
    await expect(createCoverUpload(e, { size: 40 * 1024 ** 2 + 1, mime: 'image/jpeg' })).rejects.toMatchObject({ code: 'too_large' })
  })
})
