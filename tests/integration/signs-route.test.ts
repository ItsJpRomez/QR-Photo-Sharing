import { beforeEach, expect, test, vi } from 'vitest'
import * as session from '@/auth/session'
import { POST } from '@/app/api/host/events/[id]/sign/route'
import { db } from '@/db/client'
import { setPin } from '@/modules/events/pin'
import { resetDb } from '../helpers/db'
import { makeEvent, makeUser } from '../helpers/factory'
import { readQr } from '../helpers/qr'

beforeEach(resetDb)
const base = { size: 'a6', style: 'classic', headline: 'Ana 🎉', subtext: '' }

test('signs are made for the owner, with the PIN checked', async () => {
  const owner = await makeUser()
  const e = await makeEvent({ ownerId: owner.id })
  const call = (b: object) => POST(new Request('http://localhost:3000/x', { method: 'POST', body: JSON.stringify({ ...base, ...b }) }), { params: Promise.resolve({ id: e.id }) })
  vi.spyOn(session, 'getUser').mockResolvedValue({ ...(await makeUser()), emailVerified: true })
  expect((await call({ format: 'png' })).status).toBe(404)
  vi.spyOn(session, 'getUser').mockResolvedValue({ ...owner, emailVerified: true })
  const png = await call({ format: 'png' })
  expect(png.headers.get('content-type')).toBe('image/png')
  expect(decodeURIComponent(png.headers.get('x-missing-characters')!)).toBe('🎉')
  expect(await readQr(Buffer.from(await png.arrayBuffer()))).toBe(`http://localhost:3000/e/${e.code}`)
  expect((await call({ format: 'pdf' })).headers.get('content-type')).toBe('application/pdf')
  expect((await call({ format: 'png', pin: '4821' })).status).toBe(400) // no PIN on this event
  await setPin(db, e.id, '4821')
  expect((await call({ format: 'png', pin: '4821' })).status).toBe(200)
  const wrong = await call({ format: 'png', pin: '0000' })
  expect(wrong.status).toBe(400)
  expect((await wrong.json()).error.message).toContain("isn't this event's PIN")
})
