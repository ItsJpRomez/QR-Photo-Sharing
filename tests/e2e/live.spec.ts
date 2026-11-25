import { expect, type Page } from '@playwright/test'
import sharp from 'sharp'
import { eventWithGuest, hostApi, newGuest, seedPhotos, test, tiles } from './helpers'

async function addPhoto(guest: Page) {
  const buffer = await sharp({ create: { width: 500, height: 400, channels: 3, background: '#39c' } })
    .withExifMerge({ IFD0: { ImageDescription: crypto.randomUUID() } })
    .jpeg()
    .toBuffer()
  await guest.getByRole('button', { name: 'Add photos' }).click()
  await guest.getByLabel('Choose from library').setInputFiles([{ name: 'new.jpg', mimeType: 'image/jpeg', buffer }])
  await guest.getByRole('button', { name: 'Upload 1 photo' }).click()
  await expect(guest.getByText('1 photo added')).toBeVisible({ timeout: 20_000 })
}

test('another guest sees a new photo within five seconds, without reloading', async ({ page, browser }) => {
  const { event, guest: ana } = await eventWithGuest(page, browser)
  const ben = await newGuest(page, browser)
  await ana.goto(`/e/${event.code}`)
  await ben.goto(`/e/${event.code}`)
  await expect(ben.getByText('Be the first to add a photo')).toBeVisible()
  await addPhoto(ana)
  await expect(tiles(ben)).toHaveCount(1, { timeout: 5000 })
  await expect.poll(() => tiles(ben).first().locator('img').evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
})

test('while scrolled down, new photos wait behind a button and nothing jumps', async ({ page, browser }) => {
  const { event, guest: ana } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 60 })
  const ben = await newGuest(page, browser)
  await ana.goto(`/e/${event.code}`)
  await ben.goto(`/e/${event.code}`)
  await expect(tiles(ben).first()).toBeVisible()
  await ben.evaluate(() => window.scrollTo(0, 1200))
  await ben.waitForTimeout(500)
  const before = await ben.evaluate(() => window.scrollY)
  await addPhoto(ana)
  const button = ben.getByRole('button', { name: '1 new photo' })
  await expect(button).toBeVisible({ timeout: 8000 })
  expect(await ben.evaluate(() => window.scrollY)).toBe(before)
  await button.click()
  await expect.poll(() => ben.evaluate(() => window.scrollY)).toBeLessThan(400)
  await expect(button).toBeHidden()
})

test('with the stream blocked, it still catches up', async ({ page, browser }) => {
  const { event, guest: ana } = await eventWithGuest(page, browser)
  const ben = await newGuest(page, browser)
  await ben.route('**/api/e/*/stream', (r) => r.abort())
  await ana.goto(`/e/${event.code}`)
  await ben.goto(`/e/${event.code}`)
  await addPhoto(ana)
  await expect(tiles(ben)).toHaveCount(1, { timeout: 20_000 })
})

test('closing uploads, new settings and a new PIN take effect on open screens', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 1, hearts: 1 })
  await guest.goto(`/e/${event.code}`)
  await expect(guest.getByRole('link', { name: 'Most hearted' })).toBeVisible()
  await hostApi(page, 'PATCH', `/api/host/events/${event.id}/settings`, { hearts: false })
  await expect(guest.getByRole('link', { name: 'Most hearted' })).toHaveCount(0, { timeout: 5000 })
  await hostApi(page, 'PUT', `/api/host/events/${event.id}/frozen`, { frozen: true })
  await expect(guest.getByText('Uploads are closed')).toBeVisible({ timeout: 5000 })
  await expect(guest.getByRole('button', { name: 'Add photos' })).toHaveCount(0)
  await hostApi(page, 'PUT', `/api/host/events/${event.id}/pin`, { pin: '4821' })
  await expect(guest.getByLabel('PIN')).toBeVisible({ timeout: 5000 })
  await expect(tiles(guest)).toHaveCount(0)
})
