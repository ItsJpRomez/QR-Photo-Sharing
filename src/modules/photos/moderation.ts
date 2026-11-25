import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { withTx, type Tx } from '@/db/client'
import { comments, hearts, photoContributors, photos, type EventRow, type PhotoRow, type PhotoStatus } from '@/db/schema'
import { enqueue } from '@/jobs/boss'
import { AppError } from '@/lib/errors'
import { can, requireCan } from '@/modules/access/can'
import { ownAlbumId } from '@/modules/events/albums'
import { publish } from '@/modules/live/publish'
import { COUNTED, releaseQuota, transition } from './lifecycle'
import { visiblePhoto, type Unlocked } from './query'

export type Operation =
  | { kind: 'approve' | 'hide' | 'unhide' | 'delete' | 'feature' | 'unfeature' }
  | { kind: 'move'; albumId: string | null }

const MAX_AT_ONCE = 200
const HOST_CAN_TOUCH: PhotoStatus[] = ['reserved', 'uploaded', 'processing', 'pending', 'live', 'hidden', 'failed']

/** Everyone hears about photos they could see before or can see now; otherwise only the people who sent them. */
async function announce(tx: Tx, event: EventRow, rows: PhotoRow[], publicNow: boolean): Promise<void> {
  const open = rows.filter((p) => publicNow || p.status === 'live').map((p) => p.id)
  const quiet = rows.filter((p) => !publicNow && p.status !== 'live').map((p) => p.id)
  if (open.length) await publish(tx, { eventId: event.id, type: 'photos', ids: open, audience: 'everyone' })
  if (!quiet.length) return
  const senders = await tx
    .selectDistinct({ id: photoContributors.participantId })
    .from(photoContributors)
    .where(inArray(photoContributors.photoId, quiet))
  for (let at = 0; at === 0 || at < senders.length; at += 50)
    await publish(tx, { eventId: event.id, type: 'photos', ids: quiet, audience: senders.slice(at, at + 50).map((s) => s.id) })
}

/** Takes a photo away for good, with everything attached to it. */
async function destroy(tx: Tx, photo: PhotoRow, by: 'host' | 'uploader'): Promise<boolean> {
  if (!(await transition(tx, photo.id, [photo.status], 'deleted', { deletedBy: by, heartCount: 0, featured: false }))) return false
  if (COUNTED.includes(photo.status)) await releaseQuota(tx, photo)
  await tx.delete(hearts).where(eq(hearts.photoId, photo.id))
  await tx.delete(comments).where(eq(comments.photoId, photo.id))
  await enqueue(tx, 'photo.purge', { eventId: photo.eventId, photoId: photo.id })
  return true
}

async function applyOne(tx: Tx, photo: PhotoRow, op: Operation): Promise<boolean> {
  switch (op.kind) {
    case 'approve':
      return photo.status === 'pending' && transition(tx, photo.id, ['pending'], 'live', { publishedAt: new Date() })
    case 'hide':
      return (photo.status === 'live' || photo.status === 'pending') && transition(tx, photo.id, [photo.status], 'hidden')
    case 'unhide':
      return photo.status === 'hidden' && transition(tx, photo.id, ['hidden'], 'live', { publishedAt: photo.publishedAt ?? new Date() })
    case 'delete':
      return destroy(tx, photo, 'host')
    case 'feature':
    case 'unfeature':
      await tx.update(photos).set({ featured: op.kind === 'feature' }).where(eq(photos.id, photo.id))
      return true
    case 'move':
      await tx.update(photos).set({ albumId: op.albumId }).where(eq(photos.id, photo.id))
      return true
  }
}

export async function moderate(viewer: Unlocked, event: EventRow, ids: string[], op: Operation): Promise<{ changed: string[] }> {
  requireCan(viewer, 'photo.moderate', { event })
  const wanted = [...new Set(ids)]
  if (!wanted.length || wanted.length > MAX_AT_ONCE) throw new AppError('bad_input', `Choose between 1 and ${MAX_AT_ONCE} photos.`)
  return withTx(async (tx) => {
    // Always in the same order, so two windows can't block each other.
    const rows = await tx
      .select()
      .from(photos)
      .where(and(eq(photos.eventId, event.id), inArray(photos.id, wanted), inArray(photos.status, HOST_CAN_TOUCH)))
      .orderBy(asc(photos.id))
      .for('update')
    if (rows.length !== wanted.length) throw new AppError('not_found')
    if (op.kind === 'move' && op.albumId && !(await ownAlbumId(tx, event.id, op.albumId))) throw new AppError('bad_input')
    const changed: PhotoRow[] = []
    for (const photo of rows) if (await applyOne(tx, photo, op)) changed.push(photo)
    if (changed.length) await announce(tx, event, changed, op.kind === 'approve' || op.kind === 'unhide')
    return { changed: changed.map((p) => p.id) }
  })
}

export async function approveAll(viewer: Unlocked, event: EventRow): Promise<{ count: number }> {
  requireCan(viewer, 'photo.moderate', { event })
  return withTx(async (tx) => {
    const rows = await tx
      .update(photos)
      .set({ status: 'live', publishedAt: sql`clock_timestamp()` })
      .where(and(eq(photos.eventId, event.id), eq(photos.status, 'pending')))
      .returning({ id: photos.id })
    if (rows.length) await publish(tx, { eventId: event.id, type: 'photos', ids: rows.map((r) => r.id), audience: 'everyone' })
    return { count: rows.length }
  })
}

/** A guest takes their photo back. If someone else sent the same one, it stays as theirs. */
export async function deleteOwnPhoto(viewer: Unlocked, event: EventRow, photoId: string): Promise<void> {
  await withTx(async (tx) => {
    const [photo] = await tx
      .select()
      .from(photos)
      .where(and(eq(photos.id, photoId), eq(photos.eventId, event.id), ne(photos.status, 'deleted')))
      .for('update')
    const senders = photo
      ? await tx.select().from(photoContributors).where(eq(photoContributors.photoId, photoId)).orderBy(asc(photoContributors.addedAt))
      : []
    const ownerIds = senders.map((s) => s.participantId)
    if (!photo || !ownerIds.includes(viewer.participantId)) {
      await visiblePhoto(viewer, event, photoId) // says "not found" when it can't be seen
      throw new AppError('forbidden')
    }
    if (!can(viewer, 'photo.delete', { event, ownerIds })) throw new AppError('forbidden')

    await announce(tx, event, [photo], false)
    await tx
      .delete(photoContributors)
      .where(and(eq(photoContributors.photoId, photoId), eq(photoContributors.participantId, viewer.participantId)))
    const next = ownerIds.find((id) => id !== viewer.participantId)
    if (!next) await destroy(tx, photo, 'uploader')
    else if (photo.participantId === viewer.participantId)
      await tx.update(photos).set({ participantId: next }).where(eq(photos.id, photoId))
  })
}
