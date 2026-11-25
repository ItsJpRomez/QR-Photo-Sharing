import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '@/config'
import { db, withTx, type Tx } from '@/db/client'
import { events, participants, photoContributors, photos, type EventRow, type PhotoRow } from '@/db/schema'
import { enqueue } from '@/jobs/boss'
import { AppError } from '@/lib/errors'
import { hitLimit } from '@/lib/rate-limit'
import { personName } from '@/lib/text'
import { requireCan, type Viewer } from '@/modules/access/can'
import { ownAlbumId } from '@/modules/events/albums'
import { attachTags } from '@/modules/events/tags'
import { parseTags } from '@/modules/events/tag-text'
import { keys, storage } from '@/modules/storage'
import { COUNTED, releaseQuota, transition } from './lifecycle'

export type UploadState =
  | 'reserved'
  | 'processing'
  | 'live'
  | 'pending'
  | 'already_added'
  | 'received'
  | 'failed'
  | 'expired'
  | 'removed_by_host'

export type Unlocked = Exclude<Viewer, { kind: 'locked' }>
type PutLink = { url: string; headers: Record<string, string> }
export type Reservation = { photoId: string; state: UploadState; reason: string | null; put?: PutLink }

export const reserveInput = z.object({
  clientId: z.uuid(),
  size: z.number().int().positive(),
  mime: z.string().max(100),
  albumId: z.uuid().nullish(),
  tags: z.array(z.string().max(100)).max(50).default([]),
  name: personName.optional(),
})
export type ReserveInput = z.input<typeof reserveInput>

const GRACE_MS = 10 * 60 * 1000
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif'])
export const uploadType = (mime: string) => (PHOTO_TYPES.has(mime) ? mime : 'application/octet-stream')

function putLink(photo: PhotoRow): Promise<PutLink> {
  return storage.signPut({
    key: keys.incoming(photo.eventId, photo.id),
    size: photo.sizeBytes,
    contentType: uploadType(photo.mime ?? ''),
  })
}

function failureState(code: string | null): UploadState {
  return code === 'removed_by_host' ? 'removed_by_host' : 'failed'
}

/** How a photo's progress looks to the guest who sent it. Never reveals moderation of someone else's copy. */
async function stateFor(viewer: Unlocked, photo: PhotoRow): Promise<UploadState> {
  switch (photo.status) {
    case 'reserved':
    case 'pending':
    case 'live':
    case 'expired':
      return photo.status
    case 'uploaded':
    case 'processing':
      return 'processing'
    case 'hidden':
      return 'live'
    case 'failed':
      return failureState(photo.failureCode)
    case 'deleted':
      return photo.deletedBy === 'host' ? 'removed_by_host' : 'live'
    case 'duplicate': {
      const [first] = photo.duplicateOf
        ? await db.select({ by: photos.participantId }).from(photos).where(eq(photos.id, photo.duplicateOf))
        : []
      return first?.by === viewer.participantId ? 'already_added' : 'received'
    }
  }
}

async function describe(viewer: Unlocked, photo: PhotoRow): Promise<Reservation> {
  return {
    photoId: photo.id,
    state: await stateFor(viewer, photo),
    reason: photo.status === 'failed' ? photo.failureCode : null,
    put: photo.status === 'reserved' ? await putLink(photo) : undefined,
  }
}

function inGrace(event: EventRow, photo: PhotoRow, now: Date): boolean {
  return event.frozenAt !== null && photo.reservedAt <= event.frozenAt && now.getTime() <= event.frozenAt.getTime() + GRACE_MS
}

function requireUploadOrGrace(viewer: Viewer, event: EventRow, photo: PhotoRow, now: Date): void {
  if (viewer.kind === 'guest' && inGrace(event, photo, now)) requireCan(viewer, 'gallery.view', { event })
  else requireCan(viewer, 'photo.upload', { event })
}

/** Takes room for one photo, or refuses. Holding the event row also makes the checks below exact. */
async function takeRoom(tx: Tx, viewer: Unlocked, eventId: string, size: number): Promise<void> {
  const [event] = await tx
    .update(events)
    .set({ usedPhotos: sql`${events.usedPhotos} + 1`, usedBytes: sql`${events.usedBytes} + ${size}` })
    .where(
      and(
        eq(events.id, eventId),
        sql`${events.usedPhotos} + 1 <= ${events.maxPhotos}`,
        sql`${events.usedBytes} + ${size} <= ${events.maxBytes}`,
      ),
    )
    .returning()
  if (!event) throw new AppError('gallery_full')
  // The event may have been frozen since it was first read.
  requireCan(viewer, 'photo.upload', { event })
  if (viewer.kind === 'host') return
  const [mine] = await tx
    .select({ n: count() })
    .from(photos)
    .where(and(eq(photos.eventId, eventId), eq(photos.participantId, viewer.participantId), inArray(photos.status, COUNTED)))
  if ((mine?.n ?? 0) >= config.limits.photosPerGuest) throw new AppError('guest_limit')
}

async function findByClientId(eventId: string, clientId: string): Promise<PhotoRow | undefined> {
  const [row] = await db
    .select()
    .from(photos)
    .where(and(eq(photos.eventId, eventId), eq(photos.clientId, clientId)))
  return row
}

