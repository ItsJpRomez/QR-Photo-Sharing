import { expect, type Page } from '@playwright/test'
import sharp from 'sharp'
import { eventWithGuest, expectAccessible, hostApi, query, test, tiles } from './helpers'

async function picture(n: number, big = false) {
  const size = big ? 1600 : 400
  const noise = sharp({ create: { width: size, height: size, channels: 3, background: { r: (n * 53) % 255, g: 90, b: 150 }, noise: { type: 'gaussian', mean: 120, sigma: big ? 40 : 4 } } })
  return { name: `photo-${n}.jpg`, mimeType: 'image/jpeg', buffer: await noise.jpeg({ quality: 95 }).withExifMerge({ IFD0: { ImageDescription: crypto.randomUUID() } }).toBuffer() }
}
const pictures = (n: number, big = false) => Promise.all(Array.from({ length: n }, (_, i) => picture(i, big)))

async function choose(page: Page, files: Awaited<ReturnType<typeof pictures>>) {
  await page.getByRole('button', { name: 'Add photos' }).click()
  await page.getByLabel('Choose from library').setInputFiles(files)
}
/** Cuts a kind of request off until told otherwise, without removing the rule while requests are in flight. */
async function cutOff(page: Page, url: string) {
  let cut = true
  await page.route(url, (r) => (cut ? r.abort('connectionreset') : r.continue()))
  return () => {
    cut = false
  }
}
const stored = (eventId: string) =>
  query<{ n: number }>(`select count(*)::int n from photos where event_id = $1 and status = 'live'`, [eventId]).then((r) => r[0]!.n)

test('several photos with an album, a hashtag and a name', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser, { albums: ['Dance floor'], tags: ['BrideSquad'] })
  await guest.goto(`/e/${event.code}`)
  await choose(guest, await pictures(5))
  const sheet = guest.getByRole('dialog', { name: 'Add photos' })
  await expect(sheet.getByText('5 photos chosen')).toBeVisible()
  await expect(sheet.getByText(/keep this page open until your photos finish/i)).toBeVisible()
  await expect(sheet.getByText(/location/i)).toBeVisible()
  await expectAccessible(guest)
  await sheet.getByLabel('Album').selectOption('Dance floor')
  await sheet.getByRole('button', { name: '#BrideSquad' }).click()
  await sheet.getByLabel('More hashtags').fill('#Table4 fun')
  await sheet.getByLabel('Your first name').fill('Ana')
  await sheet.getByRole('button', { name: 'Upload 5 photos' }).click()
  await expect(sheet).toBeHidden()
  await expect(guest.getByText('5 photos added')).toBeVisible({ timeout: 30_000 })
  await expect(tiles(guest)).toHaveCount(5)
  await expect(tiles(guest).first()).toHaveAccessibleName('Photo by Ana')
  const rows = await query<{ album: string; tags: string }>(
    `select a.name as album, string_agg(h.norm, ',' order by h.norm) as tags from photos p join albums a on a.id = p.album_id
     join photo_hashtags ph on ph.photo_id = p.id join hashtags h on h.id = ph.hashtag_id where p.event_id = $1 group by p.id, a.name`,
    [event.id],
  )
  expect(rows).toHaveLength(5)
  for (const r of rows) expect(r).toEqual({ album: 'Dance floor', tags: 'bridesquad,fun,table4' })
})

test('the name is remembered for next time', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await guest.goto(`/e/${event.code}`)
  await choose(guest, await pictures(1))
  await guest.getByLabel('Your first name').fill('Ana')
  await guest.getByRole('button', { name: 'Upload 1 photo' }).click()
  await expect(guest.getByText('1 photo added')).toBeVisible({ timeout: 30_000 })
  await guest.reload()
  await choose(guest, await pictures(1))
  await expect(guest.getByLabel('Your first name')).toHaveValue('Ana')
})

test('losing the signal in the middle loses nothing', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await guest.goto(`/e/${event.code}`)
  let dropped = 0
  await guest.route('**/api/storage/**/incoming/**', async (r) => {
    if (dropped++ < 2) await r.abort('connectionreset')
    else await r.continue()
  })
  await choose(guest, await pictures(5))
  await guest.getByRole('button', { name: 'Upload 5 photos' }).click()
  await expect(guest.getByText('No signal, will retry').first()).toBeVisible()
  await guest.context().setOffline(true)
  await guest.waitForTimeout(1500)
  await expect(guest.getByText('5 photos added')).toHaveCount(0)
  await guest.context().setOffline(false)
  await expect(guest.getByText('5 photos added')).toBeVisible({ timeout: 40_000 })
  await expect.poll(() => stored(event.id)).toBe(5)
})

test('closing the page in the middle loses nothing and sends nothing twice', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await guest.goto(`/e/${event.code}`)
  let held = true
  await guest.route('**/api/storage/**/incoming/**', async (r) => {
    if (held) await new Promise((done) => setTimeout(done, 60_000))
    await r.continue().catch(() => {})
  })
  await choose(guest, await pictures(5, true))
  await guest.getByRole('button', { name: 'Upload 5 photos' }).click()
  await expect(guest.getByRole('dialog', { name: 'Add photos' })).toBeHidden() // everything is saved on the phone
  await expect(guest.getByText(/Uploading/).first()).toBeVisible()
  held = false
  await guest.unrouteAll({ behavior: 'ignoreErrors' })
  await guest.reload()
  // One may have finished just before the reload, so count what arrived.
  await expect.poll(() => stored(event.id), { timeout: 40_000 }).toBe(5)
  await expect(guest.getByText(/\d photos? added/)).toBeVisible()
  const [{ n }] = (await query<{ n: number }>(`select count(*)::int n from photos where event_id = $1`, [event.id])) as [{ n: number }]
  expect(n).toBe(5)
})

