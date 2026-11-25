import { buildExport, failExport } from '@/modules/exports/build'
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
