import { eq } from 'drizzle-orm'
import { config } from '@/config'
import { db } from '@/db/client'
import { events, type EventRow } from '@/db/schema'
import { enqueueOnce, getBoss, type Jobs } from '@/jobs/boss'
import { AppError, errorMessage, type ErrorCode } from '@/lib/errors'
import { inspect } from '@/modules/imaging/inspect'
import { render } from '@/modules/imaging/render'
import { publish } from '@/modules/live/publish'
import { uploadType } from '@/modules/photos/uploads'
import { keys, storage } from '@/modules/storage'

export async function createCoverUpload(event: EventRow, o: { size: number; mime: string }) {
  if (o.size > config.limits.maxPhotoBytes) throw new AppError('too_large')
  const uploadId = `cover-${crypto.randomUUID()}`
  const put = await storage.signPut({ key: keys.incoming(event.id, uploadId), size: o.size, contentType: uploadType(o.mime) })
  return { uploadId, put }
}

function checkUploadId(uploadId: string): string {
  if (!/^cover-[0-9a-f-]{36}$/.test(uploadId)) throw new AppError('bad_input')
  return uploadId
}

/** Hands the photo to the worker. The answer comes through `coverState`. */
export async function queueCover(event: EventRow, uploadId: string): Promise<string> {
  const file = await storage.head(keys.incoming(event.id, checkUploadId(uploadId)))
  if (!file) throw new AppError('bad_input', "The photo didn't arrive. Please try again.")
  const job = await enqueueOnce('cover.process', { eventId: event.id, uploadId }, uploadId)
  if (!job) throw new AppError('conflict')
  return job
}

export type CoverState = { state: 'working' } | { state: 'done' } | { state: 'failed'; message: string }

export async function coverState(event: EventRow, jobId: string): Promise<CoverState> {
  const job = await (await getBoss()).findJobs<Jobs['cover.process']>('cover.process', { id: jobId }).then((all) => all[0])
  if (!job || job.data.eventId !== event.id) throw new AppError('not_found')
  if (job.state === 'failed' || job.state === 'cancelled') return { state: 'failed', message: errorMessage('internal') }
  if (job.state !== 'completed') return { state: 'working' }
  const result = job.output as CoverResult
  return result.ok ? { state: 'done' } : { state: 'failed', message: errorMessage(result.code) }
}

export type CoverResult = { ok: true } | { ok: false; code: ErrorCode }

export async function finishCover(event: EventRow, uploadId: string): Promise<EventRow> {
  const incoming = keys.incoming(event.id, checkUploadId(uploadId))
  const file = await storage.head(incoming)
  if (!file) throw new AppError('bad_input', "The photo didn't arrive. Please try again.")
  let keep = false
  try {
    if (file.size > config.limits.maxPhotoBytes) throw new AppError('too_large')
    const buf = await storage.read(incoming)
    const { display } = await render(buf, (await inspect(buf)).format)
    return await replaceCover(event, display)
  } catch (err) {
    keep = !(err instanceof AppError)
    throw err
  } finally {
    if (!keep) await storage.delete([incoming])
  }
}

async function replaceCover(event: EventRow, image: Buffer | null): Promise<EventRow> {
  const key = image ? keys.cover(event.id, crypto.randomUUID()) : null
  if (key && image) await storage.put(key, image, 'image/webp')
  const [row] = await db.update(events).set({ coverKey: key }).where(eq(events.id, event.id)).returning()
  await publish(db, { eventId: event.id, type: 'event', ids: [], audience: 'everyone' })
  if (event.coverKey) await storage.delete([event.coverKey])
  return row!
}

export const removeCover = (event: EventRow) => replaceCover(event, null)
