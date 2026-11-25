import { beforeEach, expect, test, vi } from 'vitest'
import { GET } from '@/app/health/route'
import * as dbModule from '@/db/client'
import { db } from '@/db/client'
import { heartbeats } from '@/db/schema'
import { storage } from '@/modules/storage'
import { resetDb } from '../helpers/db'

beforeEach(async () => {
  vi.restoreAllMocks()
  await resetDb()
})
const beat = (ageMs: number) => db.insert(heartbeats).values({ name: 'worker', at: new Date(Date.now() - ageMs) })
const check = async () => {
  const res = await GET()
  return [res.status, await res.json()]
}

test('all well', async () => {
  await beat(1000)
  expect(await check()).toEqual([200, { ok: true, failing: [] }])
})
test.each([[61_000], [null]])('the worker is silent (%s)', async (age) => {
  if (age) await beat(age)
  expect(await check()).toEqual([503, { ok: false, failing: ['worker'] }])
})
test('storage is down, without saying how', async () => {
  await beat(1000)
  vi.spyOn(storage, 'head').mockRejectedValue(new Error('AccessDenied: key AKIA123'))
  const [status, body] = await check()
  expect(status).toBe(503)
  expect(body).toEqual({ ok: false, failing: ['storage'] })
})
test('the database is down', async () => {
  vi.spyOn(dbModule.getPool(), 'query').mockImplementation(() => Promise.reject(new Error('connection refused postgres://user:pass@host')))
  const [status, body] = await check()
  expect(status).toBe(503)
  expect((body as { failing: string[] }).failing).toContain('database')
  expect(JSON.stringify(body)).not.toContain('pass')
})
test('a check that hangs counts as down', async () => {
  await beat(1000)
  vi.spyOn(storage, 'head').mockReturnValue(new Promise(() => {}))
  const started = Date.now()
  expect((await check())[0]).toBe(503)
  expect(Date.now() - started).toBeLessThan(6000)
})
