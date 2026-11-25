import { expect } from '@playwright/test'
import { lastMail, PASSWORD, signUpHost, test } from './helpers'

test('a host signs up, confirms by email and reaches the dashboard', async ({ page }) => {
  await signUpHost(page)
  await expect(page).toHaveURL(/\/host$/)
})

test('signed-out hosts are sent to sign in and come back', async ({ page, context }) => {
  const email = await signUpHost(page)
  await context.clearCookies()
  await page.goto('/host?from=test')
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fhost%3Ffrom%3Dtest/)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/host\?from=test$/)
})

test('a return address on another site is ignored', async ({ page, context }) => {
  const email = await signUpHost(page)
  await context.clearCookies()
  await page.goto('/sign-in?next=https%3A%2F%2Fevil.test')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/localhost:3200\/host$/)
})

test('a wrong password says so', async ({ page }) => {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill('nobody@example.test')
  await page.getByLabel('Password').fill('wrong password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert').filter({ hasText: /invalid/i })).toBeVisible()
})

test('a forgotten password can be reset', async ({ page, context }) => {
  const email = await signUpHost(page)
  await context.clearCookies()
  await page.goto('/reset')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText('a reset link is on its way')).toBeVisible()
  await expect.poll(async () => (await lastMail(email)).subject).toBe('Reset your password')
  await page.goto((await lastMail(email)).link)
  await page.getByLabel('New password').fill('a brand new phrase')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Your password is changed')).toBeVisible()
})

test('Google is not offered without its keys', async ({ page }) => {
  await page.goto('/sign-in')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('button', { name: /google/i })).toHaveCount(0)
})
