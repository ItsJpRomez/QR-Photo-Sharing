'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { patchPhotos } from '@/features/gallery/cache'
import { fetchPhotos } from '@/features/gallery/queries'
import { api } from '@/lib/api'
import type { OpenEventDto } from '@/modules/events/view'
import type { Operation } from '@/modules/photos/moderation'
import type { PhotoDto } from '@/modules/photos/query'

type Props = { event: OpenEventDto; photo: PhotoDto; className: string }

/** What the host can do to the photo on screen. */
export function HostTools({ event, photo, className }: Props) {
  const client = useQueryClient()
  const change = useMutation({
    mutationFn: (op: Operation) => api(`/api/host/events/${event.id}/moderate`, { method: 'POST', body: { ids: [photo.id], op } }),
    onSuccess: async () => patchPhotos(client, event.code, await fetchPhotos(event.code, [photo.id])),
  })
  const button = (kind: Exclude<Operation['kind'], 'move'>, label: string) => (
    <button key={kind} type="button" className={className} disabled={change.isPending} onClick={() => change.mutate({ kind })}>
      {label}
    </button>
  )
  return (
    <>
      {change.error && (
        <p role="alert" className="w-full rounded-control bg-danger px-3 py-2">
          {change.error.message}
        </p>
      )}
      {photo.status === 'pending' && button('approve', 'Approve')}
      {(photo.status === 'live' || photo.status === 'pending') && button('hide', 'Hide photo')}
      {photo.status === 'hidden' && button('unhide', 'Show photo')}
      {photo.featured ? button('unfeature', 'Stop featuring') : photo.status === 'live' && button('feature', 'Feature')}
      {event.albums.length > 0 && (
        <select
          aria-label="Album"
          className={`${className} !bg-black text-white`}
          value={photo.albumId ?? ''}
          disabled={change.isPending}
          onChange={(e) => change.mutate({ kind: 'move', albumId: e.target.value || null })}
        >
          <option value="">No album</option>
          {event.albums.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
    </>
  )
}
