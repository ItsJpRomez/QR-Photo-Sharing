import { and, eq, isNull } from 'drizzle-orm'
import * as session from '@/auth/session'
import { db } from '@/db/client'
import { events, participants, type EventRow, type ParticipantRow } from '@/db/schema'
import { AppError } from '@/lib/errors'
import { sha256Hex } from '@/lib/ids'
import { firstCharacters } from '@/lib/text'
import type { Viewer } from './can'

export const GUEST_COOKIE = 'qg'

export type Resolved = { event: EventRow; viewer: Viewer; me: ParticipantRow | null; tokenHash: string | null }

export function isGuestToken(token: string | undefined): token is string {
  return token !== undefined && /^[A-Za-z0-9_-]{43}$/.test(token)
}

export function guestTokenHash(headers: Headers): string | null {
  const token = new RegExp(`(?:^|;\\s*)${GUEST_COOKIE}=([^;]*)`).exec(headers.get('cookie') ?? '')?.[1]
  return isGuestToken(token) ? sha256Hex(token) : null
}

async function findEvent(by: { code: string } | { eventId: string }): Promise<EventRow> {
  if ('eventId' in by && !/^[0-9a-f-]{36}$/i.test(by.eventId)) throw new AppError('not_found')
  const match = 'code' in by ? eq(events.code, by.code) : eq(events.id, by.eventId)
  const [event] = await db.select().from(events).where(and(match, isNull(events.deletedAt)))
  if (!event) throw new AppError('not_found')
  return event
}

export async function hostParticipant(event: EventRow, user: session.SessionUser): Promise<ParticipantRow> {
  const mine = and(eq(participants.eventId, event.id), eq(participants.userId, user.id))
  const [existing] = await db.select().from(participants).where(mine)
  if (existing) return existing
  await db
    .insert(participants)
    .values({ eventId: event.id, userId: user.id, name: firstCharacters(user.name.trim(), 40) })
    .onConflictDoNothing()
  return (await db.select().from(participants).where(mine))[0]!
}

/** The guest's record in this event, created on first sight. */
export async function guestParticipant(eventId: string, tokenHash: string, pinVersion: number): Promise<ParticipantRow> {
  const mine = and(eq(participants.eventId, eventId), eq(participants.tokenHash, tokenHash))
  const [existing] = await db.select().from(participants).where(mine)
  if (existing) return existing
  await db.insert(participants).values({ eventId, tokenHash, pinVersion }).onConflictDoNothing()
  return (await db.select().from(participants).where(mine))[0]!
}

/** Works out who is asking, for one event. */
export async function resolveViewer(by: { code: string } | { eventId: string }, req: { headers: Headers }): Promise<Resolved> {
  const event = await findEvent(by)
  const user = await session.getUser(req.headers)
  if (user && event.ownerId === user.id) {
    const me = await hostParticipant(event, user)
    return { event, me, tokenHash: null, viewer: { kind: 'host', eventId: event.id, participantId: me.id, userId: user.id } }
  }

  const tokenHash = guestTokenHash(req.headers)
  if (!tokenHash) throw new AppError('bad_input', 'Please allow cookies for this site, then reload the page.')
  if (event.pinHash) {
    const [known] = await db
      .select()
      .from(participants)
      .where(and(eq(participants.eventId, event.id), eq(participants.tokenHash, tokenHash)))
    if (!known || known.pinVersion !== event.pinVersion)
      return { event, tokenHash, me: null, viewer: { kind: 'locked', eventId: event.id } }
    return { event, tokenHash, me: known, viewer: { kind: 'guest', eventId: event.id, participantId: known.id } }
  }
  const me = await guestParticipant(event.id, tokenHash, event.pinVersion)
  return { event, tokenHash, me, viewer: { kind: 'guest', eventId: event.id, participantId: me.id } }
}

/** For host pages and routes: the event, only if this user owns it. */
export async function requireOwnedEvent(userId: string, eventId: string, o: { includeDeleted?: boolean } = {}): Promise<EventRow> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw new AppError('not_found')
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.ownerId, userId)))
  if (!event || (event.deletedAt && !o.includeDeleted)) throw new AppError('not_found')
  return event
}
