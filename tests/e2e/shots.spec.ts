import { eventWithGuest, hostApi, seedPhotos, test, tiles } from './helpers'

// Pictures for a person to look at. Run with SHOTS=1.
test.skip(!process.env.SHOTS, 'only on request')

test('gallery', async ({ page, browser }) => {
  const { event, guest } = await eventWithGuest(page, browser, { albums: ['Ceremony', 'Dance floor'], welcome: 'Thank you for celebrating with us. Add everything you snap!' })
  await seedPhotos(event.id, { count: 23, tag: 'BrideSquad', name: 'Ben', album: 'Ceremony' })
  for (const [w, h] of [[390, 844], [1280, 800]] as const) {
    await guest.setViewportSize({ width: w, height: h })
    await guest.goto(`/e/${event.code}`)
    await tiles(guest).first().waitFor()
    await guest.waitForLoadState('networkidle')
    await guest.screenshot({ path: `.superpowers/shots/gallery-${w}.png` })
  }
  await guest.setViewportSize({ width: 390, height: 844 })
  await tiles(guest).first().click()
  await guest.waitForTimeout(800)
  await guest.screenshot({ path: '.superpowers/shots/viewer-390.png' })
  await hostApi(page, 'PUT', `/api/host/events/${event.id}/pin`, { pin: '1234' })
  await guest.goto(`/e/${event.code}`)
  await guest.waitForTimeout(500)
  await guest.screenshot({ path: '.superpowers/shots/pin-390.png' })
  await page.goto(`/host/events/${event.id}/settings`)
  await page.waitForTimeout(500)
  await page.screenshot({ path: '.superpowers/shots/settings-390.png', fullPage: true })
})

test('public pages', async ({ page }) => {
  for (const [w, h] of [[390, 844], [1280, 800]] as const) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    await page.waitForTimeout(2800)
    await page.screenshot({ path: `.superpowers/shots/home-${w}.png`, fullPage: true })
  }
})
