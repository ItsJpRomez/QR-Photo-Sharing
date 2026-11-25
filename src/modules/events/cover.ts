import { eq } from 'drizzle-orm'
import { config } from '@/config'
import { db } from '@/db/client'
import { events, type EventRow } from '@/db/schema'
import { AppError } from '@/lib/errors'
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

export async function finishCover(event: EventRow, uploadId: string): Promise<EventRow> {
  if (!/^cover-[0-9a-f-]{36}$/.test(uploadId)) throw new AppError('bad_input')
  const incoming = keys.incoming(event.id, uploadId)
  const file = await storage.head(incoming)
  if (!file) throw new AppError('bad_input', "The photo didn't arrive. Please try again.")
  try {
    if (file.size > config.limits.maxPhotoBytes) throw new AppError('too_large')
    const buf = await storage.read(incoming)
    const { display } = await render(buf, (await inspect(buf)).format)
    return await replaceCover(event, display)
  } finally {
    await storage.delete([incoming])
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
