import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET } from '@/app/api/e/[code]/route'
import { PATCH } from '@/app/api/e/[code]/me/route'
import * as session from '@/auth/session'
import { db } from '@/db/client'
import { events, participants } from '@/db/schema'
import { newToken, sha256Hex } from '@/lib/ids'
import { resolveViewer } from '@/modules/access/viewer'
import { setPin } from '@/modules/events/pin'
import { resetDb } from '../helpers/db'
import { makeEvent, makeGuest, makeUser } from '../helpers/factory'

beforeEach(async () => {
  vi.restoreAllMocks()
  await resetDb()
})

const req = (token?: string, extra: Record<string, string> = {}) =>
  new Request('http://localhost:3000/api/x', { headers: { ...(token ? { cookie: `qg=${token}` } : {}), ...extra } })
const signedInAs = (u: { id: string; email: string; name: string }) =>
  vi.spyOn(session, 'getUser').mockResolvedValue({ ...u, emailVerified: true })

describe('resolveViewer', () => {
  test('a new guest gets one participant, and keeps it', async () => {
    const e = await makeEvent()
    const token = newToken()
    const a = await resolveViewer({ code: e.code }, req(token))
    const b = await resolveViewer({ code: e.code }, req(token))
    expect(a.viewer).toMatchObject({ kind: 'guest', eventId: e.id })
    expect(b.viewer).toEqual(a.viewer)
    expect(await db.select().from(participants)).toHaveLength(1)
  })

  test('only a hash of the token is kept', async () => {
    const e = await makeEvent()
    const token = newToken()
    await resolveViewer({ code: e.code }, req(token))
    const [p] = await db.select().from(participants)
    expect(p!.tokenHash).toBe(sha256Hex(token))
    expect(JSON.stringify(p)).not.toContain(token)
  })

  test('arriving twice at once still makes one participant', async () => {
    const e = await makeEvent()
    const token = newToken()
    await Promise.all(Array.from({ length: 10 }, () => resolveViewer({ code: e.code }, req(token))))
    expect(await db.select().from(participants)).toHaveLength(1)
  })

  test('the owner is the host; another signed-in host is a guest', async () => {
    const owner = await makeUser()
    const stranger = await makeUser()
    const e = await makeEvent({ ownerId: owner.id })
    signedInAs(owner)
    expect((await resolveViewer({ code: e.code }, req(newToken(), { cookie: 'host.session_token=x' }))).viewer.kind).toBe('host')
    signedInAs(stranger)
    expect((await resolveViewer({ code: e.code }, req(newToken()))).viewer.kind).toBe('guest')
  })

  test.each(['', 'NOPE', undefined])('a bad or missing guest cookie (%j) is refused, not shared', async (token) => {
    const e = await makeEvent()
    await expect(resolveViewer({ code: e.code }, req(token))).rejects.toMatchObject({ code: 'bad_input' })
  })

  test('codes match exactly', async () => {
    const e = await makeEvent({ code: 'abcdefghJKLM' })
    await expect(resolveViewer({ code: 'ABCDEFGHJKLM' }, req(newToken()))).rejects.toMatchObject({ code: 'not_found' })
    await expect(resolveViewer({ code: e.code + ' ' }, req(newToken()))).rejects.toMatchObject({ code: 'not_found' })
  })

  test('a deleted event is not found, even for its owner', async () => {
    const owner = await makeUser()
    const e = await makeEvent({ ownerId: owner.id, deletedAt: new Date() })
    await expect(resolveViewer({ code: e.code }, req(newToken()))).rejects.toMatchObject({ code: 'not_found' })
    signedInAs(owner)
    await expect(resolveViewer({ code: e.code }, req(newToken()))).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('GET the event', () => {
  const get = async (code: string, token: string) =>
    (await GET(req(token), { params: Promise.resolve({ code }) })).json()

  test('before the PIN, only the name, cover and welcome are given', async () => {
    const e = await makeEvent({ welcome: 'Hello!' })
    await setPin(db, e.id, '4821')
    expect(await get(e.code, newToken())).toEqual({ name: 'Ana & Marco', coverUrl: null, welcome: 'Hello!', pinRequired: true })
    expect(await db.select().from(participants)).toHaveLength(0)
  })

  test('without a PIN, it opens straight away and hides the host-only parts', async () => {
    const e = await makeEvent()
    const body = await get(e.code, newToken())
    expect(body).toMatchObject({ id: e.id, pinRequired: false, me: { kind: 'guest', name: '' } })
    expect(JSON.stringify(body)).not.toContain(e.tvToken)
    expect(JSON.stringify(body)).not.toContain(e.ownerId!)
  })
})

describe('PATCH my name', () => {
  const patch = (code: string, token: string, name: unknown) =>
    PATCH(
      new Request('http://localhost:3000/x', { method: 'PATCH', headers: { cookie: `qg=${token}` }, body: JSON.stringify({ name }) }),
      { params: Promise.resolve({ code }) },
    )

  test('names are trimmed and limited to 40 characters', async () => {
    const e = await makeEvent()
    const g = await makeGuest(e.id)
    expect((await patch(e.code, g.token, '  Ana  ')).status).toBe(200)
    const [p] = await db.select().from(participants).where(eq(participants.id, g.id))
    expect(p!.name).toBe('Ana')
    expect((await patch(e.code, g.token, 'x'.repeat(41))).status).toBe(400)
    expect((await patch(e.code, g.token, '👨‍👩‍👧'.repeat(13))).status).toBe(200)
    expect((await patch(e.code, g.token, 5)).status).toBe(400)
  })

  test('a locked guest cannot set a name', async () => {
    const e = await makeEvent()
    await setPin(db, e.id, '1234')
    expect((await patch(e.code, newToken(), 'Ana')).status).toBe(401)
    expect(await db.select().from(events)).toHaveLength(1)
  })
})
