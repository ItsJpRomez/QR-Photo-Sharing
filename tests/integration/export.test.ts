import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import yauzl from 'yauzl'
import * as session from '@/auth/session'
import { GET as downloadRoute } from '@/app/api/host/events/[id]/exports/[exportId]/download/route'
import { GET as listRoute, POST as startRoute } from '@/app/api/host/events/[id]/exports/route'
import { GET as storageGet } from '@/app/api/storage/[...key]/route'
import { db } from '@/db/client'
import { user } from '@/db/auth-schema'
import { events, exports, photos, type EventRow } from '@/db/schema'
import { handleExportJob } from '@/jobs/handlers'
import { sha256Hex } from '@/lib/ids'
import { testOutbox } from '@/lib/mail'
import { createAlbum } from '@/modules/events/albums'
import { buildExport, expireExports, exportDownloadUrl, startExport } from '@/modules/exports/build'
import { deleteOwnPhoto } from '@/modules/photos/moderation'
import { keys, storage } from '@/modules/storage'
import { resetDb } from '../helpers/db'
import { makeEvent, makeGuest, makeUser } from '../helpers/factory'
import { asGuest, fixture, uniqueJpeg, upload, type Unlocked } from '../helpers/upload'

let e: EventRow
let ana: Unlocked
let host: Unlocked
beforeEach(async () => {
  vi.restoreAllMocks()
  testOutbox.length = 0
  await resetDb()
  e = await makeEvent()
  ana = asGuest(e.id, (await makeGuest(e.id, { name: 'Ana' })).id)
  host = { kind: 'host', eventId: e.id, participantId: (await makeGuest(e.id)).id, userId: e.ownerId! }
})

const all = { includeHidden: false, includePending: false }
const code = (x: Promise<unknown>) => x.then(() => 'ok', (err: { code: string }) => err.code)
const row = async (id: string) => (await db.select().from(exports).where(eq(exports.id, id)))[0]!

async function unzip(buf: Buffer): Promise<Map<string, { sha: string; text: string; method: number }>> {
  const zip = await new Promise<yauzl.ZipFile>((ok, no) => yauzl.fromBuffer(buf, { lazyEntries: true }, (err, z) => (err ? no(err) : ok(z))))
  const found = new Map<string, { sha: string; text: string; method: number }>()
  return new Promise((ok, no) => {
    zip.on('error', no)
    zip.on('end', () => ok(found))
    zip.on('entry', (entry: yauzl.Entry) => {
      zip.openReadStream(entry, async (err, stream) => {
        if (err) return no(err)
        const chunks: Buffer[] = []
        for await (const c of stream) chunks.push(c as Buffer)
        const body = Buffer.concat(chunks)
        found.set(entry.fileName, { sha: createHash('sha256').update(body).digest('hex'), text: body.toString('utf8'), method: entry.compressionMethod })
        zip.readEntry()
      })
    })
    zip.readEntry()
  })
}
async function exported(options = all) {
  const x = await startExport(host, e, options)
  await buildExport(x.id)
  return { x: await row(x.id), files: await unzip(await storage.read(keys.export(e.id, x.id))) }
}

