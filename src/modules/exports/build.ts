import { PassThrough, type Readable } from 'node:stream'
import { ZipArchive } from 'archiver'
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import { config } from '@/config'
import { user } from '@/db/auth-schema'
import { db, withTx } from '@/db/client'
import { albums, events, exports, participants, photos, type EventRow, type ExportRow, type PhotoStatus } from '@/db/schema'
import { enqueue } from '@/jobs/boss'
import { AppError } from '@/lib/errors'
import { safeFileName } from '@/lib/file-name'
import { sendMail } from '@/lib/mail'
import { requireCan, type Viewer } from '@/modules/access/can'
import { publish } from '@/modules/live/publish'
import { keys, storage } from '@/modules/storage'
import { exportPath } from './names'

export type ExportOptions = { includeHidden: boolean; includePending: boolean }
export type ExportDto = {
  id: string
  status: ExportRow['status']
  total: number
  done: number
  failed: number
  sizeBytes: number | null
  requestedAt: string
  expiresAt: string | null
}

const WEEK_MS = 7 * 24 * 3600_000
/** Long enough to finish, and resume, on a slow connection. */
const LINK_SECONDS = 24 * 3600
const PROGRESS_MS = 1000

export function toDto(x: ExportRow): ExportDto {
  return {
    id: x.id,
    status: x.status,
    total: x.photoIds.length,
    done: x.done,
    failed: x.failed,
    sizeBytes: x.sizeBytes,
    requestedAt: x.requestedAt.toISOString(),
    expiresAt: x.expiresAt?.toISOString() ?? null,
  }
}

const running = (eventId: string) => and(eq(exports.eventId, eventId), inArray(exports.status, ['queued', 'running']))

