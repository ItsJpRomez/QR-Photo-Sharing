import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { user } from './auth-schema'

const at = (name: string) => timestamp(name, { withTimezone: true })
const id = () => uuid('id').primaryKey().defaultRandom()
const bytes = (name: string) => bigint(name, { mode: 'number' })

export type GalleryOrder = 'newest' | 'taken' | 'featured'

export type EventSettings = {
  hearts: boolean
  comments: boolean
  guestDownloads: boolean
  approval: boolean
  defaultOrder: GalleryOrder
  tv: { seconds: number; albumId: string | null; showNames: boolean; showQr: boolean; showPin: boolean }
}

export const DEFAULT_SETTINGS: EventSettings = {
  hearts: true,
  comments: true,
  guestDownloads: true,
  approval: false,
  defaultOrder: 'newest',
  tv: { seconds: 7, albumId: null, showNames: true, showQr: true, showPin: false },
}

export const events = pgTable(
  'events',
  {
    id: id(),
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'set null' }),
    code: text('code').notNull().unique(),
    tvToken: text('tv_token').notNull().unique(),
    name: text('name').notNull(),
    eventDate: date('event_date').notNull(),
    timeZone: text('time_zone').notNull(),
    coverKey: text('cover_key'),
    welcome: text('welcome').notNull().default(''),
    accent: text('accent').notNull().default('#4a2370'),
    settings: jsonb('settings').$type<EventSettings>().notNull().default(DEFAULT_SETTINGS),
    pinHash: text('pin_hash'),
    pinVersion: integer('pin_version').notNull().default(0),
    pinPausedUntil: at('pin_paused_until'),
    /** Present only while the host shows the PIN on the TV. Encrypted. */
    tvPinEncrypted: text('tv_pin_encrypted'),
    frozenAt: at('frozen_at'),
    maxPhotos: integer('max_photos').notNull(),
    maxBytes: bytes('max_bytes').notNull(),
    usedPhotos: integer('used_photos').notNull().default(0),
    usedBytes: bytes('used_bytes').notNull().default(0),
    createdAt: at('created_at').notNull().defaultNow(),
    deletedAt: at('deleted_at'),
  },
  (t) => [index('events_owner_idx').on(t.ownerId), index('events_deleted_idx').on(t.deletedAt)],
)

export const participants = pgTable(
  'participants',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash'),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    name: text('name').notNull().default(''),
    /** The event's pinVersion this guest last unlocked. */
    pinVersion: integer('pin_version').notNull().default(0),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('participants_token_unique').on(t.eventId, t.tokenHash),
    uniqueIndex('participants_user_unique').on(t.eventId, t.userId),
  ],
)

export const albums = pgTable(
  'albums',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('albums_event_idx').on(t.eventId, t.position)],
)

export const photoStatus = pgEnum('photo_status', [
  'reserved',
  'uploaded',
  'processing',
  'pending',
  'live',
  'hidden',
  'failed',
  'duplicate',
  'expired',
  'deleted',
])
export type PhotoStatus = (typeof photoStatus.enumValues)[number]

export const deletedBy = pgEnum('deleted_by', ['host', 'uploader'])

export const photos = pgTable(
  'photos',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    albumId: uuid('album_id').references(() => albums.id, { onDelete: 'set null' }),
    clientId: uuid('client_id').notNull(),
    status: photoStatus('status').notNull().default('reserved'),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256'),
    mime: text('mime'),
    ext: text('ext'),
    width: integer('width'),
    height: integer('height'),
    thumbhash: text('thumbhash'),
    takenAt: at('taken_at'),
    reservedAt: at('reserved_at').notNull().defaultNow(),
    uploadedAt: at('uploaded_at'),
    publishedAt: at('published_at'),
    featured: boolean('featured').notNull().default(false),
    heartCount: integer('heart_count').notNull().default(0),
    failureCode: text('failure_code'),
    deletedBy: deletedBy('deleted_by'),
    duplicateOf: uuid('duplicate_of').references((): AnyPgColumn => photos.id, { onDelete: 'set null' }),
    downloadReady: boolean('download_ready').notNull().default(false),
  },
  (t) => [
    uniqueIndex('photos_client_unique').on(t.eventId, t.clientId),
    uniqueIndex('photos_hash_unique')
      .on(t.eventId, t.sha256)
      .where(sql`${t.status} not in ('failed', 'expired', 'deleted', 'duplicate')`),
    index('photos_published_idx').on(t.eventId, t.status, t.publishedAt.desc(), t.id),
    index('photos_taken_idx').on(t.eventId, t.status, t.takenAt.desc(), t.id),
    index('photos_hearts_idx').on(t.eventId, t.status, t.heartCount.desc(), t.id),
    index('photos_uploaded_idx').on(t.eventId, t.status, t.uploadedAt.desc(), t.id),
    index('photos_participant_idx').on(t.participantId),
    index('photos_reserved_idx').on(t.status, t.reservedAt),
  ],
)

export const photoContributors = pgTable(
  'photo_contributors',
  {
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    addedAt: at('added_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.photoId, t.participantId] }), index('contributors_participant_idx').on(t.participantId)],
)

export const hashtags = pgTable(
  'hashtags',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    norm: text('norm').notNull(),
    display: text('display').notNull(),
    suggested: boolean('suggested').notNull().default(false),
    blocked: boolean('blocked').notNull().default(false),
  },
  (t) => [uniqueIndex('hashtags_norm_unique').on(t.eventId, t.norm)],
)

export const photoHashtags = pgTable(
  'photo_hashtags',
  {
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    hashtagId: uuid('hashtag_id')
      .notNull()
      .references(() => hashtags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.photoId, t.hashtagId] }), index('photo_hashtags_tag_idx').on(t.hashtagId)],
)

export const hearts = pgTable(
  'hearts',
  {
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.photoId, t.participantId] })],
)

export const comments = pgTable(
  'comments',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    hidden: boolean('hidden').notNull().default(false),
    deletedAt: at('deleted_at'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('comments_photo_idx').on(t.photoId, t.createdAt, t.id)],
)

export const exportStatus = pgEnum('export_status', ['queued', 'running', 'ready', 'failed', 'expired'])

export const exports = pgTable(
  'exports',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    status: exportStatus('status').notNull().default('queued'),
    options: jsonb('options').$type<{ includeHidden: boolean; includePending: boolean }>().notNull(),
    photoIds: uuid('photo_ids').array().notNull(),
    done: integer('done').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    sizeBytes: bytes('size_bytes'),
    requestedAt: at('requested_at').notNull().defaultNow(),
    finishedAt: at('finished_at'),
    expiresAt: at('expires_at'),
  },
  (t) => [
    index('exports_event_idx').on(t.eventId, t.requestedAt),
    uniqueIndex('exports_one_running')
      .on(t.eventId)
      .where(sql`${t.status} in ('queued', 'running')`),
  ],
)

export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: at('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index('rate_limits_window_idx').on(t.windowStart)],
)

/** Last sign of life from background processes. */
export const heartbeats = pgTable('heartbeats', {
  name: text('name').primaryKey(),
  at: at('at').notNull().defaultNow(),
})

export type EventRow = typeof events.$inferSelect
export type ParticipantRow = typeof participants.$inferSelect
export type PhotoRow = typeof photos.$inferSelect
export type AlbumRow = typeof albums.$inferSelect
export type CommentRow = typeof comments.$inferSelect
export type ExportRow = typeof exports.$inferSelect
