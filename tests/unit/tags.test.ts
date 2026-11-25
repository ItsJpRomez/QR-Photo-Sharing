import { expect, test } from 'vitest'
import { parseTags } from '@/modules/events/tag-text'

test('tags are cleaned and matched without case', () => {
  expect(parseTags(['#BrideSquad', 'bridesquad', ' #Niño ', '#a b', '', '#' + 'x'.repeat(41)])).toEqual([
    { norm: 'bridesquad', display: 'BrideSquad' },
    { norm: 'niño', display: 'Niño' },
  ])
})
test('at most ten are kept', () => {
  const many = Array.from({ length: 11 }, (_, i) => `t${i}`)
  expect(parseTags(many).map((t) => t.norm)).toEqual(many.slice(0, 10))
})
test('letters of any language, digits and underscore', () => {
  expect(parseTags(['#花嫁', '#Table_4', '#עברית', '#हिंदी', '#no-dash', '#no!', '#🎉']).map((t) => t.display)).toEqual([
    '花嫁', 'Table_4', 'עברית', 'हिंदी',
  ])
})
test('the same accent typed two ways is one tag', () => {
  expect(parseTags(['niño', 'niño'])).toHaveLength(1)
})
test('exactly 40 characters is allowed', () => expect(parseTags(['x'.repeat(40)])).toHaveLength(1))
