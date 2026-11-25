import { expect, test } from 'vitest'
import { contrast, textOn } from '@/lib/color'

test('contrast follows WCAG', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1)
  expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  expect(contrast('#4a2370', '#4a2370')).toBe(1)
})
test('text on any color passes AA', () => {
  for (let i = 0; i < 4096; i++) {
    const bg = `#${i.toString(16).padStart(3, '0').replace(/./g, '$&$&')}`
    expect(contrast(bg, textOn(bg)), bg).toBeGreaterThanOrEqual(4.5)
  }
})
