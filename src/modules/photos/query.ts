import { and, eq, exists, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import {
  comments,
  hashtags,
  hearts,
  participants,
  photoContributors,
  photoHashtags,
  photos,
  type EventRow,
  type GalleryOrder,
  type PhotoRow,
  type PhotoStatus,
} from '@/db/schema'
import { AppError } from '@/lib/errors'
import { can, requireCan, type Viewer } from '@/modules/access/can'
import { keys, storage } from '@/modules/storage'

export type Unlocked = Exclude<Viewer, { kind: 'locked' }>

export type View =
  | { kind: 'all' | 'hearted' | 'featured' | 'mine' | 'waiting' | 'hidden' | 'failed' }
  | { kind: 'album'; id: string }
  | { kind: 'tag'; norm: string }

export type PhotoDto = {
  id: string
  status: PhotoStatus
  thumbUrl: string | null
  displayUrl: string | null
  width: number | null
  height: number | null
  thumbhash: string | null
  takenAt: string | null
  publishedAt: string | null
  uploader: string
  albumId: string | null
  tags: string[]
  featured: boolean
  heartCount?: number
  hearted?: boolean
  commentCount?: number
  mine: boolean
  canDelete: boolean
  canDownload: boolean
  failureCode?: string | null
}

const SIMPLE = ['all', 'hearted', 'featured', 'mine', 'waiting', 'hidden', 'failed'] as const

export function parseView(text: string): View | null {
  if (text === '') return { kind: 'all' }
  if (text.startsWith('album:')) {
    const id = text.slice(6)
    return z.uuid().safeParse(id).success ? { kind: 'album', id } : null
  }
  if (text.startsWith('tag:')) return { kind: 'tag', norm: text.slice(4).toLowerCase() }
  const kind = SIMPLE.find((k) => k === text)
  return kind ? { kind } : null
}

/** Photos whose files are finished. */
export const READY: PhotoStatus[] = ['pending', 'live', 'hidden']

const HOST_SEES: PhotoStatus[] = ['reserved', 'uploaded', 'processing', 'pending', 'live', 'hidden', 'failed']
const HOST_LISTS: PhotoStatus[] = ['uploaded', 'processing', 'pending', 'live', 'hidden']
const UPLOADER_SEES: PhotoStatus[] = ['uploaded', 'processing', 'pending']

const contributed = (participantId: string) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(photoContributors)
      .where(and(eq(photoContributors.photoId, photos.id), eq(photoContributors.participantId, participantId))),
  )

/** The one rule for which photos a person may see. */
export function visibleTo(viewer: Unlocked): SQL {
  if (viewer.kind === 'host') return inArray(photos.status, HOST_SEES)
  return or(eq(photos.status, 'live'), and(inArray(photos.status, UPLOADER_SEES), contributed(viewer.participantId)))!
}

function viewFilter(viewer: Unlocked, event: EventRow, view: View): SQL | undefined {
  const listed = viewer.kind === 'host' ? inArray(photos.status, HOST_LISTS) : undefined
  switch (view.kind) {
    case 'all':
      return listed
    case 'featured':
      return and(eq(photos.featured, true), listed)
    case 'mine':
      return and(contributed(viewer.participantId), listed)
    case 'album':
      return and(eq(photos.albumId, view.id), listed)
    case 'hearted':
      if (!event.settings.hearts) throw new AppError('feature_off')
      return and(sql`${photos.heartCount} > 0`, listed)
    case 'tag':
      return and(
        listed,
        exists(
          db
            .select({ one: sql`1` })
            .from(photoHashtags)
            .innerJoin(hashtags, eq(hashtags.id, photoHashtags.hashtagId))
            .where(and(eq(photoHashtags.photoId, photos.id), eq(hashtags.eventId, event.id), eq(hashtags.norm, view.norm))),
        ),
      )
    case 'waiting':
    case 'hidden':
    case 'failed':
      requireCan(viewer, 'photo.moderate', { event })
      return eq(photos.status, view.kind === 'waiting' ? 'pending' : view.kind)
  }
}

// Times are compared in whole microseconds, as Postgres keeps them; JavaScript dates would round them off.
const micros = (column: SQL) => sql`(extract(epoch from ${column}) * 1000000)::bigint`
const addedAt = micros(sql`coalesce(${photos.publishedAt}, ${photos.uploadedAt}, ${photos.reservedAt})`)
const takenAt = micros(sql`coalesce(${photos.takenAt}, ${photos.uploadedAt}, ${photos.reservedAt})`)

function sorting(view: View, order: GalleryOrder): { first: SQL; second: SQL; ascending: boolean } {
  if (view.kind === 'hearted') return { first: sql`${photos.heartCount}::bigint`, second: addedAt, ascending: false }
  if (order === 'featured') return { first: sql`${photos.featured}::int::bigint`, second: addedAt, ascending: false }
  if (order === 'taken') return { first: sql`0::bigint`, second: takenAt, ascending: true }
  return { first: sql`0::bigint`, second: addedAt, ascending: false }
}

const cursorShape = z.tuple([z.string().regex(/^-?\d{1,18}$/), z.string().regex(/^-?\d{1,18}$/), z.uuid()])

function readCursor(cursor: string): z.infer<typeof cursorShape> {
  try {
    return cursorShape.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()))
  } catch {
    throw new AppError('bad_input')
  }
}

type ListOptions = { view: View; order?: GalleryOrder; cursor?: string | null; limit?: number }