test('a new PIN in the middle asks for it, then carries on', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await guest.goto(`/e/${event.code}`)
  const reconnect = await cutOff(guest, '**/api/storage/**/incoming/**')
  await choose(guest, await pictures(3))
  await guest.getByRole('button', { name: 'Upload 3 photos' }).click()
  await expect(guest.getByText('No signal, will retry').first()).toBeVisible()
  await hostApi(page, 'PUT', `/api/host/events/${event.id}/pin`, { pin: '4821' })
  reconnect()
  await expect(guest.getByText('3 photos are waiting')).toBeVisible({ timeout: 30_000 })
  await guest.getByLabel('PIN').fill('4821')
  await guest.getByRole('button', { name: 'Open gallery' }).click()
  await expect(guest.getByText('3 photos added')).toBeVisible({ timeout: 40_000 })
})

test('a refusal that comes late does not strand photos on an open event', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await guest.goto(`/e/${event.code}`)
  let refusals = 0
  await guest.route('**/api/e/*/uploads', (r) =>
    refusals++ < 2 ? r.fulfill({ status: 401, json: { error: { code: 'pin_required', message: 'This event needs a PIN.' } } }) : r.continue())
  await choose(guest, await pictures(2))
  await guest.getByRole('button', { name: 'Upload 2 photos' }).click()
  await expect(guest.getByText('2 photos added')).toBeVisible({ timeout: 30_000 })
})

test('a new PIN entered in a second tab also finishes the first one', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await guest.goto(`/e/${event.code}`)
  const reconnect = await cutOff(guest, '**/api/storage/**/incoming/**')
  await choose(guest, await pictures(2))
  await guest.getByRole('button', { name: 'Upload 2 photos' }).click()
  await expect(guest.getByText('No signal, will retry').first()).toBeVisible()
  await hostApi(page, 'PUT', `/api/host/events/${event.id}/pin`, { pin: '4821' })
  reconnect()
  await expect(guest.getByText('2 photos are waiting')).toBeVisible({ timeout: 30_000 })
  const second = await guest.context().newPage()
  await second.goto(`/e/${event.code}`)
  await second.getByLabel('PIN').fill('4821')
  await second.getByRole('button', { name: 'Open gallery' }).click()
  await expect.poll(() => stored(event.id), { timeout: 30_000 }).toBe(2)
})

test('a new link in the middle: the old page says so, the new one carries on', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await guest.goto(`/e/${event.code}`)
  const reconnect = await cutOff(guest, '**/api/storage/**/incoming/**')
  await choose(guest, await pictures(2))
  await guest.getByRole('button', { name: 'Upload 2 photos' }).click()
  await expect(guest.getByText('No signal, will retry').first()).toBeVisible()
  const { code } = await hostApi(page, 'POST', `/api/host/events/${event.id}/code`)
  reconnect()
  await expect(guest.getByText(/open the new link/i)).toBeVisible({ timeout: 30_000 })
  await guest.goto(`/e/${code}`)
  await expect(guest.getByText('2 photos added')).toBeVisible({ timeout: 40_000 })
})

test('a file that is not a photo says why, and can be taken off the list', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await guest.goto(`/e/${event.code}`)
  await choose(guest, [{ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a photo '.repeat(50)) }])
  await guest.getByRole('button', { name: 'Upload 1 photo' }).click()
  await expect(guest.getByText(/isn't a photo we can read/)).toBeVisible({ timeout: 30_000 })
  await guest.getByRole('button', { name: 'Remove notes.jpg' }).click()
  await expect(guest.getByText('notes.jpg')).toHaveCount(0)
})

test('closing uploads keeps the photos on the phone until the host reopens', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await guest.goto(`/e/${event.code}`)
  const reconnect = await cutOff(guest, '**/api/e/*/uploads')
  await choose(guest, await pictures(2))
  await guest.getByRole('button', { name: 'Upload 2 photos' }).click()
  await expect(guest.getByText('No signal, will retry').first()).toBeVisible()
  await hostApi(page, 'PUT', `/api/host/events/${event.id}/frozen`, { frozen: true })
  reconnect()
  await expect(guest.getByText('The host closed uploads').first()).toBeVisible({ timeout: 30_000 })
  await hostApi(page, 'PUT', `/api/host/events/${event.id}/frozen`, { frozen: false })
  await guest.reload()
  await expect(guest.getByText('2 photos added')).toBeVisible({ timeout: 40_000 })
})

test('a photo close to the size limit arrives whole', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await guest.goto(`/e/${event.code}`)
  const small = await picture(1)
  // Extra bytes after the picture, as some phones add: 35 MB in all.
  const buffer = Buffer.concat([small.buffer, Buffer.alloc(35 * 1024 * 1024 - small.buffer.length, 7)])
  await choose(guest, [{ ...small, buffer }])
  await guest.getByRole('button', { name: 'Upload 1 photo' }).click()
  await expect(guest.getByText('1 photo added')).toBeVisible({ timeout: 50_000 })
  await expect.poll(() => stored(event.id), { timeout: 20_000 }).toBe(1)
})

test('two tabs of one guest send each photo once', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await guest.goto(`/e/${event.code}`)
  const second = await guest.context().newPage()
  await second.goto(`/e/${event.code}`)
  await choose(second, await pictures(4))
  await second.getByRole('button', { name: 'Upload 4 photos' }).click()
  await expect(second.getByText('4 photos added')).toBeVisible({ timeout: 40_000 })
  const [{ n }] = (await query<{ n: number }>(`select count(*)::int n from photos where event_id = $1`, [event.id])) as [{ n: number }]
  expect(n).toBe(4)
})
