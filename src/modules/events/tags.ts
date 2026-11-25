import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, withTx, type Executor } from '@/db/client'
import { hashtags, photoHashtags, photos } from '@/db/schema'
import { AppError } from '@/lib/errors'
import { publish } from '@/modules/live/publish'
import { parseTags, type ParsedTag } from './tag-text'

export type TagRow = typeof hashtags.$inferSelect
export type TrendingTag = { norm: string; display: string; count: number }

/** Adds tags to a photo. Tags the host blocked are left out. */
export async function attachTags(tx: Executor, eventId: string, photoId: string, tags: ParsedTag[]): Promise<void> {
  if (!tags.length) return
  await tx.insert(hashtags).values(tags.map((t) => ({ eventId, ...t }))).onConflictDoNothing()
  const allowed = await tx
    .select({ id: hashtags.id })
    .from(hashtags)
    .where(
      and(
        eq(hashtags.eventId, eventId),
        eq(hashtags.blocked, false),
        inArray(
          hashtags.norm,
          tags.map((t) => t.norm),
        ),
      ),
    )
  if (allowed.length) {
    await tx
      .insert(photoHashtags)
      .values(allowed.map((t) => ({ photoId, hashtagId: t.id })))
      .onConflictDoNothing()
  }
}

export async function suggestTag(eventId: string, text: string): Promise<TagRow> {
  const [tag] = parseTags([text])
  if (!tag) throw new AppError('bad_input', 'A hashtag can have letters, numbers and underscores, up to 40 characters.')
  const [row] = await db
    .insert(hashtags)
    .values({ eventId, ...tag, suggested: true })
    .onConflictDoUpdate({ target: [hashtags.eventId, hashtags.norm], set: { suggested: true, blocked: false, display: tag.display } })
    .returning()
  await publish(db, { eventId, type: 'event', ids: [], audience: 'everyone' })
  return row!
}

const isTag = (eventId: string, id: string) => and(eq(hashtags.eventId, eventId), eq(hashtags.id, id))

export async function unsuggestTag(eventId: string, id: string): Promise<void> {
  const rows = await db.update(hashtags).set({ suggested: false }).where(isTag(eventId, id)).returning({ id: hashtags.id })
  if (!rows.length) throw new AppError('not_found')
  await publish(db, { eventId, type: 'event', ids: [], audience: 'everyone' })
}

/** Takes a tag off every photo and stops it being used again in this event. */
export function blockTag(eventId: string, id: string): Promise<void> {
  return withTx(async (tx) => {
    const rows = await tx
      .update(hashtags)
      .set({ blocked: true, suggested: false })
      .where(isTag(eventId, id))
      .returning({ id: hashtags.id })
    if (!rows.length) throw new AppError('not_found')
    const had = await tx.delete(photoHashtags).where(eq(photoHashtags.hashtagId, id)).returning({ photoId: photoHashtags.photoId })
    if (had.length) await publish(tx, { eventId, type: 'photos', ids: had.map((p) => p.photoId), audience: 'everyone' })
    await publish(tx, { eventId, type: 'event', ids: [], audience: 'everyone' })
  })
}

export function listSuggestedTags(eventId: string): Promise<TagRow[]> {
  return db
    .select()
    .from(hashtags)
    .where(and(eq(hashtags.eventId, eventId), eq(hashtags.suggested, true)))
    .orderBy(asc(hashtags.norm))
}

/** For the host: every tag, used or not. */
export function listAllTags(eventId: string) {
  return db
    .select({
      id: hashtags.id,
      display: hashtags.display,
      norm: hashtags.norm,
      suggested: hashtags.suggested,
      blocked: hashtags.blocked,
      count: sql<number>`count(${photoHashtags.photoId})::int`,
    })
    .from(hashtags)
    .leftJoin(photoHashtags, eq(photoHashtags.hashtagId, hashtags.id))
    .where(eq(hashtags.eventId, eventId))
    .groupBy(hashtags.id)
    .orderBy(desc(sql`count(${photoHashtags.photoId})`), asc(hashtags.norm))
}

export async function trendingTags(eventId: string, now: Date): Promise<TrendingTag[]> {
  const since = new Date(now.getTime() - 2 * 3600_000)
  const recent = sql`count(*) filter (where ${photos.publishedAt} > ${since.toISOString()})`
  return db
    .select({ norm: hashtags.norm, display: hashtags.display, count: sql<number>`count(*)::int` })
    .from(hashtags)
    .innerJoin(photoHashtags, eq(photoHashtags.hashtagId, hashtags.id))
    .innerJoin(photos, and(eq(photos.id, photoHashtags.photoId), eq(photos.status, 'live')))
    .where(and(eq(hashtags.eventId, eventId), eq(hashtags.blocked, false)))
    .groupBy(hashtags.id)
    .orderBy(desc(recent), desc(sql`count(*)`), asc(hashtags.norm))
    .limit(20)
}
