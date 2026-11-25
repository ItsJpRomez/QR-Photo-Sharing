import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { albums, events, participants, photos, type EventRow } from '@/db/schema'
import { decrypt, encrypt } from '@/lib/crypto'
import { AppError } from '@/lib/errors'
import { MAX_SLIDES, type TvPhoto } from '@/features/tv/slides'
import { ownAlbumId } from '@/modules/events/albums'
import { pinMatches } from '@/modules/events/pin'
import { publish } from '@/modules/live/publish'
import { eventUrl, qrSvg } from '@/modules/signs/qr'
import { keys, storage } from '@/modules/storage'

export type TvDto = {
  name: string
  accent: string
  seconds: number
  qr: string | null
  pin: string | null
  photos: TvPhoto[]
}

export async function eventByTvToken(token: string): Promise<EventRow> {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.tvToken, token), isNull(events.deletedAt)))
  if (!event) throw new AppError('not_found')
  return event
}

/** What the venue screen may show: live photos, from the chosen album if there is one. */
async function tvPhotos(event: EventRow, ids?: string[]): Promise<TvPhoto[]> {
  const { tv } = event.settings
  const album = await ownAlbumId(db, event.id, tv.albumId)
  const rows = await db
    .select({ id: photos.id, uploader: participants.name, album: albums.name })
    .from(photos)
    .innerJoin(participants, eq(participants.id, photos.participantId))
    .leftJoin(albums, eq(albums.id, photos.albumId))
    .where(
      and(
        eq(photos.eventId, event.id),
        eq(photos.status, 'live'),
        album ? eq(photos.albumId, album) : undefined,
        ids ? inArray(photos.id, ids) : undefined,
      ),
    )
    .orderBy(desc(photos.publishedAt), desc(photos.id))
    .limit(MAX_SLIDES)
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      displayUrl: await storage.signGet(keys.display(event.id, r.id)),
      uploader: tv.showNames ? r.uploader || 'Guest' : null,
      album: r.album,
    })),
  )
}

const purpose = (eventId: string) => `tv-pin:${eventId}`

export async function tvView(event: EventRow): Promise<TvDto> {
  const { tv } = event.settings
  return {
    name: event.name,
    accent: event.accent,
    seconds: tv.seconds,
    qr: tv.showQr ? qrSvg(eventUrl(event.code), { dark: event.accent }) : null,
    pin: tv.showPin && event.pinHash && event.tvPinEncrypted ? decrypt(event.tvPinEncrypted, purpose(event.id)) : null,
    photos: await tvPhotos(event),
  }
}

export async function tvPhotosById(event: EventRow, ids: string[]): Promise<{ photos: TvPhoto[]; gone: string[] }> {
  const found = ids.length ? await tvPhotos(event, ids) : []
  const here = new Set(found.map((p) => p.id))
  return { photos: found, gone: ids.filter((id) => !here.has(id)) }
}

/** Shows the PIN on the TV, which needs a readable copy of it, or erases that copy. */
export async function setTvPin(event: EventRow, change: { show: true; pin: string } | { show: false }): Promise<EventRow> {
  if (change.show && !pinMatches(event, change.pin)) throw new AppError('bad_input', "That isn't this event's PIN.")
  const settings = { ...event.settings, tv: { ...event.settings.tv, showPin: change.show } }
  const [row] = await db
    .update(events)
    .set({ settings, tvPinEncrypted: change.show ? encrypt(change.pin, purpose(event.id)) : null })
    // If the PIN changed at this very moment, the copy would be of the old one.
    .where(and(eq(events.id, event.id), eq(events.pinVersion, event.pinVersion)))
    .returning()
  if (!row) throw new AppError('conflict')
  await publish(db, { eventId: event.id, type: 'event', ids: [], audience: 'everyone' })
  return row
}
