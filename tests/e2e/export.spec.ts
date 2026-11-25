import { expect } from '@playwright/test'
import { createEvent, expectAccessible, lastMail, query, seedPhotos, signUpHost, test } from './helpers'

test('one click makes the archive, shows progress and downloads it', async ({ page }) => {
  const email = await signUpHost(page)
  const event = await createEvent(page, { albums: ['Dance floor'] })
  await seedPhotos(event.id, { count: 12, album: 'Dance floor' })
  await page.goto(`/host/events/${event.id}/export`)
  await expectAccessible(page)
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: 'Download all photos' }).click()])
  expect(download.suggestedFilename()).toBe('Ana & Marco photos.zip')
  await expect(page.getByText('12 photos', { exact: false }).first()).toBeVisible()
  await expect(page.getByText(/Ready until/)).toBeVisible()
  expect((await lastMail(email)).subject).toBe('Your photos from Ana & Marco are ready')
  const [again] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download again' }).click()])
  expect(await again.failure()).toBeNull()
})

test('with no photos it says so', async ({ page }) => {
  await signUpHost(page)
  const event = await createEvent(page)
  await page.goto(`/host/events/${event.id}/export`)
  await page.getByRole('button', { name: 'Download all photos' }).click()
  await expect(page.getByText('There are no photos to download yet.')).toBeVisible()
})

test('missing files are reported, not hidden', async ({ page }) => {
  await signUpHost(page)
  const event = await createEvent(page)
  const [lost] = await seedPhotos(event.id, { count: 3 })
  await query(`update photos set ext = 'png' where id = $1`, [lost])
  await page.goto(`/host/events/${event.id}/export`)
  await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: 'Download all photos' }).click()])
  await expect(page.getByText('1 photo could not be included')).toBeVisible()
})
