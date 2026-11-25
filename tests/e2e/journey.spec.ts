import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { expect, type Page } from '@playwright/test'
import yauzl from 'yauzl'
import { createEvent, hostApi, newGuest, signUpHost, test, tiles } from './helpers'

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

async function unzip(file: string): Promise<Map<string, string>> {
  const zip = await new Promise<yauzl.ZipFile>((ok, no) => yauzl.open(file, { lazyEntries: true }, (err, z) => (err ? no(err) : ok(z))))
  const found = new Map<string, string>()
  return new Promise((ok, no) => {
    zip.on('end', () => ok(found))
    zip.on('error', no)
    zip.on('entry', (e: yauzl.Entry) =>
      zip.openReadStream(e, async (err, s) => {
        if (err) return no(err)
        const chunks: Buffer[] = []
        for await (const c of s) chunks.push(c as Buffer)
        found.set(e.fileName, sha(Buffer.concat(chunks)))
        zip.readEntry()
      }),
    )
    zip.readEntry()
  })
}

async function add(guest: Page, files: string[], name: string, after: RegExp) {
  await guest.getByRole('button', { name: 'Add photos' }).click()
  await guest.getByLabel('Choose from library').setInputFiles(files.map((f) => `tests/fixtures/${f}`))
  await guest.getByLabel('Your first name').fill(name)
  await guest.getByRole('button', { name: /^Upload \d/ }).click()
  await expect(guest.getByText(after)).toBeVisible({ timeout: 40_000 })
}

test('a whole event, from sign-up to the downloaded archive', async ({ page, browser }) => {
  test.setTimeout(180_000)
  await signUpHost(page)
  const event = await createEvent(page, { name: 'Ana & Marco', albums: ['Ceremony'], pin: '4821' })
  await hostApi(page, 'PATCH', `/api/host/events/${event.id}/settings`, { approval: true })

  const [ana, ben] = [await newGuest(page, browser), await newGuest(page, browser)]
  for (const g of [ana, ben]) {
    await g.goto(`/e/${event.code}`)
    await g.getByLabel('PIN').fill('4821')
    await g.getByRole('button', { name: 'Open gallery' }).click()
    await expect(g.getByText('Be the first to add a photo')).toBeVisible()
  }
  await add(ana, ['rotated-gps.heic', 'p3.jpg'], 'Ana', /2 photos waiting for host/)
  await add(ben, ['rotated-gps.jpg', 'plain.png'], 'Ben', /2 photos waiting for host/)
  await expect(tiles(ben)).toHaveCount(2) // only their own, waiting

  await page.goto(`/host/events/${event.id}/waiting`)
  await expect(tiles(page)).toHaveCount(4)
  await page.getByRole('button', { name: 'Approve all' }).click()
  await expect(tiles(ana)).toHaveCount(4, { timeout: 10_000 })
  await expect(tiles(ben)).toHaveCount(4, { timeout: 10_000 })

  await tiles(ben).first().click()
  await ben.getByRole('button', { name: /^Heart/ }).click()
  await ben.getByRole('button', { name: /^Comments/ }).click()
  await ben.getByLabel('Add a comment').fill('Beautiful!')
  await ben.getByRole('button', { name: 'Post comment' }).click()
  await expect(ben.getByText('Beautiful!')).toBeVisible()
  const hearted = await ben.evaluate(() => new URLSearchParams(location.search).get('photo'))
  await ana.locator(`[data-photo="${hearted}"]`).click()
  await expect(ana.getByRole('button', { name: /^Heart/ })).toHaveText(/1/, { timeout: 8000 })
  await ana.getByRole('button', { name: /^Comments/ }).click()
  await expect(ana.getByText('Beautiful!')).toBeVisible()
  for (const g of [ana, ben]) await g.getByRole('button', { name: 'Close' }).click()

  await page.goto(`/host/events/${event.id}`)
  await page.getByRole('button', { name: 'Select' }).click()
  await page.getByRole('button', { name: 'Photo by Ben' }).first().click()
  await page.getByRole('button', { name: 'Hide' }).click()
  await expect(tiles(ana)).toHaveCount(3, { timeout: 8000 })

  await page.goto(`/host/events/${event.id}/settings`)
  await page.getByRole('switch', { name: 'Close uploads' }).click()
  await expect(ana.getByText('Uploads are closed')).toBeVisible({ timeout: 8000 })

  await page.goto(`/host/events/${event.id}/export`)
  await page.getByRole('switch', { name: 'Include hidden photos' }).click()
  const [zip] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: 'Download all photos' }).click()])
  const files = await unzip(await zip.path())
  const sent = ['rotated-gps.heic', 'p3.jpg', 'rotated-gps.jpg', 'plain.png'].map((f) => sha(fs.readFileSync(`tests/fixtures/${f}`)))
  expect([...files.values()].sort()).toEqual(sent.sort())
  expect([...files.keys()].filter((n) => /_Ana_\d{4}\./.test(n))).toHaveLength(2)
  expect([...files.keys()].some((n) => /2026-06-12_184501_Ana_\d{4}\.heic$/.test(n))).toBe(true)
})