/** Remembers exactly which photos there were at this moment, then builds in the background. */
export async function startExport(viewer: Viewer, event: EventRow, options: ExportOptions): Promise<ExportRow> {
  requireCan(viewer, 'export.run', { event })
  const statuses: PhotoStatus[] = ['live']
  if (options.includeHidden) statuses.push('hidden')
  if (options.includePending) statuses.push('pending')
  return withTx(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`export:${event.id}`}, 0))`)
    const [already] = await tx.select().from(exports).where(running(event.id))
    if (already) return already
    const rows = await tx
      .select({ id: photos.id })
      .from(photos)
      .where(and(eq(photos.eventId, event.id), inArray(photos.status, statuses)))
      .orderBy(asc(photos.takenAt), asc(photos.id))
    if (!rows.length) throw new AppError('bad_input', 'There are no photos to download yet.')
    const [x] = await tx
      .insert(exports)
      .values({ eventId: event.id, options, photoIds: rows.map((r) => r.id) })
      .returning()
    await enqueue(tx, 'export.build', { exportId: x!.id })
    return x!
  })
}

async function loadExport(exportId: string) {
  const [row] = await db
    .select({ x: exports, event: events })
    .from(exports)
    .innerJoin(events, eq(events.id, exports.eventId))
    .where(eq(exports.id, exportId))
  return row
}

async function set(x: ExportRow, change: Partial<typeof exports.$inferInsert>): Promise<void> {
  await db.update(exports).set(change).where(eq(exports.id, x.id))
  await publish(db, { eventId: x.eventId, type: 'export', ids: [x.id], audience: 'host' })
}

export async function failExport(exportId: string): Promise<void> {
  const row = await loadExport(exportId)
  if (!row || !['queued', 'running'].includes(row.x.status)) return
  await set(row.x, { status: 'failed', finishedAt: new Date() })
  await storage.delete([keys.export(row.x.eventId, exportId)])
}

async function photoDetails(x: ExportRow, ids: string[]) {
  const rows = await db
    .select({ photo: photos, uploader: participants.name, album: albums.name })
    .from(photos)
    .innerJoin(participants, eq(participants.id, photos.participantId))
    .leftJoin(albums, eq(albums.id, photos.albumId))
    .where(and(eq(photos.eventId, x.eventId), inArray(photos.id, ids)))
  return new Map(rows.map((r) => [r.photo.id, r]))
}

const isDeleted = async (eventId: string) => {
  const [e] = await db.select({ deletedAt: events.deletedAt }).from(events).where(eq(events.id, eventId))
  return !e || e.deletedAt !== null
}

class EventGone extends Error {}

/** Adds one file and waits until it is fully in the archive, so only one is ever open. */
function addFile(zip: ZipArchive, source: Readable | string, name: string, date: Date): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      zip.off('error', failed)
      resolve()
    }
    const failed = (err: Error) => {
      zip.off('entry', done)
      reject(err)
    }
    zip.once('entry', done)
    zip.once('error', failed)
    if (typeof source !== 'string') source.once('error', failed)
    zip.append(source, { name, date })
  })
}

/** Builds the archive straight into storage, so its size isn't limited by this server's disk. */
export async function buildExport(exportId: string): Promise<void> {
  const row = await loadExport(exportId)
  if (!row || !['queued', 'running'].includes(row.x.status)) return
  const { x, event } = row
  if (event.deletedAt) return failExport(exportId)
  await set(x, { status: 'running', done: 0, failed: 0 })

  const zip = new ZipArchive({ store: true, forceZip64: false })
  const out = new PassThrough({ highWaterMark: 1024 * 1024 })
  // An archive error reaches the upload through the stream, and the upload's promise reports it.
  zip.on('error', (err) => out.destroy(err))
  out.on('error', () => {}) // an unheard error here would stop the whole worker
  zip.pipe(out)
  const uploading = storage.put(keys.export(event.id, x.id), out, 'application/zip')
  uploading.catch(() => {}) // always awaited below

  let done = 0
  const problems: string[] = []
  let reported = Date.now()
  try {
    let seq = 0
    for (let at = 0; at < x.photoIds.length; at += 200) {
      const ids = x.photoIds.slice(at, at + 200)
      const details = await photoDetails(x, ids)
      for (const id of ids) {
        seq++
        const found = details.get(id)
        // Deleted since the click: leaving it out is what its owner wanted.
        if (!found || found.photo.status === 'deleted') continue
        const { photo, uploader, album } = found
        const takenAt = photo.takenAt ?? event.createdAt
        const name = exportPath({ album, takenAt, timeZone: event.timeZone, uploader, seq, ext: photo.ext ?? 'jpg' })
        const key = keys.original(event.id, id, photo.ext ?? 'jpg')
        if (!(await storage.head(key))) {
          problems.push(name)
        } else {
          const added = addFile(zip, await storage.readStream(key), name, takenAt)
          // If the upload dies, nothing reads the archive any more and waiting would be forever.
          await Promise.race([added, uploading.then(() => added)])
          done++
        }
        if (Date.now() - reported >= PROGRESS_MS) {
          reported = Date.now()
          if (await isDeleted(event.id)) throw new EventGone()
          await set(x, { done, failed: problems.length })
        }
      }
    }
    if (problems.length) {
      const list = `These photos could not be included because their files are missing:\n\n${problems.join('\n')}\n`
      await addFile(zip, list, '_errors.txt', new Date())
    }
    await Promise.all([zip.finalize(), uploading])
  } catch (err) {
    zip.abort()
    out.destroy(err as Error)
    await uploading.catch(() => {})
    if (err instanceof EventGone) return failExport(exportId)
    throw err
  }

  if (await isDeleted(event.id)) return failExport(exportId)
  const { size } = await uploading
  const now = new Date()
  await set(x, {
    status: 'ready',
    done,
    failed: problems.length,
    sizeBytes: size,
    finishedAt: now,
    expiresAt: new Date(now.getTime() + WEEK_MS),
  })
  await tellHost(event)
}

async function tellHost(event: EventRow): Promise<void> {
  if (!event.ownerId) return
  const [owner] = await db.select({ email: user.email }).from(user).where(eq(user.id, event.ownerId))
  if (!owner) return
  await sendMail({
    to: owner.email,
    subject: `Your photos from ${event.name} are ready`,
    text: `The download is ready for the next 7 days:\n\n${config.appUrl}/host/events/${event.id}/export`,
  }).catch((err: Error) => console.error('Export email failed', err.message))
}

export function listExports(event: EventRow): Promise<ExportRow[]> {
  return db.select().from(exports).where(eq(exports.eventId, event.id)).orderBy(desc(exports.requestedAt)).limit(10)
}

export async function exportDownloadUrl(viewer: Viewer, event: EventRow, exportId: string): Promise<string> {
  requireCan(viewer, 'export.run', { event })
  const [x] = await db
    .select()
    .from(exports)
    .where(and(eq(exports.id, exportId), eq(exports.eventId, event.id), eq(exports.status, 'ready')))
  if (!x?.expiresAt || x.expiresAt <= new Date()) throw new AppError('not_found')
  return storage.signGet(keys.export(event.id, exportId), {
    downloadName: `${safeFileName(event.name)} photos.zip`,
    seconds: LINK_SECONDS,
  })
}

/** Removes archives whose week is over. */
export async function expireExports(now: Date): Promise<void> {
  const old = await db
    .select()
    .from(exports)
    .where(and(eq(exports.status, 'ready'), lte(exports.expiresAt, now)))
  for (const x of old) {
    await storage.delete([keys.export(x.eventId, x.id)])
    await db.update(exports).set({ status: 'expired' }).where(eq(exports.id, x.id))
  }
}
