import { afterEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { route } from '@/lib/route'

const req = new Request('http://localhost:3000/api/x')
afterEach(() => vi.restoreAllMocks())

test('an unexpected error is logged but never shown', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const res = await route(async () => {
    throw new Error('secret detail')
  })(req, { params: Promise.resolve({}) })
  expect(res.status).toBe(500)
  const body = await res.text()
  expect(JSON.parse(body).error.code).toBe('internal')
  expect(body).not.toContain('secret detail')
  expect(log).toHaveBeenCalled()
})

test('an AppError keeps its code, status and sentence', async () => {
  const res = await route(async () => {
    throw new AppError('frozen')
  })(req, { params: Promise.resolve({}) })
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: { code: 'frozen', message: 'The host closed uploads.' } })
})

test('bad input becomes bad_input', async () => {
  const res = await route(async () => {
    z.object({ a: z.string() }).parse({})
    return Response.json({})
  })(req, { params: Promise.resolve({}) })
  expect(res.status).toBe(400)
  expect((await res.json()).error.code).toBe('bad_input')
})

test('malformed JSON becomes bad_input', async () => {
  const res = await route(async (r) => Response.json(await r.json()))(
    new Request('http://localhost:3000/api/x', { method: 'POST', body: '{oops' }),
    { params: Promise.resolve({}) },
  )
  expect(res.status).toBe(400)
  expect((await res.json()).error.code).toBe('bad_input')
})

test('responses are never cached by default', async () => {
  const res = await route(async () => Response.json({ ok: true }))(req, { params: Promise.resolve({}) })
  expect(res.headers.get('cache-control')).toBe('no-store')
})
