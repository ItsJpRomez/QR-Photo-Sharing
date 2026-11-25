import type { EventRow, GalleryOrder, ParticipantRow } from '@/db/schema'
import { can, type Viewer } from '@/modules/access/can'
import { storage } from '@/modules/storage'
import { listAlbums } from './albums'
import { listSuggestedTags } from './tags'

export type LockedEventDto = { name: string; coverUrl: string | null; welcome: string; pinRequired: true }

export type OpenEventDto = {
  id: string
  code: string
  name: string
  coverUrl: string | null
  welcome: string
  accent: string
  pinRequired: false
  hasPin: boolean
  features: { hearts: boolean; comments: boolean; downloads: boolean; approval: boolean }
  defaultOrder: GalleryOrder
  frozen: boolean
  full: boolean
  canUpload: boolean
  albums: { id: string; name: string }[]
  suggestedTags: string[]
  me: { kind: 'host' | 'guest'; participantId: string; name: string }
}

export async function coverUrl(event: EventRow): Promise<string | null> {
  return event.coverKey ? storage.signGet(event.coverKey) : null
}

export async function lockedEvent(event: EventRow): Promise<LockedEventDto> {
  return { name: event.name, coverUrl: await coverUrl(event), welcome: event.welcome, pinRequired: true }
}

export async function openEvent(event: EventRow, viewer: Exclude<Viewer, { kind: 'locked' }>, me: ParticipantRow): Promise<OpenEventDto> {
  const [albums, tags] = await Promise.all([listAlbums(event.id), listSuggestedTags(event.id)])
  const full = event.usedPhotos >= event.maxPhotos || event.usedBytes >= event.maxBytes
  return {
    id: event.id,
    code: event.code,
    name: event.name,
    coverUrl: await coverUrl(event),
    welcome: event.welcome,
    accent: event.accent,
    pinRequired: false,
    hasPin: event.pinHash !== null,
    features: {
      hearts: event.settings.hearts,
      comments: event.settings.comments,
      downloads: can(viewer, 'photo.download', { event }),
      approval: event.settings.approval,
    },
    defaultOrder: event.settings.defaultOrder,
    frozen: event.frozenAt !== null,
    full,
    canUpload: can(viewer, 'photo.upload', { event }) && !full,
    albums: albums.map(({ id, name }) => ({ id, name })),
    suggestedTags: tags.map((t) => t.display),
    me: { kind: viewer.kind, participantId: viewer.participantId, name: me.name },
  }
}
