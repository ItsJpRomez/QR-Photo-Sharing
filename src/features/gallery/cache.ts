import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { PhotoDto } from '@/modules/photos/query'

export type Page = { items: PhotoDto[]; next: string | null }
export type PhotoPages = InfiniteData<Page, string | null>
export type Fetched = { items: PhotoDto[]; gone: string[] }

export const qk = {
  event: (code: string) => ['e', code, 'event'] as const,
  tags: (code: string) => ['e', code, 'tags'] as const,
  allPhotos: (code: string) => ['e', code, 'photos'] as const,
  photos: (code: string, view: string, order: string) => ['e', code, 'photos', view, order] as const,
  photo: (code: string, id: string) => ['e', code, 'photo', id] as const,
  comments: (photoId: string) => ['comments', photoId] as const,
}

/** Updates photos wherever they're shown, and takes away the ones that are gone. */
export function patchPhotos(client: QueryClient, code: string, { items, gone }: Fetched): void {
  const fresh = new Map(items.map((p) => [p.id, p]))
  const lost = new Set(gone)
  client.setQueriesData<PhotoPages>({ queryKey: qk.allPhotos(code) }, (data) => {
    if (!data) return data
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((p) => !lost.has(p.id)).map((p) => fresh.get(p.id) ?? p),
      })),
    }
  })
  for (const p of items) client.setQueryData(qk.photo(code, p.id), p)
  for (const id of gone) client.setQueryData(qk.photo(code, id), null)
}

/** Whether a photo belongs in a view. The server decides what may be seen; this only sorts. */
export function matchesView(p: PhotoDto, view: string): boolean {
  if (view.startsWith('album:')) return p.albumId === view.slice(6)
  if (view.startsWith('tag:')) return p.tags.some((t) => t.toLowerCase() === view.slice(4))
  switch (view) {
    case 'all':
      return p.status !== 'reserved' && p.status !== 'failed'
    case 'featured':
      return p.featured
    case 'mine':
      return p.mine
    case 'hearted':
      return (p.heartCount ?? 0) > 0
    case 'waiting':
      return p.status === 'pending'
    case 'hidden':
    case 'failed':
      return p.status === view
    default:
      return false
  }
}

export function knownIds(client: QueryClient, key: readonly unknown[]): Set<string> {
  return new Set(client.getQueryData<PhotoPages>(key)?.pages.flatMap((p) => p.items.map((i) => i.id)) ?? [])
}

/** Puts new photos at the top of a newest-first list, the last one given first. */
export function insertNewest(client: QueryClient, key: readonly unknown[], items: PhotoDto[]): void {
  const known = knownIds(client, key)
  const added = items.filter((p) => !known.has(p.id)).toReversed()
  if (!added.length) return
  client.setQueryData<PhotoPages>(key, (data) => {
    const [first, ...rest] = data?.pages ?? []
    if (!data || !first) return data
    return { ...data, pages: [{ ...first, items: [...added, ...first.items] }, ...rest] }
  })
}
