import fs from 'node:fs'
import { expect, type Page } from '@playwright/test'

export const uniqueEmail = () => `host-${crypto.randomUUID().slice(0, 8)}@example.test`
export const PASSWORD = 'correct horse 9'

export async function lastMail(to: string): Promise<{ subject: string; text: string; link: string }> {
  for (let i = 0; i < 50; i++) {
    const mail = fs
      .readFileSync('.data/e2e-mail.jsonl', 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { to: string; subject: string; text: string })
      .findLast((m) => m.to === to)
    if (mail) return { ...mail, link: /https?:\/\/\S+/.exec(mail.text)?.[0] ?? '' }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`No email for ${to}`)
}

export async function signUpHost(page: Page): Promise<string> {
  const email = uniqueEmail()
  await page.goto('/sign-up')
  await page.getByLabel('Your name').fill('Ana Host')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await page.goto((await lastMail(email)).link)
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible()
  return email
}

export type EventOptions = { name?: string; albums?: string[]; tags?: string[]; pin?: string | null; welcome?: string }
export type TestEvent = { id: string; code: string; url: string; tvUrl: string }

/** Creates an event through the API, as the signed-in host on this page. */
export async function createEvent(page: Page, o: EventOptions = {}): Promise<TestEvent> {
  const res = await page.request.post('/api/host/events', {
    headers: { origin: 'http://localhost:3200' },
    data: { name: 'Ana & Marco', eventDate: '2026-06-12', timeZone: 'Asia/Manila', welcome: '', accent: '#4a2370', albums: [], tags: [], pin: null, ...o },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as TestEvent
}

export async function hostApi(page: Page, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data: unknown = {}) {
  const res = await page.request.fetch(path, { method, headers: { origin: 'http://localhost:3200' }, data })
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true)
  return res.json()
}
