import { expect, type Page } from '@playwright/test'
import sharp from 'sharp'
import { readQr } from '../helpers/qr'
import { eventWithGuest, hostApi, newGuest, seedPhotos, test } from './helpers'

const shown = (tv: Page) => tv.getByTestId('slide')
const shownId = (tv: Page) => shown(tv).getAttribute('data-photo')
const loaded = (tv: Page) => shown(tv).evaluate((i) => (i as HTMLImageElement).naturalWidth)

async function addPhoto(guest: Page) {
  const buffer = await sharp({ create: { width: 500, height: 400, channels: 3, background: '#3a9' } }).withExifMerge({ IFD0: { ImageDescription: crypto.randomUUID() } }).jpeg().toBuffer()
  await guest.getByRole('button', { name: 'Add photos' }).click()
  await guest.getByLabel('Choose from library').setInputFiles([{ name: 'new.jpg', mimeType: 'image/jpeg', buffer }])
  await guest.getByRole('button', { name: 'Upload 1 photo' }).click()
}

test('with no photos yet it invites the first one', async ({ page, browser }) => {
  const { event, guest: tv } = await eventWithGuest(page, browser)
  await tv.setViewportSize({ width: 1280, height: 720 })
  await tv.goto(event.tvUrl)
  await expect(tv.getByRole('heading', { name: 'Ana & Marco' })).toBeVisible()
  await expect(tv.getByText('Scan to add the first photo')).toBeVisible()
  expect(await readQr(await tv.getByRole('img', { name: 'QR code' }).screenshot())).toBe(event.url)
})

test('a new photo shows within ten seconds and goes within two of being hidden', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 2 })
  const tv = await newGuest(page, browser)
  await tv.setViewportSize({ width: 1280, height: 720 })
  await hostApi(page, 'PATCH', `/api/host/events/${event.id}/settings`, { tv: { seconds: 3 } })
  await tv.goto(event.tvUrl)
  await expect(shown(tv)).toBeVisible()
  const before = new Set([await shownId(tv)])
  await guest.goto(`/e/${event.code}`)
  await addPhoto(guest)
  const list = async () => (await (await tv.request.get(event.tvUrl.replace('/tv/', '/api/tv/'))).json()).photos as { id: string }[]
  await expect.poll(async () => (await list()).length, { timeout: 15_000 }).toBe(3)
  const fresh = (await list())[0]!.id
  expect(before.has(fresh)).toBe(false)
  await expect.poll(() => shownId(tv), { timeout: 10_000 }).toBe(fresh)
  await hostApi(page, 'POST', `/api/host/events/${event.id}/moderate`, { ids: [fresh], op: { kind: 'hide' } })
  await expect.poll(() => shownId(tv), { timeout: 2500 }).not.toBe(fresh)
})

test('names, album and QR follow the settings', async ({ page, browser }) => {
  const { event, guest: tv } = await eventWithGuest(page, browser, { albums: ['Dance floor'], pin: '4821' })
  await seedPhotos(event.id, { count: 1, name: 'Ben', album: 'Dance floor' })
  await tv.setViewportSize({ width: 1280, height: 720 })
  await tv.goto(event.tvUrl)
  await expect(tv.getByText('Ben')).toBeVisible()
  await expect(tv.getByText('Dance floor')).toBeVisible()
  await expect(tv.getByRole('img', { name: 'QR code' })).toBeVisible()
  await expect(tv.getByText('4821')).toHaveCount(0)
  await page.goto(`/host/events/${event.id}/share`)
  await page.getByRole('switch', { name: 'Show names' }).click()
  await page.getByLabel('Event PIN').fill('4821')
  await page.getByRole('button', { name: 'Show PIN on the TV' }).click()
  await expect(tv.getByText('Ben')).toHaveCount(0, { timeout: 6000 })
  await expect(tv.getByText('4821')).toBeVisible({ timeout: 6000 })
  await page.getByRole('switch', { name: 'Show QR code' }).click()
  await expect(tv.getByRole('img', { name: 'QR code' })).toHaveCount(0, { timeout: 6000 })
})

test('without a network it keeps going through the photos it has', async ({ page, browser }) => {
  const { event, guest: tv } = await eventWithGuest(page, browser)
  await hostApi(page, 'PATCH', `/api/host/events/${event.id}/settings`, { tv: { seconds: 3 } })
  await seedPhotos(event.id, { count: 3 })
  await tv.setViewportSize({ width: 1280, height: 720 })
  await tv.goto(event.tvUrl)
  const seen = new Set<string | null>()
  await expect.poll(async () => seen.add(await shownId(tv)).size, { timeout: 15_000, intervals: [500] }).toBe(3)
  await tv.context().setOffline(true)
  seen.clear()
  await expect.poll(async () => seen.add(await shownId(tv)).size, { timeout: 15_000, intervals: [500] }).toBe(3)
  expect(await loaded(tv)).toBeGreaterThan(0)
})

test('left on for hours, it asks for new image links', async ({ page, browser }) => {
  const { event, guest: tv } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 2 })
  await tv.clock.install()
  await tv.setViewportSize({ width: 1280, height: 720 })
  await tv.goto(event.tvUrl)
  await expect.poll(() => loaded(tv)).toBeGreaterThan(0)
  let expired = true
  let asked = 0
  await tv.route('**/api/storage/**', (r) => (expired ? r.fulfill({ status: 403 }) : r.continue()))
  await tv.route(event.tvUrl.replace('/tv/', '/api/tv/') + '*', async (r) => {
    asked++
    expired = false
    await r.continue()
  })
  await tv.clock.fastForward('03:00:00')
  await expect.poll(() => asked, { timeout: 15_000 }).toBeGreaterThan(0)
  for (let i = 0; i < 4; i++) await tv.clock.fastForward(8000)
  await expect.poll(() => loaded(tv), { timeout: 15_000 }).toBeGreaterThan(0)
})

test('a replaced link stops working on the screen itself', async ({ page, browser }) => {
  const { event, guest: tv } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 1 })
  await tv.goto(event.tvUrl)
  await expect(shown(tv)).toBeVisible()
  await hostApi(page, 'POST', `/api/host/events/${event.id}/tv-token`)
  await expect(tv.getByText('This screen link was replaced')).toBeVisible({ timeout: 10_000 })
  await expect(shown(tv)).toHaveCount(0)
})

test('with reduced motion there is no crossfade', async ({ page, browser }) => {
  const { event, guest: tv } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 1 })
  await tv.emulateMedia({ reducedMotion: 'reduce' })
  await tv.goto(event.tvUrl)
  await expect(shown(tv)).toBeVisible()
  expect(await shown(tv).evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))).toBeLessThan(0.05)
})
