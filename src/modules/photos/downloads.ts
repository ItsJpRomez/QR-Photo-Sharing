import { and, eq, inArray } from 'drizzle-orm'
import { formatInTimeZone } from 'date-fns-tz'
import { db } from '@/db/client'
import { participants, photos, type EventRow, type PhotoRow } from '@/db/schema'
import { enqueueOnce } from '@/jobs/boss'
import { AppError } from '@/lib/errors'
import { requireCan } from '@/modules/access/can'
import type { PhotoFormat } from '@/modules/imaging/inspect'
import { renderDownload } from '@/modules/imaging/render'
import { keys, storage } from '@/modules/storage'
import { READY, visiblePhoto, type Unlocked } from './query'

/** Runs in the worker, where a huge photo can't disturb the site. */
export async function makeDownload(photoId: string): Promise<void> {
  const [photo] = await db.select().from(photos).where(eq(photos.id, photoId))
  if (!photo || photo.downloadReady || !READY.includes(photo.status)) return
  const original = await storage.read(keys.original(photo.eventId, photo.id, photo.ext!))
  const jpeg = await renderDownload(original, photo.mime!.replace('image/', '') as PhotoFormat)
  await storage.put(keys.download(photo.eventId, photo.id), jpeg, 'image/jpeg')
  const [kept] = await db
    .update(photos)
    .set({ downloadReady: true })
    .where(and(eq(photos.id, photoId), inArray(photos.status, READY)))
    .returning({ id: photos.id })
  if (!kept) await storage.delete([keys.download(photo.eventId, photo.id)]) // deleted meanwhile
}

async function fileName(event: EventRow, photo: PhotoRow, ext: string): Promise<string> {
  const [by] = await db.select({ name: participants.name }).from(participants).where(eq(participants.id, photo.participantId))
  const when = formatInTimeZone(photo.takenAt ?? new Date(), event.timeZone, 'yyyy-MM-dd_HHmmss')
  const who = (by?.name || 'Guest').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Guest'
  return `${when}_${who}.${ext}`
}

/** A link to save a photo. Null while the worker is still making the copy: ask again shortly. */
export async function downloadUrl(
  viewer: Unlocked,
  event: EventRow,
  photoId: string,
  o: { original?: boolean } = {},
): Promise<{ url: string | null }> {
  requireCan(viewer, o.original ? 'photo.original' : 'photo.download', { event })
  const photo = await visiblePhoto(viewer, event, photoId)
  if (!READY.includes(photo.status)) throw new AppError('not_found')
  if (o.original) {
    return { url: await storage.signGet(keys.original(event.id, photo.id, photo.ext!), { downloadName: await fileName(event, photo, photo.ext!) }) }
  }
  if (!photo.downloadReady) {
    await enqueueOnce('photo.download', { photoId: photo.id }, photo.id)
    return { url: null }
  }
  return { url: await storage.signGet(keys.download(event.id, photo.id), { downloadName: await fileName(event, photo, 'jpg') }) }
}
