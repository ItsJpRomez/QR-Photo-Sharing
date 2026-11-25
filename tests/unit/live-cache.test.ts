import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, test } from 'vitest'
import { insertNewest, matchesView, patchPhotos, qk, type PhotoPages } from '@/features/gallery/cache'
import type { PhotoDto } from '@/modules/photos/query'

const photo = (id: string, over: Partial<PhotoDto> = {}): PhotoDto => ({
  id, status: 'live', thumbUrl: 't', displayUrl: 'd', width: 1, height: 1, thumbhash: null, takenAt: null, publishedAt: null, uploader: 'A',
  albumId: null, tags: [], featured: false, mine: false, canDelete: false, canDownload: true, ...over,
})
let client: QueryClient
const key = qk.photos('C', 'all', '')
const ids = () => client.getQueryData<PhotoPages>(key)!.pages.flatMap((p) => p.items.map((i) => i.id))
beforeEach(() => {
  client = new QueryClient()
  client.setQueryData<PhotoPages>(key, { pageParams: [null, 'x'], pages: [{ items: [photo('a'), photo('b')], next: 'x' }, { items: [photo('c')], next: null }] })
})

test('photos are updated in place and gone ones removed', () => {
  patchPhotos(client, 'C', { items: [photo('b', { uploader: 'New' })], gone: ['c'] })
  expect(ids()).toEqual(['a', 'b'])
  expect(client.getQueryData<PhotoPages>(key)!.pages[0]!.items[1]!.uploader).toBe('New')
})
test('new photos go on top, once, newest first', () => {
  insertNewest(client, key, [photo('n1'), photo('n2')])
  insertNewest(client, key, [photo('n2'), photo('a')])
  expect(ids()).toEqual(['n2', 'n1', 'a', 'b', 'c'])
})
test('another event is left alone', () => {
  patchPhotos(client, 'OTHER', { items: [], gone: ['a'] })
  expect(ids()).toEqual(['a', 'b', 'c'])
})
describe('which view a photo belongs in', () => {
  test.each([
    ['all', {}, true],
    ['album:1', { albumId: '1' }, true],
    ['album:1', { albumId: '2' }, false],
    ['tag:niño', { tags: ['Niño'] }, true],
    ['tag:x', { tags: ['Niño'] }, false],
    ['featured', { featured: true }, true],
    ['featured', {}, false],
    ['mine', { mine: true }, true],
    ['mine', {}, false],
    ['waiting', { status: 'pending' }, true],
    ['waiting', {}, false],
    ['hidden', { status: 'hidden' }, true],
  ] as [string, Partial<PhotoDto>, boolean][])('%s %j: %s', (view, over, yes) => expect(matchesView(photo('p', over), view)).toBe(yes))
})
