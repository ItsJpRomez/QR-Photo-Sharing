import fs from 'node:fs'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { events, photos, type EventRow } from '@/db/schema'
import type { Viewer } from '@/modules/access/can'
import { processPhoto } from '@/modules/photos/process'
import { completeUpload, reserveUpload, type ReserveInput } from '@/modules/photos/uploads'
import { keys, storage } from '@/modules/storage'

export type Unlocked = Exclude<Viewer, { kind: 'locked' }>

export const fixture = (name: string) => fs.readFileSync(`tests/fixtures/${name}`)
export const asGuest = (eventId: string, participantId: string): Unlocked => ({ kind: 'guest', eventId, participantId })
export const fresh = async (e: EventRow) => (await db.select().from(events).where(eq(events.id, e.id)))[0]!
export const photoRow = async (id: string) => (await db.select().from(photos).where(eq(photos.id, id)))[0]!

/** A different photo each time, unless told otherwise. */
export async function uniqueJpeg(seed = Math.random()): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  const n = Math.floor(seed * 0xffffff)
  return sharp({ create: { width: 320, height: 240, channels: 3, background: { r: n >> 16, g: (n >> 8) & 255, b: n & 255 } } })
    .withExifMerge({ IFD0: { ImageDescription: String(seed) } })
    .jpeg()
    .toBuffer()
}

export const reserve = (viewer: Unlocked, event: EventRow, buf: Buffer, over: Partial<ReserveInput> = {}) =>
  reserveUpload(viewer, event, { clientId: crypto.randomUUID(), size: buf.length, mime: 'image/jpeg', tags: [], ...over })

/** Reserve, send and complete, like a phone does. */
export async function send(viewer: Unlocked, event: EventRow, buf: Buffer, over: Partial<ReserveInput> = {}) {
  const r = await reserve(viewer, event, buf, over)
  await storage.put(keys.incoming(event.id, r.photoId), buf, 'image/jpeg')
  await completeUpload(viewer, event, r.photoId)
  return r.photoId
}

export async function upload(viewer: Unlocked, event: EventRow, buf: Buffer, over: Partial<ReserveInput> = {}) {
  const id = await send(viewer, event, buf, over)
  await processPhoto(id)
  return photoRow(id)
}
