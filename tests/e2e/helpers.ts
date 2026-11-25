import fs from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { Pool } from 'pg'
import sharp from 'sharp'

const opened: BrowserContext[] = []

/** Closes every extra browser profile a test opened. */
export const test = base.extend<{ tidy: void }>({
  tidy: [
    async ({}, use) => {
      await use()
      for (const c of opened.splice(0)) await c.close()
    },
    { auto: true },
  ],
})

export async function newGuest(page: Page, browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: page.viewportSize(), baseURL: 'http://localhost:3200' })
  opened.push(context)
  return context.newPage()
}

export const uniqueEmail = () => `host-${crypto.randomUUID().slice(0, 8)}@example.test`
export const PASSWORD = 'correct horse 9'

export async function lastMail(to: string): Promise<{ subject: string; text: string; link: string }> {
  for (let i = 0; i < 50; i++) {
    const mail = fs
      .readFileSync('.data/e2e-mail.jsonl', 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { to: string; subject: string; text: string })
      .findLast((m) => m.to === to)
    if (mail) return { ...mail, link: /https?:\/\/\S+/.exec(mail.text)?.[0] ?? '' }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`No email for ${to}`)
}

export async function signUpHost(page: Page): Promise<string> {
  const email = uniqueEmail()
  await page.goto('/sign-up')
  await page.getByLabel('Your name').fill('Ana Host')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await page.goto((await lastMail(email)).link)
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible()
  return email
}

export type EventOptions = { name?: string; albums?: string[]; tags?: string[]; pin?: string | null; welcome?: string }
export type TestEvent = { id: string; code: string; url: string; tvUrl: string }

/** Creates an event through the API, as the signed-in host on this page. */
export async function createEvent(page: Page, o: EventOptions = {}): Promise<TestEvent> {
  const res = await page.request.post('/api/host/events', {
    headers: { origin: 'http://localhost:3200' },
    data: { name: 'Ana & Marco', eventDate: '2026-06-12', timeZone: 'Asia/Manila', welcome: '', accent: '#4a2370', albums: [], tags: [], pin: null, ...o },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as TestEvent
}

export async function hostApi(page: Page, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data: unknown = {}) {
  const res = await page.request.fetch(path, { method, headers: { origin: 'http://localhost:3200' }, data })
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true)
  return res.json()
}

const pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL ?? 'postgres://localhost/event_photos_e2e' })
export const query = <T extends object>(text: string, values: unknown[] = []) => pool.query<T>(text, values).then((r) => r.rows)

export type Seed = { count: number; name?: string; album?: string; tag?: string; hearts?: number; featured?: boolean; status?: string; by?: string }

/** Puts finished photos straight into an event, files included. Returns their ids, newest first. */
export async function seedPhotos(eventId: string, o: Seed): Promise<string[]> {
  const participant =
    o.by ?? (await query<{ id: string }>(`insert into participants (event_id, token_hash, name) values ($1, $2, $3) returning id`, [eventId, crypto.randomUUID(), o.name ?? 'Ben']))[0]!.id
  const album = o.album
    ? (await query<{ id: string }>(`select id from albums where event_id = $1 and name = $2`, [eventId, o.album]))[0]!.id
    : null
  const dir = `.data/e2e-storage/ev/${eventId}`
  for (const d of ['thumb', 'display', 'original']) fs.mkdirSync(`${dir}/${d}`, { recursive: true })
  const ids: string[] = []
  const base = new Date()
  for (let i = 0; i < o.count; i++) {
    const hue = (i * 47) % 360
    const src = sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="hsl(${hue},55%,55%)"/><circle cx="${80 + ((i * 61) % 480)}" cy="240" r="120" fill="hsl(${(hue + 40) % 360},70%,75%)"/></svg>`))
    const id = crypto.randomUUID()
    fs.writeFileSync(`${dir}/thumb/${id}.webp`, await src.clone().resize(480).webp().toBuffer())
    fs.writeFileSync(`${dir}/display/${id}.webp`, await src.clone().webp().toBuffer())
    fs.writeFileSync(`${dir}/original/${id}.jpg`, await src.clone().jpeg().toBuffer())
    await query(
      `insert into photos (id, event_id, participant_id, album_id, client_id, status, size_bytes, sha256, mime, ext, width, height, uploaded_at, taken_at, published_at, heart_count, featured)
       values ($1,$2,$3,$4,gen_random_uuid(),$5,1000,$6,'image/jpeg','jpg',640,480,$10,$10,$10::timestamptz - ($7 || ' milliseconds')::interval,$8,$9)`,
      [id, eventId, participant, album, o.status ?? 'live', id, (i * 10).toString(), o.hearts ?? 0, o.featured ?? false, base],
    )
    await query(`insert into photo_contributors (photo_id, participant_id) values ($1, $2)`, [id, participant])
    if (o.tag) {
      const [t] = await query<{ id: string }>(
        `insert into hashtags (event_id, norm, display) values ($1, lower($2), $2) on conflict (event_id, norm) do update set display = excluded.display returning id`,
        [eventId, o.tag],
      )
      await query(`insert into photo_hashtags (photo_id, hashtag_id) values ($1, $2)`, [id, t!.id])
    }
    ids.push(id)
  }
  return ids
}

/** A host, their event, and a guest's page in a separate browser profile. */
export async function eventWithGuest(page: Page, browser: Browser, o: EventOptions = {}) {
  await signUpHost(page)
  const event = await createEvent(page, o)
  return { event, guest: await newGuest(page, browser) }
}

export const tiles = (page: Page) => page.getByTestId('tile')

export async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}
