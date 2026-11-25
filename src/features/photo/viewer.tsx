'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { patchPhotos } from '@/features/gallery/cache'
import { eventApi } from '@/features/gallery/queries'
import { tileLabel } from '@/features/gallery/photo-grid'
import { ConfirmDialog } from '@/features/ui/dialog'
import { api } from '@/lib/api'
import type { OpenEventDto } from '@/modules/events/view'
import type { PhotoDto } from '@/modules/photos/query'
import { PhotoImage } from './photo-image'

type Props = {
  event: OpenEventDto
  photo: PhotoDto
  previous: string | null
  next: string | null
  onMove: (id: string) => void
  onClose: () => void
  onStale: (id: string) => void
}

const SWIPE_PX = 60
const control =
  'grid min-h-11 min-w-11 place-items-center rounded-full bg-white/15 px-4 font-semibold text-white hover:bg-white/30 disabled:opacity-40 focus-visible:outline-flash'

export function Viewer({ event, photo, previous, next, onMove, onClose, onStale }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const client = useQueryClient()
  const [drag, setDrag] = useState<{ from: number; by: number } | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (el && !el.open) {
      el.showModal()
      el.focus() // the dialog itself, so no button looks pressed
    }
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = ''
    }
  }, [])

  const download = useMutation({
    mutationFn: (original: boolean) =>
      api<{ url: string }>(eventApi(event.code, `/photos/${photo.id}/download${original ? '?original=1' : ''}`)),
    onSuccess: ({ url }) => window.location.assign(url),
  })
  const remove = useMutation({
    mutationFn: () => api(eventApi(event.code, `/photos/${photo.id}`), { method: 'DELETE' }),
    onSuccess: () => {
      patchPhotos(client, event.code, { items: [], gone: [photo.id] })
      onClose()
    },
    onSettled: () => setDeleting(false),
  })

  const release = () => {
    if (drag && drag.by <= -SWIPE_PX && next) onMove(next)
    else if (drag && drag.by >= SWIPE_PX && previous) onMove(previous)
    setDrag(null)
  }
  const album = event.albums.find((a) => a.id === photo.albumId)
  const problem = download.error ?? remove.error

  return (
    <dialog
      ref={ref}
      aria-label={tileLabel(photo)}
      onCancel={(e) => {
        if (e.target !== ref.current) return
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => {
        if (deleting || (e.target as HTMLElement).closest('input, textarea')) return
        if (e.key === 'ArrowLeft' && previous) onMove(previous)
        if (e.key === 'ArrowRight' && next) onMove(next)
      }}
      tabIndex={-1}
      className="m-0 size-full max-h-none max-w-none bg-black text-white outline-none"
    >
      <div className="flex h-dvh flex-col">
        <div className="flex items-center justify-between gap-2 p-2">
          <button type="button" className={control} onClick={onClose}>
            Close
          </button>
          <div className="flex gap-2">
            <button type="button" className={control} aria-label="Previous photo" disabled={!previous} onClick={() => previous && onMove(previous)}>
              ‹
            </button>
            <button type="button" className={control} aria-label="Next photo" disabled={!next} onClick={() => next && onMove(next)}>
              ›
            </button>
          </div>
        </div>
        <div
          data-testid="stage"
          className="min-h-0 flex-1 touch-pan-y touch-pinch-zoom select-none"
          onPointerDown={(e) => e.isPrimary && setDrag({ from: e.clientX, by: 0 })}
          onPointerMove={(e) => drag && e.isPrimary && setDrag({ ...drag, by: e.clientX - drag.from })}
          onPointerUp={release}
          onPointerCancel={() => setDrag(null)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setDrag(null)}
        >
          <div className="size-full" style={{ transform: drag ? `translateX(${drag.by}px)` : undefined }}>
            <PhotoImage key={photo.id} photo={photo} size="display" fit="contain" onStale={onStale} className="size-full bg-center bg-no-repeat" />
          </div>
        </div>
        <div className="grid gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {problem && (
            <p role="alert" className="rounded-control bg-danger px-3 py-2 text-white">
              {problem.message}
            </p>
          )}
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="font-semibold">{photo.uploader}</span>
            {album && <span>{album.name}</span>}
            {photo.tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </p>
          <div className="flex flex-wrap gap-2">
            {photo.canDownload && (
              <button type="button" className={control} disabled={download.isPending} onClick={() => download.mutate(event.me.kind === 'host')}>
                Download
              </button>
            )}
            {photo.canDelete && (
              <button type="button" className={control} onClick={() => setDeleting(true)}>
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={deleting}
        title="Delete this photo?"
        confirm="Delete photo"
        busy={remove.isPending}
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      >
        <p>It leaves the gallery for everyone. This can&apos;t be undone.</p>
        {event.me.kind === 'guest' && (
          <p className="text-sm text-ink-soft">
            You can delete your photos only from this browser. If you clear your browser data, ask the host to delete them.
          </p>
        )}
      </ConfirmDialog>
    </dialog>
  )
}
