import { formatInTimeZone } from 'date-fns-tz'

// Not allowed by Windows or Mac, or able to disguise a name.
 
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]+/g
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i
const MAX_BYTES = 60

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

/** Cut between whole characters, so none is left broken. */
function cut(text: string, maxBytes: number): string {
  let out = ''
  for (const { segment } of segmenter.segment(text)) {
    if (Buffer.byteLength(out + segment) > maxBytes) break
    out += segment
  }
  return out
}

function part(text: string, fallback: string): string {
  const tidy = (s: string) => s.replace(/^[. ]+|[. ]+$/g, '')
  const clean = tidy(cut(tidy(text.normalize('NFC').replace(UNSAFE, ' ').replace(/\s+/g, ' ')), MAX_BYTES))
  if (!clean) return fallback
  return RESERVED.test(clean.split('.')[0]!.trim()) ? `_${clean}` : clean
}

type Named = { album: string | null; takenAt: Date; timeZone: string; uploader: string; seq: number; ext: string }

/** Where a photo goes in the archive. The number keeps every file apart. */
export function exportPath(p: Named): string {
  const when = formatInTimeZone(p.takenAt, p.timeZone, 'yyyy-MM-dd_HHmmss')
  const number = String(p.seq).padStart(4, '0')
  return `${part(p.album ?? '', 'No album')}/${when}_${part(p.uploader, 'Guest')}_${number}.${p.ext}`
}
