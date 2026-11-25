import { db } from '@/db/client'
import { events, participants, photos } from '@/db/schema'
import { user } from '@/db/auth-schema'
import { newEventCode, newToken, sha256Hex } from '@/lib/ids'

let n = 0
export const next = () => ++n

export async function makeUser(over: Partial<typeof user.$inferInsert> = {}) {
  const i = next()
  const [row] = await db
    .insert(user)
    .values({ id: `user-${i}`, name: `Host ${i}`, email: `host${i}@example.test`, emailVerified: true, ...over })
    .returning()
  return row!
}

export async function makeEvent(over: Partial<typeof events.$inferInsert> = {}) {
  const ownerId = over.ownerId !== undefined ? over.ownerId : (await makeUser()).id
  const [row] = await db
    .insert(events)
    .values({
      name: 'Ana & Marco',
      code: newEventCode(),
      tvToken: newToken(),
      eventDate: '2026-06-12',
      timeZone: 'Asia/Manila',
      maxPhotos: 5000,
      maxBytes: 25 * 1024 ** 3,
      ...over,
      ownerId,
    })
    .returning()
  return row!
}

export async function makeGuest(eventId: string, over: Partial<typeof participants.$inferInsert> = {}) {
  const token = newToken()
  const [row] = await db
    .insert(participants)
    .values({ eventId, tokenHash: sha256Hex(token), ...over })
    .returning()
  return { ...row!, token }
}

export async function makePhoto(eventId: string, participantId: string, over: Partial<typeof photos.$inferInsert> = {}) {
  const now = new Date()
  const status = over.status ?? 'live'
  const [row] = await db
    .insert(photos)
    .values({
      eventId,
      participantId,
      clientId: crypto.randomUUID(),
      status,
      sizeBytes: 1000,
      sha256: sha256Hex(crypto.randomUUID()),
      mime: 'image/jpeg',
      ext: 'jpg',
      width: 4000,
      height: 3000,
      reservedAt: now,
      uploadedAt: now,
      takenAt: now,
      publishedAt: status === 'live' ? now : null,
      ...over,
    })
    .returning()
  return row!
}
