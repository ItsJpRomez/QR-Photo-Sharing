import { describe, expect, test } from 'vitest'
import { GET, PUT } from '@/app/api/storage/[...key]/route'
import { DiskStorage } from '@/modules/storage/disk'
import { storageContract, type Send } from '../helpers/storage-contract'

const send: Send = (url, init) => {
  const u = new URL(url)
  const key = u.pathname.replace('/api/storage/', '').split('/').map(decodeURIComponent)
  const req = new Request(url, init)
  return (init?.method === 'PUT' ? PUT : GET)(req, { params: Promise.resolve({ key }) })
}

const make = () => new DiskStorage('.data/test-storage')
storageContract('disk', make, send)

describe('disk links', () => {
  test('a read link stops working within two hours', async () => {
    const s = make()
    await s.put('ev/x/a', Buffer.from('a'), 'text/plain')
    const now = Date.now()
    const tooOld = await s.signGet('ev/x/a', { now: new Date(now - 2 * 3600_000 - 60_000) })
    expect((await send(tooOld)).status).toBe(403)
    const fresh = await s.signGet('ev/x/a', { now: new Date(now - 50 * 60_000) })
    expect((await send(fresh)).status).toBe(200)
  })

  test('a read link cannot be used to write', async () => {
    const url = await make().signGet('ev/x/a')
    expect((await send(url, { method: 'PUT', body: 'evil' })).status).toBe(403)
  })

  test('the expiry cannot be extended', async () => {
    const u = new URL(await make().signGet('ev/x/a'))
    u.searchParams.set('exp', String(Number(u.searchParams.get('exp')) + 9999))
    expect((await send(u.toString())).status).toBe(403)
  })

  test.each(['../escape', 'ev/../../escape', '/etc/passwd', 'ev/x/..', 'ev\0x'])('refuses the key %j', async (key) => {
    await expect(make().read(key)).rejects.toThrow(/key/i)
    await expect(make().put(key, Buffer.from('x'), 'text/plain')).rejects.toThrow(/key/i)
  })

  test('refuses to delete everything by accident', async () => {
    await expect(make().deletePrefix('')).rejects.toThrow()
    await expect(make().deletePrefix('ev')).rejects.toThrow()
  })
})