/** The phone asked before under this id: carry on from wherever that got to. */
async function resume(viewer: Unlocked, event: EventRow, photo: PhotoRow, size: number): Promise<Reservation> {
  if (photo.participantId !== viewer.participantId || photo.sizeBytes !== size) throw new AppError('conflict')
  if (photo.status === 'reserved') {
    requireUploadOrGrace(viewer, event, photo, new Date())
    return describe(viewer, photo)
  }
  const tryAgain = photo.status === 'expired' || (photo.status === 'failed' && photo.failureCode !== 'removed_by_host')
  if (!tryAgain) return describe(viewer, photo)

  requireCan(viewer, 'photo.upload', { event })
  await withTx(async (tx) => {
    await takeRoom(tx, viewer, event.id, size)
    const taken = await transition(tx, photo.id, [photo.status], 'reserved', {
      reservedAt: new Date(),
      uploadedAt: null,
      failureCode: null,
      sha256: null,
    })
    if (!taken) throw new AppError('conflict')
  })
  return describe(viewer, (await findByClientId(event.id, photo.clientId))!)
}

export async function reserveUpload(viewer: Unlocked, event: EventRow, raw: ReserveInput): Promise<Reservation> {
  const input = reserveInput.parse(raw)
  if (input.size > config.limits.maxPhotoBytes) throw new AppError('too_large')

  const known = await findByClientId(event.id, input.clientId)
  if (known) return resume(viewer, event, known, input.size)

  requireCan(viewer, 'photo.upload', { event })
  const { reservationsPerMinute } = config.limits
  if (viewer.kind === 'guest' && !(await hitLimit(`reserve:${viewer.participantId}`, reservationsPerMinute, 60)))
    throw new AppError('rate_limited')

  const created = await withTx(async (tx) => {
    await takeRoom(tx, viewer, event.id, input.size)
    const [photo] = await tx
      .insert(photos)
      .values({
        eventId: event.id,
        participantId: viewer.participantId,
        clientId: input.clientId,
        sizeBytes: input.size,
        mime: uploadType(input.mime),
        // An album deleted while this photo was queued must not cost the guest the photo.
        albumId: await ownAlbumId(tx, event.id, input.albumId),
      })
      .onConflictDoNothing({ target: [photos.eventId, photos.clientId] })
      .returning()
    if (!photo) return tx.rollback()
    await tx.insert(photoContributors).values({ photoId: photo.id, participantId: viewer.participantId })
    await attachTags(tx, event.id, photo.id, parseTags(input.tags))
    if (input.name) await tx.update(participants).set({ name: input.name }).where(eq(participants.id, viewer.participantId))
    return photo
  }).catch(async (err: unknown) => {
    // The same request arrived twice at once, and the other one won.
    const other = await findByClientId(event.id, input.clientId)
    if (other) return resume(viewer, event, other, input.size)
    throw err
  })
  return 'photoId' in created ? created : describe(viewer, created)
}

async function ownPhoto(viewer: Unlocked, event: EventRow, photoId: string): Promise<PhotoRow> {
  const [photo] = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.eventId, event.id), eq(photos.participantId, viewer.participantId)))
  if (!photo || viewer.eventId !== event.id) throw new AppError('not_found')
  return photo
}

export async function completeUpload(viewer: Unlocked, event: EventRow, photoId: string, now = new Date()): Promise<Reservation> {
  const photo = await ownPhoto(viewer, event, photoId)
  if (photo.status !== 'reserved') return describe(viewer, photo)
  requireUploadOrGrace(viewer, event, photo, now)

  const file = await storage.head(keys.incoming(event.id, photo.id))
  if (file?.size !== photo.sizeBytes) throw new AppError('bad_input', "The photo didn't arrive in full. Please try again.")
  await withTx(async (tx) => {
    if (await transition(tx, photo.id, ['reserved'], 'uploaded', { uploadedAt: now }))
      await enqueue(tx, 'photo.process', { photoId: photo.id })
  })
  return describe(viewer, await ownPhoto(viewer, event, photoId))
}

export async function uploadStates(viewer: Unlocked, event: EventRow, photoIds: string[]) {
  if (!photoIds.length) return []
  const rows = await db
    .select()
    .from(photos)
    .where(
      and(
        eq(photos.eventId, event.id),
        inArray(photos.id, photoIds),
        sql`(${photos.participantId} = ${viewer.participantId} or exists (
          select 1 from ${photoContributors}
          where ${photoContributors.photoId} = ${photos.id} and ${photoContributors.participantId} = ${viewer.participantId}))`,
      ),
    )
  return Promise.all(
    rows.map(async (p) => ({
      photoId: p.id,
      state: await stateFor(viewer, p),
      reason: p.status === 'failed' ? p.failureCode : null,
    })),
  )
}

/** A reservation nobody finished. Its room goes back to the event. */
export async function expireReservation(photoId: string): Promise<void> {
  const expired = await withTx(async (tx) => {
    const [photo] = await tx.select().from(photos).where(eq(photos.id, photoId)).for('update')
    if (!photo || !(await transition(tx, photoId, ['reserved'], 'expired'))) return null
    await releaseQuota(tx, photo)
    return photo
  })
  if (expired) await storage.delete([keys.incoming(expired.eventId, expired.id)])
}
