import { z } from 'zod'

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

/** Characters as a person counts them, so an emoji is one. */
export function countCharacters(s: string): number {
  let n = 0
  for (const _ of segmenter.segment(s)) n++
  return n
}

export function firstCharacters(s: string, max: number): string {
  let out = ''
  let n = 0
  for (const { segment } of segmenter.segment(s)) {
    if (n++ === max) break
    out += segment
  }
  return out
}

// Control characters, and the invisible marks that can flip the direction of the text around them.
 
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g

type Options = { min?: number; multiline?: boolean }

/** Plain text of at most `max` characters, trimmed and cleaned. */
export function plainText(max: number, { min = 0, multiline = false }: Options = {}) {
  return z
    .string()
    .max(max * 12 + 100)
    .transform((s) => {
      const clean = s.replace(/\r\n?/g, '\n').replace(UNSAFE, '')
      return (multiline ? clean.replace(/\n{3,}/g, '\n\n') : clean.replace(/\s+/g, ' ')).trim()
    })
    .refine((s) => {
      const n = countCharacters(s)
      return n >= min && n <= max && s.length <= max * 12
    })
}

export const personName = plainText(40)
