import { afterEach, expect, test, vi } from 'vitest'
import { httpTransport } from '@/features/upload-queue/transport'
import type { QueueItem } from '@/features/upload-queue/types'

const item = { clientId: 'c', code: 'CODE', size: 1, mime: 'image/jpeg', photoId: 'p', meta: { albumId: null, tags: [] } } as unknown as QueueItem

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test.each([
  ['reserve', () => httpTransport.reserve(item)],
  ['complete', () => httpTransport.complete(item)],
  ['states', () => httpTransport.states('CODE', ['p'])],
])('%s gives up on a connection that never answers', async (_name, run) => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) =>
    new Promise((_, no) => init.signal?.addEventListener('abort', () => no(new DOMException('aborted', 'AbortError')))))
  const result = run().then(() => 'ok', (e: { code: string; status: number }) => [e.code, e.status])
  await vi.advanceTimersByTimeAsync(21_000)
  expect(await Promise.race([result, Promise.resolve('still waiting')])).toEqual(['offline', 0])
})

test('an error page that is not ours is tried again later, not taken as an answer', async () => {
  vi.stubGlobal('fetch', async () => new Response('<html>Bad gateway</html>', { status: 502 }))
  await expect(httpTransport.reserve(item)).rejects.toMatchObject({ code: 'internal', status: 502 })
})

test('a sign-in page from the venue Wi-Fi is not mistaken for success', async () => {
  vi.stubGlobal('fetch', async () => new Response('<html>Accept the Wi-Fi terms</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
  await expect(httpTransport.reserve(item)).rejects.toMatchObject({ code: 'offline', status: 0 })
})
