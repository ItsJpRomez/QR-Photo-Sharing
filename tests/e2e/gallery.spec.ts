import { expect } from '@playwright/test'
import { eventWithGuest, expectAccessible, hostApi, query, seedPhotos, test, tiles } from './helpers'

test('a PIN event shows its cover first, then opens', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser, { pin: '4821', welcome: 'So happy you came!' })
  await seedPhotos(event.id, { count: 2 })
  await guest.goto(`/e/${event.code}`)
  await expect(guest.getByRole('heading', { name: 'Ana & Marco' })).toBeVisible()
  await expect(guest.getByText('So happy you came!')).toBeVisible()
  await expectAccessible(guest)
  await guest.getByLabel('PIN').fill('0000')
  await guest.getByRole('button', { name: 'Open gallery' }).click()
  await expect(guest.getByText("That PIN isn't right.")).toBeVisible()
  expect(await guest.content()).not.toContain('/thumb/')
  await guest.getByLabel('PIN').fill('4821')
  await guest.getByRole('button', { name: 'Open gallery' }).click()
  await expect(tiles(guest)).toHaveCount(2)
  await guest.reload()
  await expect(tiles(guest)).toHaveCount(2)
})

test('an unknown link says so', async ({ page }) => {
  const res = await page.goto('/e/nothinghere1')
  expect(res!.status()).toBe(404)
})

test('views and order are kept in the address', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser, { albums: ['Dance floor'] })
  await seedPhotos(event.id, { count: 3 })
  await seedPhotos(event.id, { count: 2, album: 'Dance floor', tag: 'BrideSquad' })
  await seedPhotos(event.id, { count: 1, hearts: 4, featured: true })
  await guest.goto(`/e/${event.code}`)
  await expect(tiles(guest)).toHaveCount(6)
  const views = guest.getByRole('navigation', { name: 'Views' })
  await views.getByRole('link', { name: 'Dance floor' }).click()
  await expect(tiles(guest)).toHaveCount(2)
  await guest.reload()
  await expect(tiles(guest)).toHaveCount(2)
  await expect(views.getByRole('link', { name: 'Dance floor' })).toHaveAttribute('aria-current', 'true')
  await views.getByRole('link', { name: '#BrideSquad' }).click()
  await expect(tiles(guest)).toHaveCount(2)
  await views.getByRole('link', { name: 'Most hearted' }).click()
  await expect(tiles(guest)).toHaveCount(1)
  await views.getByRole('link', { name: 'Featured' }).click()
  await expect(tiles(guest)).toHaveCount(1)
  await views.getByRole('link', { name: 'All photos' }).click()
  await guest.getByLabel('Order').selectOption('featured')
  await expect(guest).toHaveURL(/order=featured/)
  await hostApi(page, 'PATCH', `/api/host/events/${event.id}/settings`, { hearts: false })
  await guest.reload()
  await expect(tiles(guest)).toHaveCount(6)
  await expect(views.getByRole('link', { name: 'Most hearted' })).toHaveCount(0)
})

test('500 photos scroll smoothly, with few on the page at once', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const { event, guest } = await eventWithGuest(page, browser)
  const [first] = await seedPhotos(event.id, { count: 1 })
  // Reuse one photo's files: only the number of tiles matters here.
  await query(
    `insert into photos (event_id, participant_id, client_id, status, size_bytes, mime, ext, width, height, uploaded_at, taken_at, published_at)
     select event_id, participant_id, gen_random_uuid(), 'live', 1, mime, ext, width, height, now(), now(), now() - (n || ' seconds')::interval
     from photos, generate_series(1, 499) n where id = $1`,
    [first],
  )
  await guest.goto(`/e/${event.code}`)
  await expect(tiles(guest).first()).toBeVisible()
  const seen = new Set<string>()
  let most = 0
  for (let i = 0; i < 400 && seen.size < 500; i++) {
    const ids = await tiles(guest).evaluateAll((els) => els.map((el) => el.getAttribute('data-photo')!))
    ids.forEach((id) => seen.add(id))
    most = Math.max(most, ids.length)
    await guest.evaluate(() => window.scrollBy(0, 500))
    await guest.waitForTimeout(30)
  }
  expect(seen.size).toBe(500)
  expect(most).toBeLessThan(120)
})

