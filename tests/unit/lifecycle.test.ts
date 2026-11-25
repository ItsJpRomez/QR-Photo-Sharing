import { expect, test } from 'vitest'
import { photoStatus, type PhotoStatus } from '@/db/schema'
import { allowed } from '@/modules/photos/lifecycle'

const ARROWS: Record<PhotoStatus, PhotoStatus[]> = {
  reserved: ['uploaded', 'expired', 'deleted'],
  uploaded: ['processing', 'failed', 'deleted'],
  processing: ['pending', 'live', 'failed', 'duplicate', 'deleted'],
  pending: ['live', 'hidden', 'deleted'],
  live: ['hidden', 'deleted'],
  hidden: ['live', 'deleted'],
  failed: ['reserved', 'deleted'],
  expired: ['reserved', 'deleted'],
  duplicate: ['deleted'],
  deleted: [],
}

test.each(photoStatus.enumValues.flatMap((from) => photoStatus.enumValues.map((to) => [from, to] as const)))(
  '%s to %s',
  (from, to) => expect(allowed(from, to)).toBe(ARROWS[from].includes(to)),
)