export async function listPhotos(
  viewer: Unlocked,
  event: EventRow,
  { view, order = event.settings.defaultOrder, cursor, limit = 60 }: ListOptions,
): Promise<{ items: PhotoDto[]; next: string | null }> {
  requireCan(viewer, 'gallery.view', { event })
  const { first, second, ascending } = sorting(view, order)
  const key = sql`(${first}, ${second}, ${photos.id})`
  const after = cursor ? readCursor(cursor) : null
  const at = after && sql`(${after[0]}::bigint, ${after[1]}::bigint, ${after[2]}::uuid)`
  const dir = ascending ? sql`asc` : sql`desc`
  const rows = await db
    .select({ photo: photos, first: sql<string>`${first}::text`, second: sql<string>`${second}::text` })
    .from(photos)
    .where(
      and(
        eq(photos.eventId, event.id),
        visibleTo(viewer),
        viewFilter(viewer, event, view),
        at ? (ascending ? sql`${key} > ${at}` : sql`${key} < ${at}`) : undefined,
      ),
    )
    .orderBy(sql`${first} ${dir}, ${second} ${dir}, ${photos.id} ${dir}`)
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = rows.length > limit ? page.at(-1) : undefined
  return {
    items: await toDtos(
      viewer,
      event,
      page.map((r) => r.photo),
    ),
    next: last ? Buffer.from(JSON.stringify([last.first, last.second, last.photo.id])).toString('base64url') : null,
  }
}

/** The photos among `ids` this person may see. The rest are `gone`, whatever the reason. */
export async function getPhotos(viewer: Unlocked, event: EventRow, ids: string[]): Promise<{ items: PhotoDto[]; gone: string[] }> {
  requireCan(viewer, 'gallery.view', { event })
  if (!ids.length) return { items: [], gone: [] }
  const rows = await db
    .select()
    .from(photos)
    .where(and(eq(photos.eventId, event.id), inArray(photos.id, ids), visibleTo(viewer)))
  const found = new Set(rows.map((r) => r.id))
  return { items: await toDtos(viewer, event, rows), gone: ids.filter((id) => !found.has(id)) }
}

/** One photo this person may see, or not found. */
export async function visiblePhoto(viewer: Unlocked, event: EventRow, photoId: string): Promise<PhotoRow> {
  requireCan(viewer, 'gallery.view', { event })
  const [photo] = await db
    .select()
    .from(photos)
    .where(and(eq(photos.eventId, event.id), eq(photos.id, photoId), visibleTo(viewer)))
  if (!photo) throw new AppError('not_found')
  return photo
}

async function toDtos(viewer: Unlocked, event: EventRow, rows: PhotoRow[]): Promise<PhotoDto[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const { settings } = event
  const [names, contributors, tags, mineHearts, commentCounts] = await Promise.all([
    db
      .select({ id: participants.id, name: participants.name })
      .from(participants)
      .where(inArray(participants.id, [...new Set(rows.map((r) => r.participantId))])),
    db.select().from(photoContributors).where(inArray(photoContributors.photoId, ids)),
    db
      .select({ photoId: photoHashtags.photoId, display: hashtags.display })
      .from(photoHashtags)
      .innerJoin(hashtags, eq(hashtags.id, photoHashtags.hashtagId))
      .where(inArray(photoHashtags.photoId, ids))
      .orderBy(hashtags.norm),
    settings.hearts
      ? db
          .select({ photoId: hearts.photoId })
          .from(hearts)
          .where(and(inArray(hearts.photoId, ids), eq(hearts.participantId, viewer.participantId)))
      : [],
    settings.comments
      ? db
          .select({ photoId: comments.photoId, n: sql<number>`count(*)::int` })
          .from(comments)
          .where(and(inArray(comments.photoId, ids), eq(comments.hidden, false), isNull(comments.deletedAt)))
          .groupBy(comments.photoId)
      : [],
  ])
  const nameOf = new Map(names.map((n) => [n.id, n.name]))
  const ownersOf = Map.groupBy(contributors, (c) => c.photoId)
  const tagsOf = Map.groupBy(tags, (t) => t.photoId)
  const hearted = new Set(mineHearts.map((h) => h.photoId))
  const commentsOn = new Map(commentCounts.map((c) => [c.photoId, c.n]))

  return Promise.all(
    rows.map(async (p) => {
      const ownerIds = ownersOf.get(p.id)?.map((c) => c.participantId) ?? []
      const ready = READY.includes(p.status)
      return {
        id: p.id,
        status: p.status,
        thumbUrl: ready ? await storage.signGet(keys.thumb(event.id, p.id)) : null,
        displayUrl: ready ? await storage.signGet(keys.display(event.id, p.id)) : null,
        width: p.width,
        height: p.height,
        thumbhash: p.thumbhash,
        takenAt: p.takenAt?.toISOString() ?? null,
        publishedAt: p.publishedAt?.toISOString() ?? null,
        uploader: nameOf.get(p.participantId) || 'Guest',
        albumId: p.albumId,
        tags: tagsOf.get(p.id)?.map((t) => t.display) ?? [],
        featured: p.featured,
        ...(settings.hearts && { heartCount: p.heartCount, hearted: hearted.has(p.id) }),
        ...(settings.comments && { commentCount: commentsOn.get(p.id) ?? 0 }),
        mine: ownerIds.includes(viewer.participantId),
        canDelete: can(viewer, 'photo.delete', { event, ownerIds }),
        canDownload: ready && can(viewer, 'photo.download', { event }),
        ...(viewer.kind === 'host' && { failureCode: p.failureCode }),
      }
    }),
  )
}