describe('the archive', () => {
  test('holds every original, byte for byte, filed by album', async () => {
    const album = await createAlbum(e.id, 'Dance Floor')
    const [a, b, c] = [fixture('rotated-gps.jpg'), fixture('rotated-gps.heic'), await uniqueJpeg()]
    await upload(ana, e, a, { albumId: album.id })
    await upload(ana, e, b)
    await upload(ana, e, c, { albumId: album.id })
    const { x, files } = await exported()
    expect(x).toMatchObject({ status: 'ready', done: 3, failed: 0 })
    expect(new Set([...files.values()].map((f) => f.sha))).toEqual(new Set([a, b, c].map((buf) => sha256Hex(buf))))
    expect([...files.keys()].filter((n) => n.startsWith('Dance Floor/'))).toHaveLength(2)
    expect([...files.keys()].find((n) => n.startsWith('No album/'))).toMatch(/^No album\/2026-06-12_184501_Ana_\d{4}\.heic$/)
    for (const f of files.values()) expect(f.method).toBe(0) // stored, not compressed again
    expect(x.sizeBytes).toBe((await storage.head(keys.export(e.id, x.id)))!.size)
  })

  test('hidden and waiting photos only when asked', async () => {
    await upload(ana, e, await uniqueJpeg())
    const [hidden, pending] = [await upload(ana, e, await uniqueJpeg()), await upload(ana, e, await uniqueJpeg())]
    await db.update(photos).set({ status: 'hidden' }).where(eq(photos.id, hidden.id))
    await db.update(photos).set({ status: 'pending' }).where(eq(photos.id, pending.id))
    expect((await exported()).files.size).toBe(1)
    expect((await exported({ includeHidden: true, includePending: false })).files.size).toBe(2)
    expect((await exported({ includeHidden: true, includePending: true })).files.size).toBe(3)
  })

  test('is what existed when asked: later photos are left out, deleted ones too', async () => {
    const keep = await upload(ana, e, await uniqueJpeg())
    const gone = await upload(ana, e, await uniqueJpeg())
    const x = await startExport(host, e, all)
    await upload(ana, e, await uniqueJpeg())
    await deleteOwnPhoto(ana, e, gone.id)
    await buildExport(x.id)
    const files = await unzip(await storage.read(keys.export(e.id, x.id)))
    expect([...files.values()].map((f) => f.sha)).toEqual([keep.sha256])
    expect(await row(x.id)).toMatchObject({ status: 'ready', failed: 0 })
  })

  test('a missing original is listed and the rest still comes', async () => {
    await upload(ana, e, await uniqueJpeg())
    const lost = await upload(ana, e, await uniqueJpeg())
    await storage.delete([keys.original(e.id, lost.id, 'jpg')])
    const { x, files } = await exported()
    expect(x).toMatchObject({ status: 'ready', done: 1, failed: 1 })
    expect(files.get('_errors.txt')!.text).toContain('Ana')
    expect(files.size).toBe(2)
  })
})

describe('starting', () => {
  test('nothing to download is refused', async () => {
    const e2 = await makeEvent()
    const h2: Unlocked = { ...host, kind: 'host', eventId: e2.id, userId: 'u' } as Unlocked
    await expect(startExport(h2, e2, all)).rejects.toMatchObject({ code: 'bad_input', message: 'There are no photos to download yet.' })
    expect(await db.select().from(exports)).toHaveLength(0)
  })
  test('asking again while one runs gives the same one, even at the same moment', async () => {
    await upload(ana, e, await uniqueJpeg())
    const many = await Promise.all(Array.from({ length: 6 }, () => startExport(host, e, all)))
    expect(new Set(many.map((m) => m.id)).size).toBe(1)
    const n = (await db.execute(sql`select count(*)::int n from pgboss.job where name = 'export.build' and data->>'exportId' = ${many[0]!.id}`)).rows[0]!.n
    expect(n).toBe(1)
    await buildExport(many[0]!.id)
    expect((await startExport(host, e, all)).id).not.toBe(many[0]!.id)
  })
  test('guests cannot', async () => {
    await upload(ana, e, await uniqueJpeg())
    expect(await code(startExport(ana, e, all))).toBe('forbidden')
  })
})

describe('trouble', () => {
  test('a job that died half way is done again from the start', async () => {
    for (let i = 0; i < 3; i++) await upload(ana, e, await uniqueJpeg())
    const x = await startExport(host, e, all)
    const real = storage.readStream
    let n = 0
    vi.spyOn(storage, 'readStream').mockImplementation(async (k) => {
      if (++n === 2) throw new Error('network went away')
      return real(k)
    })
    await expect(buildExport(x.id)).rejects.toThrow()
    expect((await row(x.id)).status).toBe('running')
    await buildExport(x.id)
    expect(await row(x.id)).toMatchObject({ status: 'ready', done: 3 })
    expect((await unzip(await storage.read(keys.export(e.id, x.id)))).size).toBe(3)
  })
  test('after the last try it says it failed, and another can start', async () => {
    await upload(ana, e, await uniqueJpeg())
    const x = await startExport(host, e, all)
    vi.spyOn(storage, 'put').mockRejectedValue(new Error('storage is down'))
    await expect(handleExportJob({ exportId: x.id }, { retryCount: 0, retryLimit: 3 })).rejects.toThrow()
    await handleExportJob({ exportId: x.id }, { retryCount: 3, retryLimit: 3 })
    expect((await row(x.id)).status).toBe('failed')
    expect((await startExport(host, e, all)).id).not.toBe(x.id)
  })
  test('an event deleted meanwhile leaves no archive behind', async () => {
    await upload(ana, e, await uniqueJpeg())
    const x = await startExport(host, e, all)
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, e.id))
    await buildExport(x.id)
    expect((await row(x.id)).status).toBe('failed')
    expect(await storage.head(keys.export(e.id, x.id))).toBeNull()
  })
  test('building a finished one again changes nothing', async () => {
    await upload(ana, e, await uniqueJpeg())
    const { x } = await exported()
    await buildExport(x.id)
    expect(await row(x.id)).toEqual(x)
    expect(testOutbox).toHaveLength(1)
  })
})

