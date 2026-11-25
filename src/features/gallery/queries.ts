'use client'

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import type { LockedEventDto, OpenEventDto } from '@/modules/events/view'
import type { PhotoDto } from '@/modules/photos/query'
import type { TrendingTag } from '@/modules/events/tags'
import { patchPhotos, qk, type Fetched, type Page } from './cache'

export type EventDto = LockedEventDto | OpenEventDto

export const eventApi = (code: string, rest = '') => `/api/e/${encodeURIComponent(code)}${rest}`

export function useEvent(code: string, initialData: EventDto) {
  return useQuery({ queryKey: qk.event(code), queryFn: () => api<EventDto>(eventApi(code)), initialData })
}

export function useTrending(code: string) {
  return useQuery({
    queryKey: qk.tags(code),
    queryFn: () => api<{ trending: TrendingTag[] }>(eventApi(code, '/tags')).then((r) => r.trending),
  })
}

export function usePhotos(code: string, view: string, order: string) {
  return useInfiniteQuery({
    queryKey: qk.photos(code, view, order),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ view })
      if (order) q.set('order', order)
      if (pageParam) q.set('cursor', pageParam)
      return api<Page>(eventApi(code, `/photos?${q}`))
    },
    getNextPageParam: (last) => last.next,
  })
}

export const fetchPhotos = (code: string, ids: string[]) => api<Fetched>(eventApi(code, `/photos?ids=${ids.join(',')}`))

export function usePhoto(code: string, id: string | null, known: PhotoDto | undefined) {
  return useQuery({
    queryKey: qk.photo(code, id ?? ''),
    enabled: id !== null && !known,
    queryFn: () => fetchPhotos(code, [id!]).then((r) => r.items[0] ?? null),
  })
}

/** Collects photos that need fetching and asks for them together. */
export function useRefreshPhotos(code: string): (id: string) => void {
  const client = useQueryClient()
  const wanted = useRef(new Set<string>())
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return useCallback(
    (id: string) => {
      wanted.current.add(id)
      timer.current ??= setTimeout(async () => {
        timer.current = undefined
        const ids = [...wanted.current].slice(0, 100)
        for (const i of ids) wanted.current.delete(i)
        try {
          patchPhotos(client, code, await fetchPhotos(code, ids))
        } catch {
          // Offline: the images show as not loaded until the next refresh.
        }
      }, 250)
    },
    [client, code],
  )
}
