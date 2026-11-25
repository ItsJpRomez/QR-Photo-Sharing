import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import { getAuth, safeNext } from '@/auth/server'
import { getUser, requireUser } from '@/auth/session'
import { db } from '@/db/client'
import { user } from '@/db/auth-schema'
import { testOutbox } from '@/lib/mail'
import { resetDb } from '../helpers/db'

beforeEach(async () => {
  await resetDb()
  testOutbox.length = 0
})

const base = 'http://localhost:3000'
const post = (path: string, body: unknown) =>
  getAuth().handler(
    new Request(`${base}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    }),
  )
const cookieOf = (res: Response) =>
  new Headers({
    cookie: res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  })
const signUp = (email = 'ana@example.test') => post('/sign-up/email', { email, password: 'correct horse 9', name: 'Ana' })

describe('host accounts', () => {
  test('signing up sends exactly one verification email', async () => {
    expect((await signUp()).status).toBe(200)
    expect(testOutbox).toHaveLength(1)
    expect(testOutbox[0]).toMatchObject({ to: 'ana@example.test' })
    expect(testOutbox[0]!.text).toContain(`${base}/api/auth/verify-email?token=`)
  })

  test('following the link verifies the address', async () => {
    const signedUp = await signUp()
    expect((await getUser(cookieOf(signedUp)))?.emailVerified).toBe(false)
    const link = /https?:\/\/\S+/.exec(testOutbox[0]!.text)![0]
    await getAuth().handler(new Request(link, { headers: cookieOf(signedUp) }))
    const [row] = await db.select().from(user).where(eq(user.email, 'ana@example.test'))
    expect(row?.emailVerified).toBe(true)
  })

  test('requireUser refuses strangers and unverified hosts', async () => {
    await expect(requireUser(new Headers())).rejects.toMatchObject({ code: 'unauthenticated' })
    const headers = cookieOf(await signUp())
    await expect(requireUser(headers)).rejects.toMatchObject({ code: 'unverified' })
    await db.update(user).set({ emailVerified: true })
    await expect(requireUser(headers)).resolves.toMatchObject({ email: 'ana@example.test' })
  })

  test('a reset request gives nothing away', async () => {
    await signUp()
    testOutbox.length = 0
    const known = await post('/request-password-reset', { email: 'ana@example.test', redirectTo: '/reset' })
    const unknown = await post('/request-password-reset', { email: 'nobody@example.test', redirectTo: '/reset' })
    expect(known.status).toBe(unknown.status)
    expect(await known.text()).toBe(await unknown.text())
    expect(testOutbox.map((m) => m.to)).toEqual(['ana@example.test'])
  })

  test('short passwords are refused', async () => {
    const res = await post('/sign-up/email', { email: 'b@example.test', password: 'short', name: 'B' })
    expect(res.status).toBe(400)
  })
})

describe('safeNext', () => {
  test.each([
    ['/host/events/1', '/host/events/1'],
    ['/host?tab=a', '/host?tab=a'],
    ['https://evil.test', '/host'],
    ['//evil.test', '/host'],
    ['/\\evil.test', '/host'],
    ['/\t/evil.test', '/host'],
    ['javascript:alert(1)', '/host'],
    [undefined, '/host'],
  ])('%j becomes %j', (input, expected) => {
    expect(safeNext(input)).toBe(expected)
  })
})
