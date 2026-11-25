import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import { POST } from '@/app/api/e/[code]/pin/route'
import { db } from '@/db/client'
import { events, rateLimits, type EventRow } from '@/db/schema'
import { hmacHex, newToken, sha256Hex } from '@/lib/ids'
import { clientIp } from '@/lib/ip'
import { testOutbox } from '@/lib/mail'
import { hitLimit } from '@/lib/rate-limit'
import { resolveViewer } from '@/modules/access/viewer'
import { setPin, tryPin } from '@/modules/events/pin'
import { resetDb } from '../helpers/db'
import { makeEvent } from '../helpers/factory'

let e: EventRow
beforeEach(async () => {
  await resetDb()
  testOutbox.length = 0
  const made = await makeEvent()
  await setPin(db, made.id, '4821')
  e = await reload()
  async function reload() {
    return (await db.select().from(events).where(eq(events.id, made.id)))[0]!
  }
})

const code = (p: Promise<unknown>) => p.then(() => 'ok', (err: { code: string }) => err.code)
const attempt = (pin: string, token = newToken(), ip = '1.1.1.1') => code(tryPin(e, sha256Hex(token), ip, pin))
const reload = async () => (await db.select().from(events).where(eq(events.id, e.id)))[0]!
const req = (token: string) => new Request('http://localhost:3000/x', { headers: { cookie: `qg=${token}` } })
const seed = (key: string, count: number, windowSec: number) =>
  db.insert(rateLimits).values({ key, count, windowStart: new Date(Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000) })

describe('the PIN', () => {
  test('is kept only as a keyed hash tied to the event', async () => {
    expect(e.pinHash).toBeTruthy()
    expect(e.pinHash).not.toContain('4821')
    expect(e.pinHash).not.toBe(sha256Hex('4821'))
    expect(e.pinHash).not.toBe(hmacHex('4821'))
    const other = await makeEvent()
    await setPin(db, other.id, '4821')
    expect((await db.select().from(events).where(eq(events.id, other.id)))[0]!.pinHash).not.toBe(e.pinHash)
  })

  test.each(['123', '12345', 'abcd', '12 4', '١٢٣٤'])('%j is not a PIN', async (pin) => {
    expect(await code(setPin(db, e.id, pin))).toBe('bad_input')
  })

  test('lets the right guest in, and stays open', async () => {
    const token = newToken()
    expect((await resolveViewer({ code: e.code }, req(token))).viewer.kind).toBe('locked')
    expect(await attempt('4821', token)).toBe('ok')
    expect((await resolveViewer({ code: e.code }, req(token))).viewer.kind).toBe('guest')
  })

  test('changing it locks everyone out again; removing it opens the event', async () => {
    const token = newToken()
    await attempt('4821', token)
    await setPin(db, e.id, '9999')
    expect((await resolveViewer({ code: e.code }, req(token))).viewer.kind).toBe('locked')
    await setPin(db, e.id, null)
    expect((await resolveViewer({ code: e.code }, req(token))).viewer.kind).toBe('guest')
  })

  test('setting the same PIN again still locks guests', async () => {
    const token = newToken()
    await attempt('4821', token)
    await setPin(db, e.id, '4821')
    expect((await resolveViewer({ code: e.code }, req(token))).viewer.kind).toBe('locked')
  })
})

describe('wrong PINs', () => {
  test('the sixth try is refused even when right', async () => {
    const token = newToken()
    for (let i = 0; i < 5; i++) expect(await attempt('0000', token)).toBe('pin_wrong')
    expect(await attempt('4821', token)).toBe('rate_limited')
  })

  test('trying many at once does not get round the limit', async () => {
    const token = newToken()
    const results = await Promise.all(Array.from({ length: 30 }, () => attempt('0000', token)))
    expect(results.filter((r) => r === 'pin_wrong')).toHaveLength(5)
  })

  test('right PINs are never counted: 150 guests behind one address all get in', async () => {
    for (let i = 0; i < 15; i++) {
      const r = await Promise.all(Array.from({ length: 10 }, () => attempt('4821')))
      expect(new Set(r)).toEqual(new Set(['ok']))
    }
  })

  test('the 101st wrong one from an address is refused', async () => {
    await seed('pin:ip:1.1.1.1', 99, 3600)
    expect(await attempt('0000')).toBe('pin_wrong')
    expect(await attempt('0000')).toBe('rate_limited')
    expect(await attempt('0000', newToken(), '2.2.2.2')).toBe('pin_wrong')
  })

  test('the 500th pauses the event for ten minutes and tells the host once', async () => {
    await seed(`pin:event:${e.id}`, 498, 3600)
    const inside = newToken()
    expect(await attempt('4821', inside)).toBe('ok')
    expect(await attempt('0000')).toBe('pin_wrong')
    expect((await reload()).pinPausedUntil).toBeNull()
    expect(await attempt('0000')).toBe('pin_wrong')
    e = await reload()
    const minutes = (e.pinPausedUntil!.getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(9.9)
    expect(minutes).toBeLessThanOrEqual(10)
    expect(await attempt('4821')).toBe('pin_paused')
    expect((await resolveViewer({ code: e.code }, req(inside))).viewer.kind).toBe('guest')
    expect(testOutbox).toHaveLength(1)
    expect(testOutbox[0]!.text).not.toContain('4821')

    await db.update(events).set({ pinPausedUntil: new Date(Date.now() - 1000) })
    e = await reload()
    expect(await attempt('4821')).toBe('ok')
  })

  test('the route refuses a malformed PIN without counting it', async () => {
    const res = await POST(
      new Request('http://localhost:3000/x', { method: 'POST', headers: { cookie: `qg=${newToken()}` }, body: '{"pin":"12"}' }),
      { params: Promise.resolve({ code: e.code }) },
    )
    expect(res.status).toBe(400)
    expect(await db.select().from(rateLimits)).toHaveLength(0)
  })
})

describe('limits and addresses', () => {
  test('hitLimit counts exactly, also under concurrency', async () => {
    const r = await Promise.all(Array.from({ length: 20 }, () => hitLimit('k', 7, 60)))
    expect(r.filter(Boolean)).toHaveLength(7)
  })

  test.each([
    [0, '9.9.9.9', 'direct'],
    [1, 'spoofed, 9.9.9.9', '9.9.9.9'],
    [2, 'spoofed, 9.9.9.9, 10.0.0.1', '9.9.9.9'],
    [1, null, 'direct'],
    [2, '9.9.9.9', 'direct'],
  ])('with %i proxies, %j means %s', (hops, header, expected) => {
    const h = new Headers(header ? { 'x-forwarded-for': header } : {})
    expect(clientIp(h, hops)).toBe(expected)
  })
})
