export type ParsedTag = { norm: string; display: string }

export const MAX_TAGS = 10
const TAG = /^[\p{L}\p{M}\p{N}_]{1,40}$/u

/** Cleans what people typed. Anything that can't be a hashtag is dropped. */
export function parseTags(raw: string[]): ParsedTag[] {
  const found = new Map<string, ParsedTag>()
  for (const item of raw) {
    const display = item.trim().replace(/^#/, '').normalize('NFC')
    if (!TAG.test(display)) continue
    const norm = display.toLowerCase()
    if (!found.has(norm)) found.set(norm, { norm, display })
    if (found.size === MAX_TAGS) break
  }
  return [...found.values()]
}
