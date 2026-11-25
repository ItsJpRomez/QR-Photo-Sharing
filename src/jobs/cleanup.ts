import { and, eq, gt, inArray, lt } from 'drizzle-orm'
import { db } from '@/db/client'
import { events, exports, photos, rateLimits } from '@/db/schema'
import { expireExports, failExport } from '@/modules/exports/build'
import { failPhoto } from '@/modules/photos/process'
import { expireReservation } from '@/modules/photos/uploads'
import { keys, storage } from '@/modules/storage'

const HOUR = 3600_000
const DAY = 24 * HOUR
export const UNDO_MS = 7 * DAY

/** Upload links last 15 minutes, so after an hour nothing is coming. A phone that returns reserves again. */
async function unfinishedUploads(now: Date): Promise<void> {
  const old = await db
    .select({ id: photos.id })
    .from(photos)
    .where(and(eq(photos.status, 'reserved'), lt(photos.reservedAt, new Date(now.getTime() - HOUR))))
  for (const p of old) await expireReservation(p.id)
}

/** Photos whose job was lost. Failing them tells the sender, whose phone still has the file. */
async function stuckPhotos(now: Date): Promise<void> {
  const stuck = await db
    .select({ id: photos.id })
    .from(photos)
    .where(and(inArray(photos.status, ['uploaded', 'processing']), lt(photos.uploadedAt, new Date(now.getTime() - 2 * HOUR))))
  for (const p of stuck) await failPhoto(p.id, 'internal')
}

/** Files kept after a failure of ours, once there has been a day to retry. */
async function failedUploads(now: Date): Promise<void> {
  const between = (ms: number) => new Date(now.getTime() - ms)
  const failed = await db
    .select({ id: photos.id, eventId: photos.eventId })
    .from(photos)
    .where(and(eq(photos.status, 'failed'), lt(photos.reservedAt, between(DAY)), gt(photos.reservedAt, between(3 * DAY))))
  await storage.delete(failed.map((p) => keys.incoming(p.eventId, p.id)))
}

async function oldExports(now: Date): Promise<void> {
  await expireExports(now)
  const lost = await db
    .select({ id: exports.id })
    .from(exports)
    .where(and(inArray(exports.status, ['queued', 'running']), lt(exports.requestedAt, new Date(now.getTime() - DAY))))
  for (const x of lost) await failExport(x.id)
}

/** Files first, then the records: if it stops half way, next time finishes it. */
async function deletedEvents(now: Date): Promise<void> {
  const old = await db
    .select({ id: events.id })
    .from(events)
    .where(lt(events.deletedAt, new Date(now.getTime() - UNDO_MS)))
  for (const e of old) {
    await storage.deletePrefix(keys.event(e.id))
    await db.delete(events).where(and(eq(events.id, e.id), lt(events.deletedAt, new Date(now.getTime() - UNDO_MS))))
  }
}

async function oldCounters(now: Date): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - DAY)))
}

/** Everything that happens by itself. Each part runs even if another fails. */
export async function runCleanup(now: Date): Promise<void> {
  for (const step of [unfinishedUploads, stuckPhotos, failedUploads, oldExports, deletedEvents, oldCounters]) {
    try {
      await step(now)
    } catch (err) {
      console.error(`Cleanup step ${step.name} failed`, (err as Error).message)
    }
  }
}
