import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { config } from '@/config'
import { db, withTx, type Tx } from '@/db/client'
import { albums, events, hashtags, type EventRow, type EventSettings } from '@/db/schema'
import { AppError } from '@/lib/errors'
import { newEventCode, newToken } from '@/lib/ids'
import { eventInput, type EventInput, type EventPatch, type SettingsPatch } from './input'
import { ownAlbumId } from './albums'
import { setPin } from './pin'
import { parseTags } from './tag-text'
import { coverUrl } from './view'

/** Holds the host's event count steady for the rest of the transaction. */
export async function requireRoomForEvent(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`events:${userId}`}, 0))`)
  const [row] = await tx
    .select({ n: count() })
    .from(events)
    .where(and(eq(events.ownerId, userId), isNull(events.deletedAt)))
  if ((row?.n ?? 0) >= config.limits.eventsPerHost) throw new AppError('event_limit')
}

export function createEvent(userId: string, raw: Partial<EventInput>): Promise<EventRow> {
  const input = eventInput.parse(raw)
  return withTx(async (tx) => {
    await requireRoomForEvent(tx, userId)
    const [event] = await tx
      .insert(events)
      .values({
        ownerId: userId,
        code: newEventCode(),
        tvToken: newToken(),
        name: input.name,
        eventDate: input.eventDate,
        timeZone: input.timeZone,
        welcome: input.welcome,
        accent: input.accent,
        maxPhotos: config.limits.photosPerEvent,
        maxBytes: config.limits.bytesPerEvent,
      })
      .returning()
    const eventId = event!.id
    if (input.albums.length) await tx.insert(albums).values(input.albums.map((name, position) => ({ eventId, name, position })))
    const tags = input.tags.flatMap((t) => parseTags([t]))
    if (tags.length) await tx.insert(hashtags).values(tags.map((t) => ({ eventId, ...t, suggested: true }))).onConflictDoNothing()
    if (input.pin !== null) await setPin(tx, eventId, input.pin)
    return (await tx.select().from(events).where(eq(events.id, eventId)))[0]!
  })
}

async function update(eventId: string, set: Parameters<ReturnType<typeof db.update<typeof events>>['set']>[0]): Promise<EventRow> {
  const [row] = await db.update(events).set(set).where(eq(events.id, eventId)).returning()
  if (!row) throw new AppError('not_found')
  return row
}

export function updateEvent(eventId: string, patch: EventPatch): Promise<EventRow> {
  if (!Object.keys(patch).length) throw new AppError('bad_input')
  return update(eventId, patch)
}

export function updateSettings(eventId: string, patch: SettingsPatch): Promise<EventRow> {
  return withTx(async (tx) => {
    const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for('update')
    if (!event) throw new AppError('not_found')
    const { tv, ...rest } = patch
    const settings: EventSettings = { ...event.settings, ...rest, tv: { ...event.settings.tv, ...tv } }
    if (tv?.albumId && !(await ownAlbumId(tx, eventId, tv.albumId))) throw new AppError('bad_input')
    const [row] = await tx.update(events).set({ settings }).where(eq(events.id, eventId)).returning()
    return row!
  })
}

/** Freezing again keeps the original time, so the grace period can't be stretched. */
export function setFrozen(eventId: string, frozen: boolean): Promise<EventRow> {
  return update(eventId, { frozenAt: frozen ? sql`coalesce(${events.frozenAt}, now())` : null })
}

export const replaceCode = (eventId: string) => update(eventId, { code: newEventCode() })
export const replaceTvToken = (eventId: string) => update(eventId, { tvToken: newToken() })

export function listEvents(userId: string): Promise<EventRow[]> {
  return db.select().from(events).where(eq(events.ownerId, userId)).orderBy(desc(events.eventDate), desc(events.createdAt))
}

export type HostEventDto = Pick<
  EventRow,
  'id' | 'name' | 'eventDate' | 'timeZone' | 'welcome' | 'accent' | 'code' | 'settings' | 'usedPhotos' | 'usedBytes' | 'maxPhotos' | 'maxBytes'
> & { url: string; tvUrl: string; coverUrl: string | null; hasPin: boolean; frozen: boolean; deletedAt: string | null }

export async function hostEvent(e: EventRow): Promise<HostEventDto> {
  return {
    id: e.id,
    name: e.name,
    eventDate: e.eventDate,
    timeZone: e.timeZone,
    welcome: e.welcome,
    accent: e.accent,
    code: e.code,
    settings: e.settings,
    usedPhotos: e.usedPhotos,
    usedBytes: e.usedBytes,
    maxPhotos: e.maxPhotos,
    maxBytes: e.maxBytes,
    url: `${config.appUrl}/e/${e.code}`,
    tvUrl: `${config.appUrl}/tv/${e.tvToken}`,
    coverUrl: await coverUrl(e),
    hasPin: e.pinHash !== null,
    frozen: e.frozenAt !== null,
    deletedAt: e.deletedAt?.toISOString() ?? null,
  }
}
