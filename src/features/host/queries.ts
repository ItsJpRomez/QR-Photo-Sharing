'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AlbumRow } from '@/db/schema'
import type { HostEventDto } from '@/modules/events/events'

export type HostTag = { id: string; display: string; norm: string; suggested: boolean; blocked: boolean; count: number }

export const hk = {
  events: ['host', 'events'] as const,
  event: (id: string) => ['host', 'event', id] as const,
  albums: (id: string) => ['host', 'event', id, 'albums'] as const,
  tags: (id: string) => ['host', 'event', id, 'tags'] as const,
}

export const eventPath = (id: string, rest = '') => `/api/host/events/${id}${rest}`

export function useHostEvents() {
  return useQuery({ queryKey: hk.events, queryFn: () => api<{ events: HostEventDto[] }>('/api/host/events').then((r) => r.events) })
}

export function useHostEvent(id: string, initialData?: HostEventDto) {
  return useQuery({ queryKey: hk.event(id), queryFn: () => api<HostEventDto>(eventPath(id)), initialData })
}

/** A change that returns the whole event, which replaces what's on screen. */
export function useEventChange<T>(id: string, send: (input: T) => Promise<HostEventDto>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: send,
    onSuccess: (event) => {
      client.setQueryData(hk.event(id), event)
      void client.invalidateQueries({ queryKey: hk.events })
    },
  })
}

export function useAlbums(id: string) {
  return useQuery({ queryKey: hk.albums(id), queryFn: () => api<{ albums: AlbumRow[] }>(eventPath(id, '/albums')).then((r) => r.albums) })
}

export function useTags(id: string) {
  return useQuery({ queryKey: hk.tags(id), queryFn: () => api<{ tags: HostTag[] }>(eventPath(id, '/tags')).then((r) => r.tags) })
}
