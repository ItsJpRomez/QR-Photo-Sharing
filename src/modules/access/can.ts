import type { EventRow } from '@/db/schema'
import { AppError, type ErrorCode } from '@/lib/errors'

export type Viewer =
  | { kind: 'host'; eventId: string; participantId: string; userId: string }
  /** With a token hash, this guest may not be on record yet. */
  | { kind: 'guest'; eventId: string; participantId: string; tokenHash?: string }
  /** Hasn't entered the PIN. */
  | { kind: 'locked'; eventId: string }

export type Action =
  | 'gallery.view'
  | 'photo.upload'
  | 'photo.heart'
  | 'comment.create'
  | 'photo.delete'
  | 'comment.delete'
  | 'photo.moderate'
  | 'comment.moderate'
  | 'photo.download'
  | 'photo.original'
  | 'album.manage'
  | 'tag.manage'
  | 'event.manage'
  | 'export.run'

export type Context = {
  event: Pick<EventRow, 'id' | 'frozenAt' | 'deletedAt' | 'settings'>
  /** Participants who own the photo or comment in question. */
  ownerIds?: string[]
}

/** The one place permissions are decided. Null means allowed; otherwise, why not. */
function refusal(viewer: Viewer, action: Action, { event, ownerIds = [] }: Context): ErrorCode | null {
  if (event.deletedAt || viewer.eventId !== event.id) return 'not_found'
  if (viewer.kind === 'locked') return 'pin_required'

  const host = viewer.kind === 'host'
  const frozen = event.frozenAt !== null && !host
  switch (action) {
    case 'gallery.view':
      return null
    case 'photo.upload':
      return frozen ? 'frozen' : null
    case 'photo.heart':
      return !event.settings.hearts ? 'feature_off' : frozen ? 'frozen' : null
    case 'comment.create':
      return !event.settings.comments ? 'feature_off' : frozen ? 'frozen' : null
    case 'photo.download':
      return host || event.settings.guestDownloads ? null : 'forbidden'
    case 'photo.delete':
    case 'comment.delete':
      return host || ownerIds.includes(viewer.participantId) ? null : 'forbidden'
    case 'photo.moderate':
    case 'comment.moderate':
    case 'photo.original':
    case 'album.manage':
    case 'tag.manage':
    case 'event.manage':
    case 'export.run':
      return host ? null : 'forbidden'
  }
}

export function can(viewer: Viewer, action: Action, ctx: Context): boolean {
  return refusal(viewer, action, ctx) === null
}

type Unlocked = Exclude<Viewer, { kind: 'locked' }>

export function requireCan(viewer: Viewer, action: Action, ctx: Context): asserts viewer is Unlocked {
  const why = refusal(viewer, action, ctx)
  if (why) throw new AppError(why)
}
