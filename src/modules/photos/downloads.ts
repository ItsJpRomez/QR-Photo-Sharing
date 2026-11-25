import { eq } from 'drizzle-orm'
import { formatInTimeZone } from 'date-fns-tz'
import { db } from '@/db/client'
import { participants, photos, type EventRow, type PhotoRow } from '@/db/schema'
import { AppError } from '@/lib/errors'
import { requireCan } from '@/modules/access/can'
import type { PhotoFormat } from '@/modules/imaging/inspect'
import { renderDownload } from '@/modules/imaging/render'
import { keys, storage } from '@/modules/storage'
import { READY, visiblePhoto, type Unlocked } from './query'

const making = new Map<string, Promise<void>>()
let running = 0
const waiting: (() => void)[] = []

/** At most two full-size photos at a time, so a busy moment can't use up the server's memory. */
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((go) => waiting.push(go))
  running++
  try {
    return await work()
  } finally {
    running--
    waiting.shift()?.()
  }
}

async function makeDownload(event: EventRow, photo: PhotoRow): Promise<void> {
  await inTurn(async () => {
    const original = await storage.read(keys.original(event.id, photo.id, photo.ext!))
    const jpeg = await renderDownload(original, photo.mime!.replace('image/', '') as PhotoFormat)
    await storage.put(keys.download(event.id, photo.id), jpeg, 'image/jpeg')
    await db.update(photos).set({ downloadReady: true }).where(eq(photos.id, photo.id))
  })
}

async function ensureDownload(event: EventRow, photo: PhotoRow): Promise<void> {
  if (photo.downloadReady) return
  let job = making.get(photo.id)
  if (!job) {
    job = makeDownload(event, photo).finally(() => making.delete(photo.id))
    making.set(photo.id, job)
  }
  await job
}

async function fileName(event: EventRow, photo: PhotoRow, ext: string): Promise<string> {
  const [by] = await db.select({ name: participants.name }).from(participants).where(eq(participants.id, photo.participantId))
  const when = formatInTimeZone(photo.takenAt ?? new Date(), event.timeZone, 'yyyy-MM-dd_HHmmss')
  const who = (by?.name || 'Guest').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Guest'
  return `${when}_${who}.${ext}`
}

export async function downloadUrl(viewer: Unlocked, event: EventRow, photoId: string, o: { original?: boolean } = {}): Promise<string> {
  requireCan(viewer, o.original ? 'photo.original' : 'photo.download', { event })
  const photo = await visiblePhoto(viewer, event, photoId)
  if (!READY.includes(photo.status)) throw new AppError('not_found')
  if (o.original) {
    return storage.signGet(keys.original(event.id, photo.id, photo.ext!), { downloadName: await fileName(event, photo, photo.ext!) })
  }
  await ensureDownload(event, photo)
  return storage.signGet(keys.download(event.id, photo.id), { downloadName: await fileName(event, photo, 'jpg') })
}
