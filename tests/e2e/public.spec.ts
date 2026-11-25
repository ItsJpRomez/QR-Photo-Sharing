import { expect } from '@playwright/test'
import { createEvent, expectAccessible, hostApi, signUpHost, test } from './helpers'

test('home leads to sign-up', async ({ page }) => {
  await page.goto('/')
  await expectAccessible(page)
  await page.getByRole('link', { name: 'Create an event' }).first().click()
  await expect(page.getByRole('heading', { name: 'Create a host account' })).toBeVisible()
  await expectAccessible(page)
})

for (const path of ['privacy', 'terms']) {
  test(`${path} is marked as a placeholder`, async ({ page }) => {
    await page.goto(`/${path}`)
    await expect(page.getByText('Placeholder: have this reviewed before launch')).toBeVisible()
    await expectAccessible(page)
  })
}

test('anyone can find out how to report a photo', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Report a photo' }).click()
  await expect(page.getByRole('link', { name: 'report@example.test' })).toHaveAttribute('href', 'mailto:report@example.test')
  await expectAccessible(page)
})

test('a wrong link and a deleted event look the same', async ({ page }) => {
  await signUpHost(page)
  const event = await createEvent(page)
  await hostApi(page, 'DELETE', `/api/host/events/${event.id}`)
  const seen: string[] = []
  for (const code of ['nothinghere1', event.code]) {
    const res = await page.goto(`/e/${code}`)
    expect(res!.status()).toBe(404)
    seen.push(await page.locator('body').innerText())
    await expectAccessible(page)
  }
  expect(seen[0]).toBe(seen[1])
})

test('no sideways scrolling on a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  for (const path of ['/', '/sign-in', '/sign-up', '/privacy', '/report']) {
    await page.goto(path)
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(320)
  }
})

test('health is good while everything runs', async ({ page }) => {
  await expect.poll(async () => (await page.request.get('/health')).status(), { timeout: 20_000 }).toBe(200)
})
