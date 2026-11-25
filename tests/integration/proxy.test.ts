import { NextRequest } from 'next/server'
import { describe, expect, test } from 'vitest'
import { proxy } from '@/proxy'

const call = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  proxy(new NextRequest(`http://localhost:3000${path}`, init))

describe('changes must come from this site', () => {
  test.each([
    ['http://localhost:3000', 200],
    ['https://evil.test', 403],
    ['null', 403],
    [undefined, 403],
  ])('origin %s gives %i', (origin, status) => {
    const res = call('/api/e/abc/pin', { method: 'POST', headers: origin ? { origin } : {} })
    expect(res.status).toBe(status)
  })
  test('reading needs no origin', () => expect(call('/api/e/abc').status).toBe(200))
})

describe('the guest cookie', () => {
  const cookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith('qg='))

  test('is set on the first visit and visible to that same request', () => {
    const res = call('/e/abcdefghJKLM')
    const set = cookie(res)!
    expect(set).toMatch(/HttpOnly/i)
    expect(set).toMatch(/SameSite=lax/i)
    expect(set).not.toMatch(/Secure/i) // http://localhost
    const value = /qg=([^;]+)/.exec(set)![1]!
    expect(Buffer.from(value, 'base64url')).toHaveLength(32)
    expect(res.headers.get('x-middleware-request-cookie')).toContain(`qg=${value}`)
  })
  test('is kept when valid and replaced when not', () => {
    const good = Buffer.alloc(32, 1).toString('base64url')
    expect(cookie(call('/e/a', { headers: { cookie: `qg=${good}` } }))).toBeUndefined()
    expect(cookie(call('/e/a', { headers: { cookie: 'qg=short' } }))).toBeDefined()
  })
  test('is not set elsewhere', () => expect(cookie(call('/sign-in'))).toBeUndefined())
})

describe('headers', () => {
  const res = call('/e/abc')
  const csp = res.headers.get('content-security-policy')!
  test('private pages are not indexed and leak no address', () => {
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(call('/tv/abc').headers.get('x-robots-tag')).toBe('noindex')
    expect(call('/').headers.get('x-robots-tag')).toBeNull()
  })
  test('the policy has a fresh nonce and no loose script sources', () => {
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]
    expect(call('/e/abc').headers.get('content-security-policy')).not.toContain(nonce!)
    const script = csp.split(';').find((d) => d.trim().startsWith('script-src'))!
    expect(script).not.toContain('unsafe-inline')
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })
  test('images and connections are limited to this site', () => {
    const dir = (n: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(n + ' '))
    expect(dir('img-src')).toBe("img-src 'self' blob: data:")
    expect(dir('style-src-attr')).toBe("style-src-attr 'unsafe-inline'")
  })
})
