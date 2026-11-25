import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { events } from '@/db/schema'
import { AppError } from '@/lib/errors'
import { buildExport, failExport } from '@/modules/exports/build'
import { finishCover, type CoverResult } from '@/modules/events/cover'
import { makeDownload } from '@/modules/photos/downloads'
import { failPhoto, photoFiles, processPhoto } from '@/modules/photos/process'
import { keys, storage } from '@/modules/storage'
import type { Jobs } from './boss'

type Attempt = { retryCount: number; retryLimit: number }

export async function handleProcessJob({ photoId }: Jobs['photo.process'], { retryCount, retryLimit }: Attempt): Promise<void> {
  try {
    await processPhoto(photoId)
  } catch (err) {
    console.error(`Processing photo ${photoId} failed (try ${retryCount + 1})`, (err as Error).message)
    if (retryCount < retryLimit) throw err
    await failPhoto(photoId, 'internal')
  }
}

export async function handlePurgeJob({ eventId, photoId }: Jobs['photo.purge']): Promise<void> {
  await storage.delete([...photoFiles(eventId, photoId), keys.incoming(eventId, photoId)])
}

export async function handleExportJob({ exportId }: Jobs['export.build'], { retryCount, retryLimit }: Attempt): Promise<void> {
  try {
    await buildExport(exportId)
  } catch (err) {
    console.error(`Building export ${exportId} failed (try ${retryCount + 1})`, (err as Error).message)
    if (retryCount < retryLimit) throw err
    await failExport(exportId)
  }
}

export async function handleDownloadJob({ photoId }: Jobs['photo.download'], { retryCount, retryLimit }: Attempt): Promise<void> {
  try {
    await makeDownload(photoId)
  } catch (err) {
    console.error(`Making the download of ${photoId} failed (try ${retryCount + 1})`, (err as Error).message)
    if (retryCount < retryLimit) throw err
  }
}

/** A refused photo is an answer for the host, not a failed job. */
export async function handleCoverJob({ eventId, uploadId }: Jobs['cover.process']): Promise<CoverResult> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId))
  if (!event) return { ok: false, code: 'not_found' }
  try {
    await finishCover(event, uploadId)
    return { ok: true }
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code }
    throw err
  }
}
