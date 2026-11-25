import { describe, expect, test } from 'vitest'
import { exportPath } from '@/modules/exports/names'

const base = { album: 'Dance Floor' as string | null, takenAt: new Date('2026-06-12T10:45:01Z'), timeZone: 'Asia/Manila', uploader: 'Ana', seq: 1, ext: 'jpg' }

test('album, time in the event zone, name, number', () =>
  expect(exportPath(base)).toBe('Dance Floor/2026-06-12_184501_Ana_0001.jpg'))
test('no album and no name', () =>
  expect(exportPath({ ...base, album: null, uploader: '', seq: 12345, ext: 'heic' })).toBe('No album/2026-06-12_184501_Guest_12345.heic'))

const nasty = ['../../x', '..', '.', 'CON', 'con', 'nul.txt', 'COM1', 'a/b:c*?', 'a\\b', 'trailing...', 'space ', '.hidden', '🎉🎉', '花'.repeat(40), 'x'.repeat(400), '‮gpj.exe', 'new\nline', '"<>|', '', 'שלום', 'niño']
describe.each(nasty)('%j', (text) => {
  const path = exportPath({ ...base, album: text, uploader: text })
  const parts = path.split('/')
  test('stays inside the archive, in one folder', () => {
    expect(parts).toHaveLength(2)
    for (const p of parts) {
      expect(p).not.toBe('')
      expect(p).not.toMatch(/^\.{1,2}$/)
      expect(p).not.toMatch(/^\./)
    }
  })
  test('is a valid name on Windows and Mac', () => {
    for (const p of parts) {
       
      expect(p).not.toMatch(/[\\:*?"<>|\u0000-\u001f‪-‮⁦-⁩]/)
      expect(p).not.toMatch(/[. ]$/)
      expect(p.split('.')[0]).not.toMatch(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i)
    }
    expect(path.normalize('NFC')).toBe(path)
  })
  test('is short enough', () => expect(Buffer.byteLength(path)).toBeLessThanOrEqual(180))
})

test('cutting never leaves half a character', () => {
  for (const c of ['👨‍👩‍👧', '花', 'é']) expect(exportPath({ ...base, uploader: c.repeat(60) })).not.toContain('�')
  expect(exportPath({ ...base, uploader: '👨‍👩‍👧'.repeat(60) })).toMatch(/_(👨‍👩‍👧)+_0001\.jpg$/u)
})
test('numbers keep every file apart', () => {
  const names = new Set(Array.from({ length: 5000 }, (_, i) => exportPath({ ...base, seq: i + 1 }).toLowerCase()))
  expect(names.size).toBe(5000)
})
