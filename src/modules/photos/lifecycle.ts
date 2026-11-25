import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Executor, Tx } from '@/db/client'
import { events, photos, type PhotoRow, type PhotoStatus } from '@/db/schema'

const NEXT: Record<PhotoStatus, readonly PhotoStatus[]> = {
  reserved: ['uploaded', 'expired', 'deleted'],
  uploaded: ['processing', 'failed', 'deleted'],
  processing: ['pending', 'live', 'failed', 'duplicate', 'deleted'],
  pending: ['live', 'hidden', 'deleted'],
  live: ['hidden', 'deleted'],
  hidden: ['live', 'deleted'],
  // A guest's phone may try a lost photo again under the same id.
  failed: ['reserved', 'deleted'],
  expired: ['reserved', 'deleted'],
  duplicate: ['deleted'],
  deleted: [],
}

/** Photos in these states take up room in the event. */
export const COUNTED: PhotoStatus[] = ['reserved', 'uploaded', 'processing', 'pending', 'live', 'hidden']

export function allowed(from: PhotoStatus, to: PhotoStatus): boolean {
  return NEXT[from].includes(to)
}

/** Moves a photo along, only from one of the given states. False when something else got there first. */
export async function transition(
  tx: Executor,
  photoId: string,
  from: PhotoStatus[],
  to: PhotoStatus,
  also: Partial<typeof photos.$inferInsert> = {},
): Promise<boolean> {
  for (const f of from) if (!allowed(f, to)) throw new Error(`A photo can't go from ${f} to ${to}`)
  const rows = await tx
    .update(photos)
    .set({ ...also, status: to })
    .where(and(eq(photos.id, photoId), inArray(photos.status, from)))
    .returning({ id: photos.id })
  return rows.length > 0
}

/** Gives a photo's room back. Call once, in the transaction that takes it out of COUNTED. */
export async function releaseQuota(tx: Tx, photo: Pick<PhotoRow, 'eventId' | 'sizeBytes'>): Promise<void> {
  await tx
    .update(events)
    .set({
      usedPhotos: sql`greatest(${events.usedPhotos} - 1, 0)`,
      usedBytes: sql`greatest(${events.usedBytes} - ${photo.sizeBytes}, 0)`,
    })
    .where(eq(events.id, photo.eventId))
}
