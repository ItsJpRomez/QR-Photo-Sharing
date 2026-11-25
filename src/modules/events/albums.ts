import { and, asc, count, eq, sql } from 'drizzle-orm'
import { db, withTx, type Executor, type Tx } from '@/db/client'
import { albums, type AlbumRow } from '@/db/schema'
import { AppError } from '@/lib/errors'

export const MAX_ALBUMS = 30

export function listAlbums(eventId: string): Promise<AlbumRow[]> {
  return db.select().from(albums).where(eq(albums.eventId, eventId)).orderBy(asc(albums.position), asc(albums.createdAt))
}

/** One change to an event's albums at a time, so positions and limits stay right. */
async function lockAlbums(tx: Tx, eventId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`albums:${eventId}`}, 0))`)
}

export function createAlbum(eventId: string, name: string): Promise<AlbumRow> {
  return withTx(async (tx) => {
    await lockAlbums(tx, eventId)
    const [{ n, last } = { n: 0, last: -1 }] = await tx
      .select({ n: count(), last: sql<number>`coalesce(max(${albums.position}), -1)::int` })
      .from(albums)
      .where(eq(albums.eventId, eventId))
    if (n >= MAX_ALBUMS) throw new AppError('bad_input', `An event can have up to ${MAX_ALBUMS} albums.`)
    const [row] = await tx.insert(albums).values({ eventId, name, position: last + 1 }).returning()
    return row!
  })
}

const isAlbum = (eventId: string, id: string) => and(eq(albums.eventId, eventId), eq(albums.id, id))

export async function renameAlbum(eventId: string, id: string, name: string): Promise<AlbumRow> {
  const [row] = await db.update(albums).set({ name }).where(isAlbum(eventId, id)).returning()
  if (!row) throw new AppError('not_found')
  return row
}

export async function deleteAlbum(eventId: string, id: string): Promise<void> {
  const gone = await db.delete(albums).where(isAlbum(eventId, id)).returning({ id: albums.id })
  if (!gone.length) throw new AppError('not_found')
}

export function reorderAlbums(eventId: string, ids: string[]): Promise<void> {
  return withTx(async (tx) => {
    await lockAlbums(tx, eventId)
    const existing = await tx.select({ id: albums.id }).from(albums).where(eq(albums.eventId, eventId))
    const wanted = new Set(ids)
    if (wanted.size !== ids.length || ids.length !== existing.length || !existing.every((a) => wanted.has(a.id)))
      throw new AppError('bad_input', 'The albums changed. Reload the page and try again.')
    for (const [position, id] of ids.entries()) await tx.update(albums).set({ position }).where(isAlbum(eventId, id))
  })
}

/** The album if it belongs to this event, else null. */
export async function ownAlbumId(tx: Executor, eventId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const [row] = await tx.select({ id: albums.id }).from(albums).where(isAlbum(eventId, id))
  return row?.id ?? null
}
