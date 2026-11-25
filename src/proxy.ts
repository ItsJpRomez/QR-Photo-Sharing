import { NextResponse, type NextRequest } from 'next/server'

export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers)
  headers.set('x-path', req.nextUrl.pathname + req.nextUrl.search)
  return NextResponse.next({ request: { headers } })
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
