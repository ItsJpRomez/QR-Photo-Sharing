import { expect, test } from 'vitest'
import { hmacHex, newEventCode, newToken, sha256Hex } from '@/lib/ids'

test('event codes are 12 unambiguous characters and do not repeat', () => {
  const codes = Array.from({ length: 10_000 }, newEventCode)
  expect(new Set(codes).size).toBe(10_000)
  for (const c of codes) expect(c).toMatch(/^[1-9A-HJ-NP-Za-km-z]{12}$/)
})

test('every base58 character is used about equally', () => {
  const counts = new Map<string, number>()
  for (let i = 0; i < 10_000; i++) for (const ch of newEventCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  expect(counts.size).toBe(58)
  const expected = 120_000 / 58
  for (const n of counts.values()) expect(Math.abs(n - expected) / expected).toBeLessThan(0.2)
})

test('tokens hold 256 random bits', () => {
  expect(Buffer.from(newToken(), 'base64url')).toHaveLength(32)
  expect(newToken()).not.toBe(newToken())
})

test('hashes are stable, and hmac depends on the secret', () => {
  expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  expect(hmacHex('abc')).toBe(hmacHex('abc'))
  expect(hmacHex('abc')).not.toBe(sha256Hex('abc'))
})
