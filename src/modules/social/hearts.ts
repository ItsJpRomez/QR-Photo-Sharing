import { and, eq, sql } from 'drizzle-orm'
import { withTx } from '@/db/client'
import { hearts, photos, type EventRow } from '@/db/schema'
import { requireCan } from '@/modules/access/can'
import { publish } from '@/modules/live/publish'
import { visiblePhoto, type Unlocked } from '@/modules/photos/query'

export async function setHeart(viewer: Unlocked, event: EventRow, photoId: string, on: boolean) {
  requireCan(viewer, 'photo.heart', { event })
  await visiblePhoto(viewer, event, photoId)
  return withTx(async (tx) => {
    // Holding the photo keeps the count equal to the hearts, however fast people tap.
    const [photo] = await tx.select({ n: photos.heartCount }).from(photos).where(eq(photos.id, photoId)).for('update')
    const mine = and(eq(hearts.photoId, photoId), eq(hearts.participantId, viewer.participantId))
    const changed = on
      ? await tx.insert(hearts).values({ photoId, participantId: viewer.participantId }).onConflictDoNothing().returning()
      : await tx.delete(hearts).where(mine).returning()
    if (!changed.length) return { heartCount: photo?.n ?? 0, hearted: on }
    const [row] = await tx
      .update(photos)
      .set({ heartCount: sql`greatest(${photos.heartCount} + ${on ? 1 : -1}, 0)` })
      .where(eq(photos.id, photoId))
      .returning({ heartCount: photos.heartCount })
    await publish(tx, { eventId: event.id, type: 'hearts', ids: [photoId], audience: 'everyone' })
    return { heartCount: row!.heartCount, hearted: on }
  })
}
