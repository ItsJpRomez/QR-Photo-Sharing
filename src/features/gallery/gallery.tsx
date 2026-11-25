'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getQueue } from '@/features/upload-queue/use-queue'
import { Viewer } from '@/features/photo/viewer'
import { plural } from '@/features/host/format'
import { Button } from '@/features/ui/button'
import { Notice } from '@/features/ui/field'
import { textOn } from '@/lib/color'
import type { OpenEventDto } from '@/modules/events/view'
import { AddSheet } from './add-sheet'
import { Hero } from './hero'
import { PhotoGrid } from './photo-grid'
import { usePhoto, usePhotos, useRefreshPhotos, useTrending } from './queries'
import { setAddress, useAddress } from './use-address'
import { UploadBar } from './upload-bar'
import { useLive } from './use-live'
import { Views } from './views'

const EMPTY: Record<string, string> = {
  hearted: 'No hearts yet. Tap the heart on a photo you love.',
  featured: 'The host hasn’t featured any photos yet.',
  mine: 'You haven’t added any photos yet.',
}

function emptyText(view: string, canUpload: boolean): string {
  if (view in EMPTY) return EMPTY[view]!
  if (view !== 'all') return 'No photos here yet.'
  return canUpload ? 'Be the first to add a photo.' : 'No photos were added.'
}

export function Gallery({ event }: { event: OpenEventDto }) {
  const { code } = event
  const { view, order, photo: openId } = useAddress()
  const { data: trending = [] } = useTrending(code)
  const photos = usePhotos(code, view, order)
  const refresh = useRefreshPhotos(code)
  const live = useLive({ event, view, order })
  const [adding, setAdding] = useState(false)
  const list = useMemo(() => photos.data?.pages.flatMap((p) => p.items) ?? [], [photos.data])
  const at = openId ? list.findIndex((p) => p.id === openId) : -1
  const elsewhere = usePhoto(code, openId, list[at])
  const open = list[at] ?? elsewhere.data ?? undefined

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = photos
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  // Photos that were waiting for the PIN, the new link or the host can go on.
  useEffect(() => {
    getQueue().resumeAccess(event.id, code)
  }, [event.id, code])
  useEffect(() => {
    if (event.canUpload) getQueue().reopen(event.id)
  }, [event.id, event.canUpload])

  // Opening a photo adds one step to the history; moving between photos doesn't.
  const pushed = useRef(false)
  const openPhoto = (id: string) => {
    pushed.current = true
    setAddress({ photo: id }, 'push')
  }
  const closePhoto = () => {
    if (pushed.current) window.history.back()
    else setAddress({ photo: null })
    pushed.current = false
  }
  const lastOpen = useRef<string | null>(null)
  useEffect(() => {
    if (!openId && lastOpen.current) {
      document.querySelector<HTMLElement>(`[data-photo="${CSS.escape(lastOpen.current)}"]`)?.focus({ preventScroll: true })
    }
    lastOpen.current = openId
  }, [openId])

  useEffect(() => {
    if (open && at >= list.length - 3) loadMore()
  }, [open, at, list.length, loadMore])

  return (
    <>
      <Hero name={event.name} welcome={event.welcome} coverUrl={event.coverUrl} accent={event.accent} />
      <Views event={event} trending={trending} />
      <main className="pb-28">
        {event.frozen && (
          <p role="status" className="bg-plum-wash px-4 py-3 text-center font-semibold">
            Uploads are closed. You can still look through the photos.
          </p>
        )}
        {!event.frozen && event.full && (
          <p role="status" className="bg-plum-wash px-4 py-3 text-center font-semibold">
            This gallery is full.
          </p>
        )}
        {photos.error && (
          <div className="mx-auto grid max-w-md gap-3 p-6">
            <Notice tone="danger">{photos.error.message}</Notice>
            <Button variant="secondary" onClick={() => photos.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {photos.isPending && (
          <p role="status" className="p-8 text-center text-ink-soft">
            Loading photos…
          </p>
        )}
        {photos.data && list.length === 0 && (
          <p className="px-6 py-16 text-center font-display text-2xl font-bold">{emptyText(view, event.canUpload)}</p>
        )}
        <PhotoGrid photos={list} hasMore={hasNextPage} loadMore={loadMore} onOpen={openPhoto} onStale={refresh} arrived={live.arrived} />
        {isFetchingNextPage && (
          <p role="status" className="p-4 text-center text-ink-soft">
            Loading more…
          </p>
        )}
      </main>
      {live.held > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-20 grid justify-items-center">
          <button type="button" className="pointer-events-auto min-h-11 rounded-full bg-flash px-6 font-bold text-ink" onClick={live.showHeld}>
            {plural(live.held, 'new photo')}
          </button>
        </div>
      )}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 grid justify-items-center gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <UploadBar eventId={event.id} code={code} />
        {event.canUpload && (
          <button
            type="button"
            className="pointer-events-auto min-h-14 rounded-full px-8 text-lg font-bold shadow-[0_4px_0_rgb(0_0_0/0.25)]"
            style={{ background: event.accent, color: textOn(event.accent) }}
            onClick={() => setAdding(true)}
          >
            Add photos
          </button>
        )}
      </div>
      {adding && <AddSheet event={event} onClose={() => setAdding(false)} />}
      {open && (
        <Viewer
          event={event}
          photo={open}
          previous={list[at - 1]?.id ?? null}
          next={at >= 0 ? (list[at + 1]?.id ?? null) : null}
          onMove={(id) => setAddress({ photo: id })}
          onClose={closePhoto}
          onStale={refresh}
        />
      )}
    </>
  )
}
