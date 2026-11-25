import { eq, sql } from 'drizzle-orm'
import exifr from 'exifr'
import sharp from 'sharp'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as storageGet } from '@/app/api/storage/[...key]/route'
import { db } from '@/db/client'
import { events, photos, type EventRow } from '@/db/schema'
import { sha256Hex } from '@/lib/ids'
import * as renderModule from '@/modules/imaging/render'
import { handleDownloadJob } from '@/jobs/handlers'
import { downloadUrl } from '@/modules/photos/downloads'
import { keys, storage } from '@/modules/storage'
import { resetDb } from '../helpers/db'
import { makeEvent, makeGuest } from '../helpers/factory'
import { asGuest, fixture, fresh, upload, type Unlocked } from '../helpers/upload'

let e: EventRow
let ana: Unlocked
let ben: Unlocked
let host: Unlocked
beforeEach(async () => {
  vi.restoreAllMocks()
  await resetDb()
  e = await makeEvent()
  ana = asGuest(e.id, (await makeGuest(e.id, { name: 'Ana / Niño' })).id)
  ben = asGuest(e.id, (await makeGuest(e.id)).id)
  host = { kind: 'host', eventId: e.id, participantId: (await makeGuest(e.id)).id, userId: 'u' }
})

/** Asks, lets the worker make it, and asks again, like the gallery does. */
const getDownload = async (...args: Parameters<typeof downloadUrl>): Promise<string> => {
  const first = await downloadUrl(...args)
  if (first.url !== null) return first.url
  await handleDownloadJob({ photoId: args[2] }, { retryCount: 0, retryLimit: 3 })
  return (await downloadUrl(...args)).url!
}
const queued = async (photoId: string) =>
  (await db.execute(sql`select count(*)::int n from pgboss.job where name = 'photo.download' and data->>'photoId' = ${photoId}`)).rows[0]!.n
const code = (p: Promise<unknown>) => p.then(() => 'ok', (err: { code: string }) => err.code)
const fetchUrl = async (url: string) => {
  const u = new URL(url)
  return storageGet(new Request(u), { params: Promise.resolve({ key: u.pathname.replace('/api/storage/', '').split('/') }) })
}
const bytes = async (url: string) => Buffer.from(await (await fetchUrl(url)).arrayBuffer())

describe('a guest', () => {
  test.each(['rotated-gps.jpg', 'rotated-gps.heic'])('saves %s full size, without location', async (f) => {
    const p = await upload(ana, e, fixture(f))
    const url = await getDownload(ben, e, p.id)
    const buf = await bytes(url)
    expect(await sharp(buf).metadata()).toMatchObject({ format: 'jpeg', width: 3024, height: 4032 })
    expect(await exifr.gps(buf).catch(() => undefined)).toBeUndefined()
    expect(buf.includes('TestCam')).toBe(false)
    const cd = (await fetchUrl(url)).headers.get('content-disposition')!
    expect(cd).toMatch(/^attachment; .*\.jpg/)
  })

  test('is never made while the page waits: the worker makes it, once however many ask', async () => {
    const p = await upload(ana, e, fixture('p3.jpg'))
    const spy = vi.spyOn(renderModule, 'renderDownload')
    const answers = await Promise.all(Array.from({ length: 6 }, () => downloadUrl(ben, e, p.id)))
    expect(answers).toEqual(Array.from({ length: 6 }, () => ({ url: null })))
    expect(spy).not.toHaveBeenCalled()
    expect(await queued(p.id)).toBe(1)
    await handleDownloadJob({ photoId: p.id }, { retryCount: 0, retryLimit: 3 })
    await handleDownloadJob({ photoId: p.id }, { retryCount: 0, retryLimit: 3 })
    expect(spy).toHaveBeenCalledTimes(1)
    expect((await downloadUrl(ana, e, p.id)).url).toContain('/download/')
  })

  test('a photo deleted meanwhile is not brought back as a download', async () => {
    const p = await upload(ana, e, fixture('p3.jpg'))
    await downloadUrl(ben, e, p.id)
    await db.update(photos).set({ status: 'deleted' }).where(eq(photos.id, p.id))
    await handleDownloadJob({ photoId: p.id }, { retryCount: 0, retryLimit: 3 })
    expect(await storage.head(keys.download(e.id, p.id))).toBeNull()
  })

  test('can never get the original', async () => {
    const p = await upload(ana, e, fixture('rotated-gps.jpg'))
    expect(await code(downloadUrl(ana, e, p.id, { original: true }))).toBe('forbidden')
  })

  test('cannot when downloads are off, but the host can', async () => {
    const p = await upload(ana, e, fixture('p3.jpg'))
    await db.update(events).set({ settings: { ...e.settings, guestDownloads: false } }).where(eq(events.id, e.id))
    e = await fresh(e)
    expect(await code(downloadUrl(ben, e, p.id))).toBe('forbidden')
    expect(await code(downloadUrl(host, e, p.id))).toBe('ok')
  })

  test('cannot save what they cannot see', async () => {
    const p = await upload(ana, e, fixture('p3.jpg'))
    await db.update(photos).set({ status: 'hidden' }).where(eq(photos.id, p.id))
    expect(await code(downloadUrl(ben, e, p.id))).toBe('not_found')
    expect(await code(downloadUrl(host, e, p.id))).toBe('ok')
    expect(await code(downloadUrl(ben, e, crypto.randomUUID()))).toBe('not_found')
  })
})

test('the host gets the original, byte for byte', async () => {
  const buf = fixture('rotated-gps.heic')
  const p = await upload(ana, e, buf)
  const { url } = await downloadUrl(host, e, p.id, { original: true })
  expect(sha256Hex(await bytes(url!))).toBe(sha256Hex(buf))
  expect((await fetchUrl(url!)).headers.get('content-disposition')).toContain('.heic')
})
