import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '@/config'
import { db, withTx } from '@/db/client'
import { comments, participants, type CommentRow, type EventRow } from '@/db/schema'
import { AppError } from '@/lib/errors'
import { hitLimit } from '@/lib/rate-limit'
import { personName, plainText } from '@/lib/text'
import { can, requireCan } from '@/modules/access/can'
import { publish } from '@/modules/live/publish'
import { visiblePhoto, type Unlocked } from '@/modules/photos/query'

export type CommentDto = {
  id: string
  author: string
  text: string
  createdAt: string
  mine: boolean
  canDelete: boolean
  hidden: boolean
}

export const commentInput = z.object({ text: plainText(500, { min: 1, multiline: true }), name: personName.optional() })
export type CommentInput = z.input<typeof commentInput>

const PAGE = 50

function toDto(viewer: Unlocked, event: EventRow, c: CommentRow, author: string): CommentDto {
  return {
    id: c.id,
    author: author || 'Guest',
    text: c.text,
    createdAt: c.createdAt.toISOString(),
    mine: c.participantId === viewer.participantId,
    canDelete: can(viewer, 'comment.delete', { event, ownerIds: [c.participantId] }),
    hidden: c.hidden,
  }
}

export async function addComment(viewer: Unlocked, event: EventRow, photoId: string, raw: CommentInput): Promise<CommentDto> {
  const input = commentInput.parse(raw)
  requireCan(viewer, 'comment.create', { event })
  await visiblePhoto(viewer, event, photoId)
  if (viewer.kind === 'guest' && !(await hitLimit(`comment:${viewer.participantId}`, config.limits.commentsPerMinute, 60)))
    throw new AppError('rate_limited')
  return withTx(async (tx) => {
    const me = eq(participants.id, viewer.participantId)
    if (input.name) await tx.update(participants).set({ name: input.name }).where(me)
    const [author] = await tx.select({ name: participants.name }).from(participants).where(me)
    const [row] = await tx
      .insert(comments)
      .values({ eventId: event.id, photoId, participantId: viewer.participantId, text: input.text })
      .returning()
    await publish(tx, { eventId: event.id, type: 'comments', ids: [photoId], audience: 'everyone' })
    return toDto(viewer, event, row!, author?.name ?? '')
  })
}

const cursorShape = z.tuple([z.string().regex(/^\d{1,18}$/), z.uuid()])
const micros = sql`(extract(epoch from ${comments.createdAt}) * 1000000)::bigint`

function readCursor(cursor: string): z.infer<typeof cursorShape> {
  try {
    return cursorShape.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()))
  } catch {
    throw new AppError('bad_input')
  }
}

export async function listComments(viewer: Unlocked, event: EventRow, photoId: string, cursor?: string | null) {
  if (!event.settings.comments) throw new AppError('feature_off')
  await visiblePhoto(viewer, event, photoId)
  const after = cursor ? readCursor(cursor) : null
  const rows = await db
    .select({ comment: comments, author: participants.name, at: sql<string>`${micros}::text` })
    .from(comments)
    .innerJoin(participants, eq(participants.id, comments.participantId))
    .where(
      and(
        eq(comments.eventId, event.id),
        eq(comments.photoId, photoId),
        isNull(comments.deletedAt),
        can(viewer, 'comment.moderate', { event }) ? undefined : eq(comments.hidden, false),
        after ? sql`(${micros}, ${comments.id}) > (${after[0]}::bigint, ${after[1]}::uuid)` : undefined,
      ),
    )
    .orderBy(asc(micros), asc(comments.id))
    .limit(PAGE + 1)
  const page = rows.slice(0, PAGE)
  const last = rows.length > PAGE ? page.at(-1) : undefined
  return {
    items: page.map((r) => toDto(viewer, event, r.comment, r.author)),
    next: last ? Buffer.from(JSON.stringify([last.at, last.comment.id])).toString('base64url') : null,
  }
}

async function find(event: EventRow, id: string): Promise<CommentRow> {
  const [row] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, id), eq(comments.eventId, event.id), isNull(comments.deletedAt)))
  if (!row) throw new AppError('not_found')
  return row
}

async function change(event: EventRow, c: CommentRow, set: Partial<typeof comments.$inferInsert>): Promise<void> {
  await withTx(async (tx) => {
    await tx.update(comments).set(set).where(eq(comments.id, c.id))
    await publish(tx, { eventId: event.id, type: 'comments', ids: [c.photoId], audience: 'everyone' })
  })
}

export async function deleteComment(viewer: Unlocked, event: EventRow, id: string): Promise<void> {
  const c = await find(event, id)
  requireCan(viewer, 'comment.delete', { event, ownerIds: [c.participantId] })
  await change(event, c, { deletedAt: new Date() })
}

export async function hideComment(viewer: Unlocked, event: EventRow, id: string, hidden: boolean): Promise<void> {
  requireCan(viewer, 'comment.moderate', { event })
  await change(event, await find(event, id), { hidden })
}
