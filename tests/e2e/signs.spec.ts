import fs from 'node:fs'
import { expect } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { readQr } from '../helpers/qr'
import { createEvent, expectAccessible, signUpHost, test } from './helpers'

test('the QR code downloads and scans', async ({ page }) => {
  await signUpHost(page)
  const event = await createEvent(page)
  await page.goto(`/host/events/${event.id}/share`)
  await expect(page.getByLabel('Event link')).toHaveValue(event.url)
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download PNG' }).click()])
  expect(await readQr(fs.readFileSync(await png.path()))).toBe(event.url)
})

test('a sign is edited, previewed, downloaded and scanned', async ({ page }) => {
  await signUpHost(page)
  const event = await createEvent(page, { pin: '4821' })
  await page.goto(`/host/events/${event.id}/share`)
  const preview = page.getByRole('img', { name: 'Sign preview' })
  await expect(preview).toBeVisible()
  await page.getByLabel('Headline').fill('Party 🎉 time')
  await expect(page.getByText("Signs can't print: 🎉")).toBeVisible()
  await page.getByLabel('Size').selectOption('a4')
  await page.getByLabel('Style').selectOption('bold')
  await page.getByLabel('PIN on the sign').fill('0000')
  await expect(page.getByText("That isn't this event's PIN.")).toBeVisible()
  await page.getByLabel('PIN on the sign').fill('4821')
  await expect(page.getByText("That isn't this event's PIN.")).toHaveCount(0)
  await expectAccessible(page)
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()])
  expect(pdf.suggestedFilename()).toBe('Ana & Marco sign a4.pdf')
  expect((await PDFDocument.load(fs.readFileSync(await pdf.path()))).getPageCount()).toBe(1)
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download image' }).click()])
  expect(await readQr(fs.readFileSync(await png.path()))).toBe(event.url)
})
