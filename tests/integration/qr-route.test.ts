import { beforeEach, expect, test, vi } from 'vitest'
import * as session from '@/auth/session'
import { GET } from '@/app/api/host/events/[id]/qr/route'
import { resetDb } from '../helpers/db'
import { makeEvent, makeUser } from '../helpers/factory'
import { readQr } from '../helpers/qr'

beforeEach(resetDb)

test('only the owner can download it, in either format', async () => {
  const owner = await makeUser()
  const e = await makeEvent({ ownerId: owner.id, name: 'Ana / Marco' })
  const get = (q: string) => GET(new Request(`http://localhost:3000/x${q}`), { params: Promise.resolve({ id: e.id }) })
  vi.spyOn(session, 'getUser').mockResolvedValue({ ...(await makeUser()), emailVerified: true })
  expect((await get('?format=png')).status).toBe(404)
  vi.spyOn(session, 'getUser').mockResolvedValue({ ...owner, emailVerified: true })
  const png = await get('?format=png')
  expect(png.headers.get('content-type')).toBe('image/png')
  expect(png.headers.get('content-disposition')).toMatch(/^attachment; filename="Ana Marco QR\.png"/)
  expect(await readQr(Buffer.from(await png.arrayBuffer()))).toBe(`http://localhost:3000/e/${e.code}`)
  const svg = await get('?format=svg')
  expect(svg.headers.get('content-type')).toBe('image/svg+xml')
  expect((await get('?format=exe')).status).toBe(400)
})
