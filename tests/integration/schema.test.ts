import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import { db } from '@/db/client'
import { albums, events, hearts, participants, photos } from '@/db/schema'
import { resetDb } from '../helpers/db'
import { makeEvent, makeGuest, makePhoto } from '../helpers/factory'

beforeEach(resetDb)

describe('photo uniqueness', () => {
  test('one photo per client id in an event', async () => {
    const e = await makeEvent()
    const g = await makeGuest(e.id)
    const clientId = crypto.randomUUID()
    await makePhoto(e.id, g.id, { clientId })
    await expect(makePhoto(e.id, g.id, { clientId })).rejects.toThrow()
  })

  test('two live photos cannot share a hash', async () => {
    const e = await makeEvent()
    const g = await makeGuest(e.id)
    await makePhoto(e.id, g.id, { sha256: 'same' })
    await expect(makePhoto(e.id, g.id, { sha256: 'same' })).rejects.toThrow()
  })

  test.each(['deleted', 'failed', 'expired', 'duplicate'] as const)('a %s photo does not block the hash', async (status) => {
    const e = await makeEvent()
    const g = await makeGuest(e.id)
    await makePhoto(e.id, g.id, { sha256: 'same', status })
    await expect(makePhoto(e.id, g.id, { sha256: 'same' })).resolves.toBeTruthy()
  })

  test.each(['pending', 'hidden', 'processing'] as const)('a %s photo blocks the hash', async (status) => {
    const e = await makeEvent()
    const g = await makeGuest(e.id)
    await makePhoto(e.id, g.id, { sha256: 'same', status })
    await expect(makePhoto(e.id, g.id, { sha256: 'same' })).rejects.toThrow()
  })

  test('different events may hold the same photo', async () => {
    const [a, b] = [await makeEvent(), await makeEvent()]
    await makePhoto(a.id, (await makeGuest(a.id)).id, { sha256: 'same' })
    await expect(makePhoto(b.id, (await makeGuest(b.id)).id, { sha256: 'same' })).resolves.toBeTruthy()
  })
})

test('one participant per guest token in an event', async () => {
  const e = await makeEvent()
  await db.insert(participants).values({ eventId: e.id, tokenHash: 'h' })
  await expect(db.insert(participants).values({ eventId: e.id, tokenHash: 'h' })).rejects.toThrow()
})

test('one heart per participant and photo', async () => {
  const e = await makeEvent()
  const g = await makeGuest(e.id)
  const p = await makePhoto(e.id, g.id)
  await db.insert(hearts).values({ photoId: p.id, participantId: g.id })
  await expect(db.insert(hearts).values({ photoId: p.id, participantId: g.id })).rejects.toThrow()
})

test('deleting an album keeps its photos', async () => {
  const e = await makeEvent()
  const g = await makeGuest(e.id)
  const [album] = await db.insert(albums).values({ eventId: e.id, name: 'Dance', position: 0 }).returning()
  const p = await makePhoto(e.id, g.id, { albumId: album!.id })
  await db.delete(albums).where(eq(albums.id, album!.id))
  const [after] = await db.select().from(photos).where(eq(photos.id, p.id))
  expect(after).toMatchObject({ albumId: null, status: 'live' })
})

test('event settings default to the spec values', async () => {
  const e = await makeEvent()
  expect(e.settings).toEqual({
    hearts: true,
    comments: true,
    guestDownloads: true,
    approval: false,
    defaultOrder: 'newest',
    tv: { seconds: 7, albumId: null, showNames: true, showQr: true, showPin: false },
  })
})

test('removing the owner keeps the event so it can be purged', async () => {
  const e = await makeEvent()
  const { user } = await import('@/db/auth-schema')
  await db.delete(user).where(eq(user.id, e.ownerId!))
  const [after] = await db.select().from(events).where(eq(events.id, e.id))
  expect(after?.ownerId).toBeNull()
})
