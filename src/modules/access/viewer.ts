import { and, eq, isNull } from 'drizzle-orm'
import * as session from '@/auth/session'
import { db, type Executor } from '@/db/client'
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

/** The same guest in the same event always gets the same id, so looking around needs no record. */
function guestId(eventId: string, tokenHash: string): string {
  const h = sha256Hex(`guest:${eventId}:${tokenHash}`)
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

async function findGuest(tx: Executor, eventId: string, tokenHash: string): Promise<ParticipantRow | undefined> {
  const [row] = await tx
    .select()
    .from(participants)
    .where(and(eq(participants.eventId, eventId), eq(participants.tokenHash, tokenHash)))
  return row
}

/** Puts a guest on record. Called before they leave anything behind: a photo, heart, comment or name. */
export async function ensureParticipant(tx: Executor, viewer: Viewer, event: Pick<EventRow, 'id' | 'pinVersion'>): Promise<void> {
  if (viewer.kind !== 'guest' || !viewer.tokenHash) return
  await tx
    .insert(participants)
    .values({ id: viewer.participantId, eventId: event.id, tokenHash: viewer.tokenHash, pinVersion: event.pinVersion })
    .onConflictDoNothing()
}

/** Puts a guest on record as having the right PIN. */
export async function unlockGuest(eventId: string, tokenHash: string, pinVersion: number): Promise<void> {
  await db
    .insert(participants)
    .values({ id: guestId(eventId, tokenHash), eventId, tokenHash, pinVersion })
    .onConflictDoUpdate({ target: [participants.eventId, participants.tokenHash], set: { pinVersion } })
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
  const known = await findGuest(db, event.id, tokenHash)
  if (event.pinHash && known?.pinVersion !== event.pinVersion)
    return { event, tokenHash, me: null, viewer: { kind: 'locked', eventId: event.id } }
  if (known) return { event, tokenHash, me: known, viewer: { kind: 'guest', eventId: event.id, participantId: known.id } }
  const id = guestId(event.id, tokenHash)
  const me: ParticipantRow = { id, eventId: event.id, tokenHash, userId: null, name: '', pinVersion: event.pinVersion, createdAt: new Date() }
  return { event, tokenHash, me, viewer: { kind: 'guest', eventId: event.id, participantId: id, tokenHash } }
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
