// Load test: many guests watching while photos come in.
//   E2E_PORT=3300 E2E_APP_URL=http://localhost:3300 scripts/e2e-server.sh   (in another terminal)
//   npx tsx scripts/load.ts
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import sharp from 'sharp'
import { Agent, setGlobalDispatcher } from 'undici'

const BASE = process.env.LOAD_URL ?? 'http://localhost:3300'
const WATCHERS = Number(process.env.LOAD_WATCHERS ?? 200)
const PER_HOUR = Number(process.env.LOAD_UPLOADS_PER_HOUR ?? 500)
const MINUTES = Number(process.env.LOAD_MINUTES ?? 10)
const TARGET_MS = 5000

setGlobalDispatcher(new Agent({ connections: 1000, bodyTimeout: 0, headersTimeout: 60_000 }))
const pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL ?? 'postgres://localhost/event_photos_e2e' })
const token = () => randomBytes(32).toString('base64url')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const code = randomBytes(9).toString('base64url').replace(/[-_0OIl]/g, 'x').slice(0, 12)
await pool.query(
  `insert into events (code, tv_token, name, event_date, time_zone, max_photos, max_bytes) values ($1, $2, 'Load test', '2026-06-12', 'UTC', 100000, 1000000000000)`,
  [code, token()],
)
const api = `${BASE}/api/e/${code}`
const headers = (t: string) => ({ cookie: `qg=${t}`, origin: new URL(BASE).origin })

/** When each photo's upload was confirmed, and when each watcher could show it. */
const confirmed = new Map<string, number>()
const early = new Map<string, number[]>()
const delays: number[] = []
const failures = new Map<string, number>()
const seen = (id: string, at: number) => {
  const done = confirmed.get(id)
  if (done !== undefined) delays.push(at - done)
  else early.set(id, [...(early.get(id) ?? []), at])
}

async function watch(): Promise<void> {
  const t = token()
  const res = await fetch(`${api}/stream`, { headers: headers(t) })
  if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
  const wanted = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  // As the gallery does: gather for a second, then fetch together.
  const flush = async () => {
    timer = undefined
    const ids = [...wanted]
    wanted.clear()
    let why = ''
    const r = await fetch(`${api}/photos?ids=${ids.join(',')}`, { headers: headers(t) }).catch((err: Error & { cause?: { code?: string } }) => {
      why = err.cause?.code ?? err.message
      return null
    })
    if (!r?.ok) {
      why ||= `status ${r?.status}`
      failures.set(why, (failures.get(why) ?? 0) + 1)
      // The gallery keeps the ids and asks again, so this does too. The delay counts.
      for (const id of ids) wanted.add(id)
      timer ??= setTimeout(flush, 1000)
      return
    }
    const { items } = (await r.json()) as { items: { id: string; thumbUrl: string | null }[] }
    const now = performance.now()
    for (const p of items) if (p.thumbUrl) seen(p.id, now)
  }
  void (async () => {
    let text = ''
    const decoder = new TextDecoder()
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      text += decoder.decode(chunk, { stream: true })
      const parts = text.split('\n\n')
      text = parts.pop()!
      for (const part of parts) {
        if (!part.startsWith('data: ')) continue
        const m = JSON.parse(part.slice(6)) as { type: string; ids: string[] }
        if (m.type !== 'photos') continue
        for (const id of m.ids) wanted.add(id)
        timer ??= setTimeout(flush, 1000)
      }
    }
  })().catch(() => {})
}

const picture = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: '#456', noise: { type: 'gaussian', mean: 120, sigma: 12 } } })
  .jpeg({ quality: 80 })
  .toBuffer()

async function uploadOne(t: string): Promise<void> {
  const body = Buffer.concat([picture, randomBytes(16)]) // unique, and still the same picture
  const post = (path: string, data: object) =>
    fetch(`${api}${path}`, { method: 'POST', headers: { ...headers(t), 'content-type': 'application/json' }, body: JSON.stringify(data) })
  const reserved = await post('/uploads', { clientId: crypto.randomUUID(), size: body.length, mime: 'image/jpeg', tags: ['load'] })
  if (!reserved.ok) throw new Error(`reserve ${reserved.status} ${await reserved.text()}`)
  const { photoId, put } = (await reserved.json()) as { photoId: string; put: { url: string; headers: Record<string, string> } }
  const sent = await fetch(put.url, { method: 'PUT', headers: { ...put.headers, origin: new URL(BASE).origin }, body })
  if (!sent.ok) throw new Error(`put ${sent.status}`)
  const done = await post(`/uploads/${photoId}/complete`, {})
  if (!done.ok) throw new Error(`complete ${done.status}`)
  const now = performance.now()
  confirmed.set(photoId, now)
  for (const at of early.get(photoId) ?? []) delays.push(at - now)
}

function memory(): Record<string, number> {
  const rows = execFileSync('ps', ['-axo', 'rss=,command=']).toString().split('\n')
  const mb = (match: RegExp) => Math.round(rows.filter((r) => match.test(r)).reduce((sum, r) => sum + parseInt(r, 10), 0) / 1024)
  return { web: mb(/next-server/), worker: mb(/src\/jobs\/worker\.ts/) }
}

console.log(`${WATCHERS} watchers, ${PER_HOUR} uploads an hour, ${MINUTES} minutes, ${(picture.length / 1e6).toFixed(1)} MB each`)
for (let i = 0; i < WATCHERS; i += 20) await Promise.all(Array.from({ length: Math.min(20, WATCHERS - i) }, watch))
console.log('All watchers connected', memory())

const every = 3_600_000 / PER_HOUR
const count = Math.round((MINUTES * 60_000) / every)
const guests = Array.from({ length: 40 }, token)
const running: Promise<void>[] = []
const errors: string[] = []
const samples: Record<string, number>[] = []
for (let i = 0; i < count; i++) {
  running.push(uploadOne(guests[i % guests.length]!).catch((err: Error) => void errors.push(err.message)))
  if (i % 10 === 0) samples.push(memory())
  await sleep(every)
}
await Promise.all(running)
await sleep(15_000)
samples.push(memory())

delays.sort((a, b) => a - b)
const at = (p: number) => Math.round(delays[Math.min(delays.length - 1, Math.floor(delays.length * p))] ?? NaN)
const expected = confirmed.size * WATCHERS
console.log(JSON.stringify({ uploads: confirmed.size, errors, expected, seen: delays.length, failedFetches: Object.fromEntries(failures), ms: { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) }, memory: samples }, null, 1))
const pass = errors.length === 0 && delays.length === expected && at(0.95) < TARGET_MS
console.log(pass ? 'PASS' : 'FAIL')
await pool.end()
process.exit(pass ? 0 : 1)