test('the photo viewer opens, moves, and closes', async ({ page, browser, browserName }) => {
  const { event, guest } = await eventWithGuest(page, browser, { albums: ['Dance floor'] })
  const [a, b] = await seedPhotos(event.id, { count: 3, album: 'Dance floor', tag: 'Fun', name: 'Ben' })
  await guest.goto(`/e/${event.code}`)
  await tiles(guest).first().click()
  const viewer = guest.getByRole('dialog', { name: 'Photo by Ben' })
  await expect(viewer).toBeVisible()
  await expect(viewer.getByText('Dance floor')).toBeVisible()
  await expect(viewer.getByText('#Fun')).toBeVisible()
  await expect(guest).toHaveURL(new RegExp(`photo=${a}`))
  await expectAccessible(guest)

  const box = (await viewer.getByTestId('stage').boundingBox())!
  const y = box.y + box.height / 2
  await guest.mouse.move(box.x + box.width * 0.8, y)
  await guest.mouse.down()
  await guest.mouse.move(box.x + box.width * 0.2, y, { steps: 6 })
  await guest.mouse.up()
  await expect(guest).toHaveURL(new RegExp(`photo=${b}`))
  await viewer.getByRole('button', { name: 'Previous photo' }).click()
  await expect(guest).toHaveURL(new RegExp(`photo=${a}`))
  await guest.goBack()
  await expect(viewer).toBeHidden()
  await expect(guest).toHaveURL(new RegExp(`/e/${event.code}$`))

  await tiles(guest).nth(1).click()
  await expect(viewer).toBeVisible()
  await guest.keyboard.press('Escape')
  await expect(viewer).toBeHidden()
  if (browserName === 'chromium') await expect(tiles(guest).nth(1)).toBeFocused()

  await guest.goto(`/e/${event.code}?photo=${b}`)
  await expect(viewer).toBeVisible()
  await viewer.getByRole('button', { name: 'Close' }).click()
  await expect(viewer).toBeHidden()
})

test('a photo can be saved, unless the host says no', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 1, name: 'Ben' })
  await guest.goto(`/e/${event.code}`)
  await tiles(guest).first().click()
  const [download] = await Promise.all([guest.waitForEvent('download'), guest.getByRole('button', { name: 'Download' }).click()])
  expect(download.suggestedFilename()).toMatch(/_Ben\.jpg$/)
  await expect(guest.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  await hostApi(page, 'PATCH', `/api/host/events/${event.id}/settings`, { guestDownloads: false })
  await guest.reload()
  await expect(guest.getByRole('dialog')).toBeVisible()
  await expect(guest.getByRole('button', { name: 'Download' })).toHaveCount(0)
})

test('guests may delete their own, with a word about clearing the browser', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await guest.goto(`/e/${event.code}`)
  await expect(guest.getByText('Be the first to add a photo')).toBeVisible()
  await guest.request.patch(`/api/e/${event.code}/me`, { headers: { origin: 'http://localhost:3200' }, data: { name: 'Me' } })
  const me = await (await guest.request.get(`/api/e/${event.code}`)).json()
  await seedPhotos(event.id, { count: 1, by: me.me.participantId })
  await guest.reload()
  await tiles(guest).first().click()
  await guest.getByRole('button', { name: 'Delete' }).click()
  await expect(guest.getByText(/clear your browser data/i)).toBeVisible()
})

test('a closed event says so and offers no upload', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await guest.goto(`/e/${event.code}`)
  await expect(guest.getByRole('button', { name: 'Add photos' })).toBeVisible()
  await hostApi(page, 'PUT', `/api/host/events/${event.id}/frozen`, { frozen: true })
  await guest.reload()
  await expect(guest.getByText('Uploads are closed')).toBeVisible()
  await expect(guest.getByRole('button', { name: 'Add photos' })).toHaveCount(0)
})

test('expired image links are replaced, without endless retries', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser)
  await seedPhotos(event.id, { count: 2 })
  const tries = new Map<string, number>()
  let broken = false
  await guest.route('**/api/storage/**/thumb/**', async (r) => {
    const key = new URL(r.request().url()).pathname
    const n = (tries.get(key) ?? 0) + 1
    tries.set(key, n)
    if (n === 1 || broken) await r.fulfill({ status: 403 })
    else await r.continue()
  })
  await guest.goto(`/e/${event.code}`)
  await expect
    .poll(() => tiles(guest).locator('img').evaluateAll((els) => els.filter((i) => (i as HTMLImageElement).naturalWidth > 0).length))
    .toBe(2)
  broken = true
  tries.clear()
  await guest.reload()
  await expect(guest.getByText("Couldn't load").first()).toBeVisible()
  await guest.waitForTimeout(3000)
  for (const n of tries.values()) expect(n).toBeLessThanOrEqual(3)
})

test('no accessibility problems on the gallery', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser, { albums: ['Dance floor'] })
  await seedPhotos(event.id, { count: 4, tag: 'Fun' })
  await guest.goto(`/e/${event.code}`)
  await expect(tiles(guest)).toHaveCount(4)
  await expectAccessible(guest)
})

test('opens wide without sideways scrolling at any size', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser, { name: 'x'.repeat(80), albums: ['A long album name that keeps going on'] })
  await seedPhotos(event.id, { count: 8 })
  for (const width of [320, 390, 768, 1280]) {
    await guest.setViewportSize({ width, height: 800 })
    await guest.goto(`/e/${event.code}`)
    await expect(tiles(guest)).toHaveCount(8)
    expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
})
