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
