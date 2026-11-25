import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { config as app } from '@/config'
import { clientIp } from '@/lib/ip'

// Kept in step with modules/access/viewer.ts, which this file doesn't import so
// that it never pulls in the database.
const GUEST_COOKIE = 'qg'
const GUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/

const isGuestPath = (p: string) => p.startsWith('/e/') || p.startsWith('/api/e/')
const isPrivatePath = (p: string) => isGuestPath(p) || /^\/(tv|host|api)(\/|$)/.test(p)

function contentSecurityPolicy(nonce: string): string {
  const dev = app.env === 'development'
  const files = app.storage.driver === 's3' ? ` ${new URL(app.storage.endpoint).origin}` : ''
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // The virtualized gallery positions rows with style attributes.
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' blob: data:${files}`,
    `connect-src 'self'${files}${dev ? ' ws:' : ''}`,
    `font-src 'self'`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ')
}

function sameOrigin(req: NextRequest): boolean {
  return req.headers.get('origin') === new URL(app.appUrl).origin
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const isRead = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS'
  if (!isRead && !sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'forbidden', message: 'This request came from another site.' } }, { status: 403 })
  }

  const nonce = randomBytes(16).toString('base64')
  const csp = contentSecurityPolicy(nonce)
  const headers = new Headers(req.headers)
  headers.set('x-path', pathname + search)
  headers.set('x-nonce', nonce)
  const ip = clientIp(req.headers)
  headers.set('x-client-ip', ip === 'direct' ? '127.0.0.1' : ip)
  headers.set('content-security-policy', csp)

  let newGuest: string | undefined
  if (isGuestPath(pathname) && !GUEST_TOKEN.test(req.cookies.get(GUEST_COOKIE)?.value ?? '')) {
    newGuest = randomBytes(32).toString('base64url')
    const others = req.cookies.getAll().filter((c) => c.name !== GUEST_COOKIE)
    headers.set('cookie', [...others.map((c) => `${c.name}=${c.value}`), `${GUEST_COOKIE}=${newGuest}`].join('; '))
  }

  const res = NextResponse.next({ request: { headers } })
  if (newGuest) {
    res.cookies.set(GUEST_COOKIE, newGuest, {
      httpOnly: true,
      sameSite: 'lax',
      secure: app.appUrl.startsWith('https:'),
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
  }
  res.headers.set('content-security-policy', csp)
  res.headers.set('referrer-policy', 'no-referrer')
  res.headers.set('x-content-type-options', 'nosniff')
  res.headers.set('permissions-policy', 'geolocation=(), microphone=()')
  if (isPrivatePath(pathname)) res.headers.set('x-robots-tag', 'noindex')
  return res
}

// Development storage checks its own signatures, and bodies passed through here are cut at 10 MB.
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|api/storage/).*)'] }
