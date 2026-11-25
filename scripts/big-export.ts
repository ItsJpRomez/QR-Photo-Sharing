// Builds a 10 GB archive, then checks that an interrupted download can resume.
// Needs about 12 GB of free disk. Uses its own storage folder and the test database.
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

process.env.DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://localhost/event_photos_e2e'
Object.assign(process.env, { NODE_ENV: 'development', APP_URL: 'http://localhost:3300', APP_SECRET: 'big-export-big-export-big-export-00', STORAGE_DRIVER: 'disk', STORAGE_DIR: '.data/big-export', MAIL_OUTBOX_FILE: '.data/big-export-mail.jsonl' })
if (!process.env.DATABASE_URL.endsWith('event_photos_e2e')) throw new Error('Only runs on the test database')

const GB = 1024 ** 3
const TOTAL = Number(process.env.BIG_GB ?? 10) * GB
const EACH = 40 * 1024 ** 2
const COUNT = Math.ceil(TOTAL / EACH)
const free = fs.statfsSync('.')
if (free.bavail * free.bsize < TOTAL * 1.2 + 2 * GB) throw new Error('Not enough free disk space')

const { db, getPool } = await import('../src/db/client')
const { events, participants, photos, exports } = await import('../src/db/schema')
const { buildExport } = await import('../src/modules/exports/build')
const { keys, storage } = await import('../src/modules/storage')
const { GET } = await import('../src/app/api/storage/[...key]/route')

const dir = '.data/big-export'
fs.rmSync(dir, { recursive: true, force: true })
const [e] = await db.insert(events).values({ code: randomBytes(6).toString('hex'), tvToken: randomBytes(16).toString('hex'), name: 'Big', eventDate: '2026-06-12', timeZone: 'UTC', maxPhotos: 5000, maxBytes: 25 * GB }).returning()
const [p] = await db.insert(participants).values({ eventId: e!.id, tokenHash: randomBytes(8).toString('hex'), name: 'Ana' }).returning()
const ids = Array.from({ length: COUNT }, () => crypto.randomUUID())
await db.insert(photos).values(ids.map((id) => ({ id, eventId: e!.id, participantId: p!.id, clientId: crypto.randomUUID(), status: 'live' as const, sizeBytes: EACH, mime: 'image/jpeg', ext: 'jpg', takenAt: new Date() })))
// One real file, linked many times: 10 GB to read, 40 MB on disk.
const first = path.join(dir, keys.original(e!.id, ids[0]!, 'jpg'))
fs.mkdirSync(path.dirname(first), { recursive: true })
fs.writeFileSync(first, randomBytes(EACH))
for (const id of ids.slice(1)) fs.linkSync(first, path.join(dir, keys.original(e!.id, id, 'jpg')))
const [x] = await db.insert(exports).values({ eventId: e!.id, options: { includeHidden: false, includePending: false }, photoIds: ids }).returning()

const start = Date.now()
let most = 0
const watch = setInterval(() => (most = Math.max(most, process.memoryUsage().rss)), 200)
await buildExport(x!.id)
clearInterval(watch)
const key = keys.export(e!.id, x!.id)
const size = (await storage.head(key))!.size
console.log(`Built ${(size / GB).toFixed(2)} GB from ${COUNT} photos in ${((Date.now() - start) / 1000).toFixed(0)} s, at most ${Math.round(most / 1e6)} MB of memory`)

const url = new URL(await storage.signGet(key))
const ctx = { params: Promise.resolve({ key: key.split('/') }) }
const get = (range?: string) => GET(new Request(url, { headers: range ? { range } : {} }), ctx)
async function hashInto(hash: ReturnType<typeof createHash>, res: Response, stopAfter = Infinity): Promise<number> {
  let n = 0
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    const part = chunk.subarray(0, Math.max(0, stopAfter - n))
    hash.update(part)
    n += part.length
    if (n >= stopAfter) break
  }
  return n
}
const whole = createHash('sha256')
await hashInto(whole, await get())
const resumed = createHash('sha256')
const cut = await hashInto(resumed, await get(), Math.floor(size * 0.4))
const rest = await get(`bytes=${cut}-`)
if (rest.status !== 206) throw new Error(`Expected 206, got ${rest.status}`)
await hashInto(resumed, rest)
const same = whole.digest('hex') === resumed.digest('hex')
console.log(same ? 'PASS: the resumed download is identical' : 'FAIL: the resumed download differs')

const { execFileSync } = await import('node:child_process')
const listed = execFileSync('unzip', ['-Z1', path.join(dir, key)], { maxBuffer: 1e8 }).toString().trim().split('\n').length
console.log(`unzip lists ${listed} files`)
execFileSync('unzip', ['-tqq', path.join(dir, key)])
console.log('unzip checked every file')

await db.delete(events)
fs.rmSync(dir, { recursive: true, force: true })
await getPool().end()
process.exit(same && listed === COUNT ? 0 : 1)