describe('the download', () => {
  test('one email, then a link that can resume', async () => {
    await upload(ana, e, fixture('rotated-gps.jpg'))
    const { x } = await exported()
    const [owner] = await db.select().from(user).where(eq(user.id, e.ownerId!))
    expect(testOutbox).toMatchObject([{ to: owner!.email }])
    expect(testOutbox[0]!.text).toContain(`/host/events/${e.id}/export`)
    const url = new URL(await exportDownloadUrl(host, e, x.id))
    const fetchPart = (range?: string) =>
      storageGet(new Request(url, { headers: range ? { range } : {} }), { params: Promise.resolve({ key: url.pathname.replace('/api/storage/', '').split('/') }) })
    const whole = Buffer.from(await (await fetchPart()).arrayBuffer())
    const cut = Math.floor(whole.length * 0.4)
    const rest = await fetchPart(`bytes=${cut}-`)
    expect(rest.status).toBe(206)
    const joined = Buffer.concat([whole.subarray(0, cut), Buffer.from(await rest.arrayBuffer())])
    expect(sha256Hex(joined)).toBe(sha256Hex(whole))
    expect((await fetchPart()).headers.get('content-disposition')).toContain('Ana & Marco photos.zip')
  })
  test('the link still works after most of a day, for slow connections', async () => {
    await upload(ana, e, await uniqueJpeg())
    const { x } = await exported()
    const url = new URL(await exportDownloadUrl(host, e, x.id))
    const left = Number(url.searchParams.get('exp')) - Date.now() / 1000
    expect(left).toBeGreaterThan(22 * 3600)
    expect(left).toBeLessThanOrEqual(24 * 3600)
  })
  test('for seven days, then the file is gone', async () => {
    await upload(ana, e, await uniqueJpeg())
    const { x } = await exported()
    const days = (x.expiresAt!.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.99)
    expect(days).toBeLessThanOrEqual(7)
    await expireExports(new Date(Date.now() + 6.9 * 86_400_000))
    expect(await code(exportDownloadUrl(host, e, x.id))).toBe('ok')
    await expireExports(new Date(Date.now() + 7.1 * 86_400_000))
    expect(await code(exportDownloadUrl(host, e, x.id))).toBe('not_found')
    expect(await storage.head(keys.export(e.id, x.id))).toBeNull()
    expect((await row(x.id)).status).toBe('expired')
  })
  test('not before it is ready, not for guests, not across events', async () => {
    await upload(ana, e, await uniqueJpeg())
    const x = await startExport(host, e, all)
    expect(await code(exportDownloadUrl(host, e, x.id))).toBe('not_found')
    await buildExport(x.id)
    expect(await code(exportDownloadUrl(ana, e, x.id))).toBe('forbidden')
    const e2 = await makeEvent()
    expect(await code(exportDownloadUrl({ kind: 'host', eventId: e2.id, participantId: 'p', userId: 'u' }, e2, x.id))).toBe('not_found')
  })
})

test('the routes belong to the owner', async () => {
  const p = await upload(ana, e, await uniqueJpeg())
  const ctx = { params: Promise.resolve({ id: e.id }) }
  const start = () => startRoute(new Request('http://localhost:3000/x', { method: 'POST', body: JSON.stringify(all) }), ctx)
  vi.spyOn(session, 'getUser').mockResolvedValue({ ...(await makeUser()), emailVerified: true })
  expect((await start()).status).toBe(404)
  expect((await listRoute(new Request('http://localhost:3000/x'), ctx)).status).toBe(404)
  vi.spyOn(session, 'getUser').mockResolvedValue({ id: e.ownerId!, email: 'x', name: 'x', emailVerified: true })
  const made = (await (await start()).json()) as { id: string }
  await buildExport(made.id)
  const { exports: list } = (await (await listRoute(new Request('http://localhost:3000/x'), ctx)).json()) as { exports: object[] }
  expect(list).toMatchObject([{ id: made.id, status: 'ready', total: 1, done: 1 }])
  expect(JSON.stringify(list)).not.toContain(p.id)
  const dl = await downloadRoute(new Request('http://localhost:3000/x'), { params: Promise.resolve({ id: e.id, exportId: made.id }) })
  expect(((await dl.json()) as { url: string }).url).toContain('/export/')
})
