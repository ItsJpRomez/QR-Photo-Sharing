import { describe, expect, test } from 'vitest'
import { current, empty, slidesReducer as reduce, upcoming, type Slides, type TvPhoto } from '@/features/tv/slides'

const p = (id: string, url = id): TvPhoto => ({ id, displayUrl: url, uploader: null, album: null })
const start = (...ids: string[]): Slides => reduce(empty, { type: 'replace', photos: ids.map((i) => p(i)) })
const play = (s: Slides, n: number) => {
  const seen: (string | undefined)[] = []
  for (let i = 0; i < n; i++) {
    s = reduce(s, { type: 'tick' })
    seen.push(current(s)?.id)
  }
  return seen
}

test('it cycles', () => expect(play(start('a', 'b', 'c'), 5)).toEqual(['b', 'c', 'a', 'b', 'c']))
test('one photo stays put; none is none', () => {
  expect(play(start('a'), 2)).toEqual(['a', 'a'])
  expect(current(empty)).toBeNull()
  expect(play(empty, 1)).toEqual([undefined])
})
test('new photos come next, oldest first, then it goes on where it was', () => {
  let s = start('a', 'b', 'c')
  s = reduce(s, { type: 'add', photos: [p('x')] })
  s = reduce(s, { type: 'add', photos: [p('y')] })
  expect(current(s)?.id).toBe('a')
  expect(play(s, 6)).toEqual(['x', 'y', 'b', 'c', 'a', 'x'])
})
test('the first photo ever shows at once', () => {
  expect(current(reduce(empty, { type: 'add', photos: [p('x')] }))?.id).toBe('x')
})
test('adding one that is known only refreshes it', () => {
  const s = reduce(start('a', 'b'), { type: 'add', photos: [p('b', 'new-url')] })
  expect(s.fresh).toEqual([])
  expect(s.queue.find((x) => x.id === 'b')!.displayUrl).toBe('new-url')
})
describe('removing', () => {
  test('the one on screen moves on at once', () => {
    const s = reduce(reduce(start('a', 'b', 'c'), { type: 'tick' }), { type: 'remove', ids: ['b'] })
    expect(current(s)?.id).toBe('c')
    expect(play(s, 2)).toEqual(['a', 'c'])
  })
  test('the last in line wraps to the first', () => {
    let s = start('a', 'b')
    s = reduce(s, { type: 'tick' })
    expect(current(reduce(s, { type: 'remove', ids: ['b'] }))?.id).toBe('a')
  })
  test('an earlier one does not change what is on screen', () => {
    const s = reduce(reduce(start('a', 'b', 'c'), { type: 'tick' }), { type: 'remove', ids: ['a'] })
    expect(current(s)?.id).toBe('b')
  })
  test('one still waiting never shows', () => {
    let s = reduce(start('a', 'b'), { type: 'add', photos: [p('x')] })
    s = reduce(s, { type: 'remove', ids: ['x'] })
    expect(play(s, 3)).toEqual(['b', 'a', 'b'])
  })
  test('all of them leaves nothing', () => expect(current(reduce(start('a', 'b'), { type: 'remove', ids: ['a', 'b'] }))).toBeNull())
})
test('a full refresh keeps the place, takes away what is gone and lines up what is new', () => {
  let s = reduce(start('a', 'b', 'c'), { type: 'tick' })
  s = reduce(s, { type: 'replace', photos: [p('n'), p('b', 'fresh'), p('c')] })
  expect(current(s)).toMatchObject({ id: 'b', displayUrl: 'fresh' })
  expect(play(s, 4)).toEqual(['n', 'c', 'b', 'n'])
})
test('at most 200 are kept, letting go of the oldest', () => {
  let s = start(...Array.from({ length: 200 }, (_, i) => `p${i}`))
  for (let i = 0; i < 50; i++) s = reduce(reduce(s, { type: 'add', photos: [p(`n${i}`)] }), { type: 'tick' })
  expect(s.queue.length).toBe(200)
  expect(new Set(s.queue.map((x) => x.id)).size).toBe(200)
  expect(current(s)?.id).toBe('n49')
})
test('it knows what comes next, for loading ahead', () => {
  const s = reduce(start('a', 'b'), { type: 'add', photos: [p('x')] })
  expect(upcoming(s, 3).map((x) => x.id)).toEqual(['x', 'b', 'a'])
})
