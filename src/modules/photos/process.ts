import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, withTx, type Tx } from '@/db/client'
import { events, participants, photoContributors, photos, type EventRow, type PhotoRow } from '@/db/schema'
import { AppError } from '@/lib/errors'
import { sha256Hex } from '@/lib/ids'
import { inspect } from '@/modules/imaging/inspect'
import { render } from '@/modules/imaging/render'
import { resolveTakenAt } from '@/modules/imaging/taken-at'
import { keys, storage } from '@/modules/storage'
import { releaseQuota, transition } from './lifecycle'

/** Every file a finished photo owns. */
export function photoFiles(eventId: string, photoId: string): string[] {
  const originals = ['jpg', 'png', 'webp', 'heic', 'avif'].map((ext) => keys.original(eventId, photoId, ext))
  return [...originals, keys.thumb(eventId, photoId), keys.display(eventId, photoId), keys.download(eventId, photoId)]
}

async function load(photoId: string): Promise<{ photo: PhotoRow; event: EventRow } | undefined> {
  const [row] = await db
    .select({ photo: photos, event: events })
    .from(photos)
    .innerJoin(events, eq(events.id, photos.eventId))
    .where(eq(photos.id, photoId))
  return row
}

export async function failPhoto(photoId: string, failureCode: string): Promise<void> {
  const failed = await withTx(async (tx) => {
    const [photo] = await tx.select().from(photos).where(eq(photos.id, photoId)).for('update')
    if (!photo || (photo.status !== 'processing' && photo.status !== 'uploaded')) return null
    await transition(tx, photoId, [photo.status], 'failed', { failureCode })
    await releaseQuota(tx, photo)
    return photo
  })
  // When the fault is ours the sent file stays until cleanup, so nothing is lost by a retry.
  if (failed && failureCode !== 'internal') await storage.delete([keys.incoming(failed.eventId, failed.id)])
}

type Outcome = 'published' | 'duplicate' | 'removed_by_host' | 'gone' | 'done_elsewhere'

/** Another photo in this event with the same bytes, if there is one. */
async function sameBytes(tx: Tx, photo: PhotoRow, sha256: string) {
  const same = await tx
    .select({ id: photos.id, status: photos.status, deletedBy: photos.deletedBy })
    .from(photos)
    .where(and(eq(photos.eventId, photo.eventId), eq(photos.sha256, sha256), inArray(photos.status, ['pending', 'live', 'hidden', 'deleted'])))
  return {
    kept: same.find((p) => p.status !== 'deleted' && p.id !== photo.id),
    removedByHost: same.some((p) => p.status === 'deleted' && p.deletedBy === 'host'),
  }
}

async function isFromHost(tx: Tx, photo: PhotoRow, event: EventRow): Promise<boolean> {
  const [p] = await tx.select({ userId: participants.userId }).from(participants).where(eq(participants.id, photo.participantId))
  return p?.userId != null && p.userId === event.ownerId
}

/**
 * Checks a sent photo, makes its screen copies and publishes it. Safe to run
 * again at any point: files are written under fixed names, and the database
 * decides the outcome in one step at the end.
 */
export async function processPhoto(photoId: string): Promise<void> {
  const loaded = await load(photoId)
  if (!loaded) return
  const { photo, event } = loaded
  if (photo.status === 'uploaded') await transition(db, photoId, ['uploaded'], 'processing')
  else if (photo.status !== 'processing') return

  const buf = await storage.read(keys.incoming(event.id, photoId))
  const prepared = await prepare(buf).catch((err: unknown) => {
    if (err instanceof AppError && err.code === 'bad_type') return null
    throw err
  })
  if (!prepared) return failPhoto(photoId, 'bad_type')
  const { info, copies } = prepared
  const sha256 = sha256Hex(buf)

  // These exact checked bytes become the original. The incoming file, which an
  // old upload link could still overwrite, is never used again.
  await storage.put(keys.original(event.id, photoId, info.ext), buf, info.mime)
  await storage.put(keys.thumb(event.id, photoId), copies.thumb, 'image/webp')
  await storage.put(keys.display(event.id, photoId), copies.display, 'image/webp')

  const outcome = await withTx<Outcome>(async (tx) => {
    // One at a time for identical bytes, so two guests sending the same photo can't both publish it.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`hash:${event.id}:${sha256}`}, 0))`)
    const [now] = await tx.select().from(photos).where(eq(photos.id, photoId)).for('update')
    if (!now || now.status === 'deleted') return 'gone'
    if (now.status !== 'processing') return 'done_elsewhere'

    const { kept, removedByHost } = await sameBytes(tx, now, sha256)
    if (kept) {
      await tx.insert(photoContributors).values({ photoId: kept.id, participantId: now.participantId }).onConflictDoNothing()
      await transition(tx, photoId, ['processing'], 'duplicate', { duplicateOf: kept.id, sha256 })
      await releaseQuota(tx, now)
      return 'duplicate'
    }
    if (removedByHost) {
      await transition(tx, photoId, ['processing'], 'failed', { failureCode: 'removed_by_host' })
      await releaseQuota(tx, now)
      return 'removed_by_host'
    }

    const [current] = await tx.select().from(events).where(eq(events.id, event.id))
    const waits = current!.settings.approval && !(await isFromHost(tx, now, current!))
    await transition(tx, photoId, ['processing'], waits ? 'pending' : 'live', {
      sha256,
      mime: info.mime,
      ext: info.ext,
      width: copies.width,
      height: copies.height,
      thumbhash: copies.thumbhash,
      takenAt: resolveTakenAt({ ...info, timeZone: event.timeZone, uploadedAt: now.uploadedAt ?? new Date() }),
      publishedAt: waits ? null : new Date(),
    })
    return 'published'
  })

  if (outcome === 'duplicate' || outcome === 'removed_by_host' || outcome === 'gone') await storage.delete(photoFiles(event.id, photoId))
  await storage.delete([keys.incoming(event.id, photoId)])
}

async function prepare(buf: Buffer) {
  const info = await inspect(buf)
  return { info, copies: await render(buf, info.format) }
}
