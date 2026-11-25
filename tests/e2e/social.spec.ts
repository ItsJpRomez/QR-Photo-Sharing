import { expect } from '@playwright/test'
import { eventWithGuest, expectAccessible, hostApi, newGuest, seedPhotos, test, tiles } from './helpers'

test('hearts count, stay after reload, and show to others', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 1 })
  const other = await newGuest(page, browser)
  await other.goto(`/e/${event.code}`)
  await tiles(other).first().click()
  await guest.goto(`/e/${event.code}`)
  await tiles(guest).first().click()
  const heart = guest.getByRole('button', { name: /^Heart/ })
  await heart.click()
  await expect(heart).toHaveAttribute('aria-pressed', 'true')
  await expect(heart).toHaveText(/1/)
  await expect(other.getByRole('button', { name: /^Heart/ })).toHaveText(/1/, { timeout: 8000 })
  await guest.reload()
  await expect(heart).toHaveAttribute('aria-pressed', 'true')
  await heart.click()
  await expect(heart).toHaveAttribute('aria-pressed', 'false')
})

test('a heart that fails is taken back on screen', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 1 })
  await guest.goto(`/e/${event.code}`)
  await tiles(guest).first().click()
  await guest.route('**/heart', (r) => r.abort())
  const heart = guest.getByRole('button', { name: /^Heart/ })
  await heart.click()
  await expect(heart).toHaveAttribute('aria-pressed', 'false')
  await expect(guest.getByRole('alert').filter({ hasText: /offline/ })).toBeVisible()
})

test('comments appear live, and only mine can be deleted', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 1 })
  const other = await newGuest(page, browser)
  for (const g of [guest, other]) {
    await g.goto(`/e/${event.code}`)
    await tiles(g).first().click()
    await g.getByRole('button', { name: /^Comments/ }).click()
  }
  await guest.getByLabel('Add a comment').fill('What a night!')
  await guest.getByLabel('Your first name').fill('Ana')
  await guest.getByRole('button', { name: 'Post comment' }).click()
  await expect(guest.getByText('What a night!')).toBeVisible()
  await expect(other.getByText('What a night!')).toBeVisible({ timeout: 8000 })
  await expectAccessible(guest)
  await expect(other.getByRole('button', { name: 'Delete comment' })).toHaveCount(0)
  await guest.getByRole('button', { name: 'Delete comment' }).click()
  await expect(guest.getByText('What a night!')).toHaveCount(0)
  await expect(other.getByText('What a night!')).toHaveCount(0, { timeout: 8000 })
})

test('unusual names and comments are shown as plain text', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 1, name: '<script>alert(1)</script>' })
  let alerted = false
  guest.on('dialog', (d) => {
    alerted = true
    void d.dismiss()
  })
  await guest.goto(`/e/${event.code}`)
  await tiles(guest).first().click()
  await expect(guest.getByText('<script>alert(1)</script>')).toBeVisible()
  await guest.getByRole('button', { name: /^Comments/ }).click()
  for (const [name, text] of [
    ['שלום 🎉', '<img src=x onerror=alert(2)>'],
    ['🎉'.repeat(40), 'x'.repeat(500)],
  ] as const) {
    await guest.getByLabel('Your first name').fill(name)
    await guest.getByLabel('Add a comment').fill(text)
    await guest.getByRole('button', { name: 'Post comment' }).click()
    await expect(guest.getByText(text, { exact: true })).toBeVisible()
  }
  expect(await guest.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  expect(await guest.getByRole('dialog').evaluate((d) => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0)
  expect(alerted).toBe(false)
})

test('turned off, they disappear from an open photo', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 1 })
  await guest.goto(`/e/${event.code}`)
  await tiles(guest).first().click()
  await expect(guest.getByRole('button', { name: /^Heart/ })).toBeVisible()
  await hostApi(page, 'PATCH', `/api/host/events/${event.id}/settings`, { hearts: false, comments: false })
  await expect(guest.getByRole('button', { name: /^Heart/ })).toHaveCount(0, { timeout: 6000 })
  await expect(guest.getByRole('button', { name: /^Comments/ })).toHaveCount(0)
})

test('a comment typed while the last one is being sent is not wiped', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 1 })
  await guest.goto(`/e/${event.code}`)
  await tiles(guest).first().click()
  await guest.getByRole('button', { name: /^Comments/ }).click()
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  await guest.route('**/comments', async (r) => {
    if (r.request().method() === 'POST') await held
    await r.continue()
  })
  await guest.getByLabel('Add a comment').fill('First')
  await guest.getByRole('button', { name: 'Post comment' }).click()
  await guest.getByLabel('Add a comment').fill('Second')
  release()
  await expect(guest.getByText('First', { exact: true })).toBeVisible()
  await expect(guest.getByRole('button', { name: 'Post comment' })).toBeEnabled()
  await expect(guest.getByLabel('Add a comment')).toHaveValue('Second')
})
