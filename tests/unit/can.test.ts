import { describe, expect, test } from 'vitest'
import { can, requireCan, type Action, type Viewer } from '@/modules/access/can'
import { DEFAULT_SETTINGS, type EventRow } from '@/db/schema'

const event = (over: Partial<EventRow> = {}, settings: Partial<EventRow['settings']> = {}): EventRow =>
  ({ id: 'E', frozenAt: null, deletedAt: null, settings: { ...DEFAULT_SETTINGS, ...settings }, ...over }) as EventRow

const host: Viewer = { kind: 'host', eventId: 'E', participantId: 'H', userId: 'U' }
const guest: Viewer = { kind: 'guest', eventId: 'E', participantId: 'G' }
const otherGuest: Viewer = { kind: 'guest', eventId: 'OTHER', participantId: 'X' }
const otherHost: Viewer = { kind: 'host', eventId: 'OTHER', participantId: 'Y', userId: 'V' }
const locked: Viewer = { kind: 'locked', eventId: 'E' }

const all: Action[] = [
  'gallery.view', 'photo.upload', 'photo.heart', 'comment.create', 'photo.delete', 'comment.delete', 'photo.moderate',
  'comment.moderate', 'photo.download', 'photo.original', 'album.manage', 'tag.manage', 'event.manage', 'export.run',
]
const guestOpen: Action[] = ['gallery.view', 'photo.upload', 'photo.heart', 'comment.create', 'photo.download']
const own = { ownerIds: ['G'] }

describe('host', () => {
  test.each(all)('may %s', (a) => expect(can(host, a, { event: event() })).toBe(true))
  test.each(all)('may %s while frozen', (a) => expect(can(host, a, { event: event({ frozenAt: new Date() }) })).toBe(true))
  test('may download when guests may not', () =>
    expect(can(host, 'photo.download', { event: event({}, { guestDownloads: false }) })).toBe(true))
  test('may not heart or comment when those are off', () => {
    expect(can(host, 'photo.heart', { event: event({}, { hearts: false }) })).toBe(false)
    expect(can(host, 'comment.create', { event: event({}, { comments: false }) })).toBe(false)
  })
})

describe('guest', () => {
  test.each(all)('%s on an open event', (a) => expect(can(guest, a, { event: event() })).toBe(guestOpen.includes(a)))
  test.each(['photo.delete', 'comment.delete'] as Action[])('%s only on their own', (a) => {
    expect(can(guest, a, { event: event(), ...own })).toBe(true)
    expect(can(guest, a, { event: event(), ownerIds: ['SOMEONE'] })).toBe(false)
    expect(can(guest, a, { event: event({ frozenAt: new Date() }), ...own })).toBe(true)
  })
  test.each([
    ['gallery.view', true],
    ['photo.download', true],
    ['photo.upload', false],
    ['photo.heart', false],
    ['comment.create', false],
  ] as [Action, boolean][])('%s while frozen: %s', (a, ok) =>
    expect(can(guest, a, { event: event({ frozenAt: new Date() }) })).toBe(ok))
  test('features switch off one by one', () => {
    expect(can(guest, 'photo.heart', { event: event({}, { hearts: false }) })).toBe(false)
    expect(can(guest, 'comment.create', { event: event({}, { hearts: false }) })).toBe(true)
    expect(can(guest, 'comment.create', { event: event({}, { comments: false }) })).toBe(false)
    expect(can(guest, 'photo.heart', { event: event({}, { comments: false }) })).toBe(true)
    expect(can(guest, 'photo.download', { event: event({}, { guestDownloads: false }) })).toBe(false)
  })
})

describe('everyone else', () => {
  test.each(all)('someone from another event may not %s', (a) => {
    expect(can(otherGuest, a, { event: event(), ownerIds: ['X'] })).toBe(false)
    expect(can(otherHost, a, { event: event(), ownerIds: ['Y'] })).toBe(false)
  })
  test.each(all)('a guest without the PIN may not %s', (a) => expect(can(locked, a, { event: event(), ownerIds: [] })).toBe(false))
  test.each(all)('nobody may %s on a deleted event', (a) => {
    expect(can(guest, a, { event: event({ deletedAt: new Date() }), ...own })).toBe(false)
    expect(can(host, a, { event: event({ deletedAt: new Date() }) })).toBe(false)
  })
})

describe('requireCan explains why', () => {
  const code = (v: Viewer, a: Action, e: EventRow) => {
    try {
      requireCan(v, a, { event: e })
      return 'ok'
    } catch (err) {
      return (err as { code: string }).code
    }
  }
  test('each reason', () => {
    expect(code(guest, 'photo.upload', event())).toBe('ok')
    expect(code(locked, 'gallery.view', event())).toBe('pin_required')
    expect(code(guest, 'photo.upload', event({ frozenAt: new Date() }))).toBe('frozen')
    expect(code(guest, 'photo.heart', event({}, { hearts: false }))).toBe('feature_off')
    expect(code(host, 'comment.create', event({}, { comments: false }))).toBe('feature_off')
    expect(code(guest, 'photo.download', event({}, { guestDownloads: false }))).toBe('forbidden')
    expect(code(guest, 'event.manage', event())).toBe('forbidden')
    expect(code(otherGuest, 'gallery.view', event())).toBe('not_found')
    expect(code(guest, 'gallery.view', event({ deletedAt: new Date() }))).toBe('not_found')
  })
})
