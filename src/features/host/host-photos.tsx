'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { qk } from '@/features/gallery/cache'
import { PhotoGrid } from '@/features/gallery/photo-grid'
import { eventApi, usePhotos, useRefreshPhotos } from '@/features/gallery/queries'
import { useLive } from '@/features/gallery/use-live'
import { Viewer } from '@/features/photo/viewer'
import { Button } from '@/features/ui/button'
import { ConfirmDialog } from '@/features/ui/dialog'
import { Notice, Select } from '@/features/ui/field'
import { api } from '@/lib/api'
import type { OpenEventDto } from '@/modules/events/view'
import type { Operation } from '@/modules/photos/moderation'
import { plural } from './format'
import { eventPath, useHostEvent } from './queries'

const VIEWS = [
  ['all', 'All photos'],
  ['featured', 'Featured'],
  ['hidden', 'Hidden'],
  ['failed', 'Failed'],
] as const

const EMPTY: Record<string, string> = {
  all: 'No photos yet. Share the QR code so guests can start adding them.',
  featured: 'Nothing is featured yet.',
  hidden: 'Nothing is hidden.',
  failed: 'Nothing failed.',
  waiting: 'Nothing is waiting',
}

/** The host sees the event as the gallery does, which is what keeps it live. */
function useGalleryEvent(code: string | undefined) {
  return useQuery({
    queryKey: qk.event(code ?? ''),
    enabled: code !== undefined,
    queryFn: () => api<OpenEventDto>(eventApi(code!)),
  })
}

export function HostPhotos({ id, waiting = false }: { id: string; waiting?: boolean }) {
  const { data: host } = useHostEvent(id)
  const { data: event, error } = useGalleryEvent(host?.code)
  if (error) return <Notice tone="danger">{error.message}</Notice>
  if (!event) return <p role="status">Loading photos…</p>
  return <Photos id={id} event={event} waiting={waiting} />
}

function Photos({ id, event, waiting }: { id: string; event: OpenEventDto; waiting: boolean }) {
  const { code } = event
  const [filter, setFilter] = useState<string>('all')
  const view = waiting ? 'waiting' : filter
  const photos = usePhotos(code, view, 'newest')
  const live = useLive({ event, view, order: 'newest' })
  const refresh = useRefreshPhotos(code)
  const list = useMemo(() => photos.data?.pages.flatMap((p) => p.items) ?? [], [photos.data])
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const chosen = list.filter((p) => selected?.has(p.id)).map((p) => p.id)

  const change = useMutation({
    mutationFn: (op: Operation) => api(eventPath(id, '/moderate'), { method: 'POST', body: { ids: chosen, op } }),
    onSuccess: () => setSelected(null),
    onSettled: () => {
      setDeleting(false)
      void photos.refetch()
    },
  })
  const approveAll = useMutation({
    mutationFn: () => api(eventPath(id, '/approve-all'), { method: 'POST' }),
    onSettled: () => photos.refetch(),
  })

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = photos
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const toggle = (photoId: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (!next.delete(photoId)) next.add(photoId)
      return next
    })
  const at = list.findIndex((p) => p.id === openId)
  const problem = photos.error ?? change.error ?? approveAll.error
  const none = chosen.length === 0 || change.isPending
  const act = (kind: Exclude<Operation['kind'], 'move'>, label: string) => (
    <Button key={kind} variant="secondary" size="sm" disabled={none} onClick={() => change.mutate({ kind })}>
      {label}
    </Button>
  )

  return (
    <div className="grid gap-4">
      {problem && <Notice tone="danger">{problem.message}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        {selected === null ? (
          <>
            {!waiting && (
              <Select aria-label="Show" className="max-w-48" value={filter} onChange={(e) => setFilter(e.target.value)}>
                {VIEWS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
            {waiting && (
              <Button disabled={!list.length || approveAll.isPending} onClick={() => approveAll.mutate()}>
                Approve all
              </Button>
            )}
            <Button variant="secondary" disabled={!list.length} onClick={() => setSelected(new Set())}>
              Select
            </Button>
            {live.held > 0 && (
              <Button variant="quiet" onClick={live.showHeld}>
                {plural(live.held, 'new photo')}
              </Button>
            )}
          </>
        ) : (
          <div className="sticky top-0 z-10 flex w-full flex-wrap items-center gap-2 bg-paper py-2">
            <p role="status" className="mr-2 font-semibold">
              {chosen.length} selected
            </p>
            {waiting && act('approve', 'Approve')}
            {view === 'hidden' ? act('unhide', 'Show') : act('hide', 'Hide')}
            {view === 'featured' ? act('unfeature', 'Stop featuring') : !waiting && act('feature', 'Feature')}
            {event.albums.length > 0 && (
              <Select
                aria-label="Move to"
                className="max-w-44"
                value=""
                disabled={none}
                onChange={(e) => change.mutate({ kind: 'move', albumId: e.target.value === 'none' ? null : e.target.value })}
              >
                <option value="" disabled>
                  Move to…
                </option>
                <option value="none">No album</option>
                {event.albums.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
            <Button variant="danger" size="sm" disabled={none} onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setSelected(null)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
      {photos.isPending && <p role="status">Loading photos…</p>}
      {photos.data && list.length === 0 && <p className="py-10 text-lg text-ink-soft">{EMPTY[view]}</p>}
      <PhotoGrid
        photos={list}
        hasMore={hasNextPage}
        loadMore={loadMore}
        onStale={refresh}
        arrived={live.arrived}
        selected={selected ?? undefined}
        onOpen={selected ? toggle : setOpenId}
      />
      {list[at] && (
        <Viewer
          event={event}
          photo={list[at]}
          previous={list[at - 1]?.id ?? null}
          next={list[at + 1]?.id ?? null}
          onMove={setOpenId}
          onClose={() => setOpenId(null)}
          onStale={refresh}
        />
      )}
      <ConfirmDialog
        open={deleting}
        title={`Delete ${plural(chosen.length, 'photo')}?`}
        confirm={`Delete ${plural(chosen.length, 'photo')}`}
        busy={change.isPending}
        onClose={() => setDeleting(false)}
        onConfirm={() => change.mutate({ kind: 'delete' })}
      >
        <p>They&apos;re removed for everyone, with their hearts and comments. This can&apos;t be undone.</p>
      </ConfirmDialog>
    </div>
  )
}
