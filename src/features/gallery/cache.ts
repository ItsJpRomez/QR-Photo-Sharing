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
