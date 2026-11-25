'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { plural } from '@/features/host/format'
import { Button } from '@/features/ui/button'
import type { QueueItem } from '@/features/upload-queue/types'
import { getQueue, useQueueItems } from '@/features/upload-queue/use-queue'
import { errorMessage, isErrorCode } from '@/lib/error-text'
import { qk } from './cache'

function stateText(i: QueueItem): string {
  switch (i.state) {
    case 'waiting':
      return 'Waiting'
    case 'uploading':
      return `Uploading ${Math.round(i.progress * 100)}%`
    case 'offline':
      return 'No signal, will retry'
    case 'added':
      return i.reason === 'already_added' ? 'Already added' : 'Added'
    case 'waiting_for_host':
      return 'Waiting for host'
    case 'closed':
      return 'The host closed uploads'
    case 'needs_access':
      return 'Paused: enter the PIN, or open the new link from the host'
    case 'failed':
      if (i.reason === 'lost') return 'Failed: this browser no longer has the photo. Please choose it again.'
      return `Failed: ${isErrorCode(i.reason) ? errorMessage(i.reason) : 'Something went wrong. Please try again.'}`
  }
}

const CAN_RETRY = (i: QueueItem) => i.state === 'failed' && !['removed_by_host', 'too_large', 'bad_type', 'lost', 'conflict'].includes(i.reason ?? '')

export function queueSummary(items: readonly QueueItem[]): string {
  const left = items.filter((i) => !i.settled && i.state !== 'added' && i.state !== 'failed')
  const failed = items.filter((i) => i.state === 'failed').length
  const waiting = items.filter((i) => i.state === 'waiting_for_host').length
  const added = items.filter((i) => i.state === 'added').length
  if (left.length) {
    if (left.every((i) => i.state === 'offline')) return 'No signal, will retry'
    if (left.every((i) => i.state === 'closed')) return 'The host closed uploads'
    if (left.every((i) => i.state === 'needs_access')) return `${plural(left.length, 'photo')} paused. Enter the PIN, or open the new link from the host.`
    return `Uploading ${items.length - left.length + 1} of ${items.length}`
  }
  const parts = [
    added ? `${plural(added, 'photo')} added` : '',
    waiting ? `${plural(waiting, 'photo')} waiting for host` : '',
    failed ? `${plural(failed, 'photo')} failed` : '',
  ]
  return parts.filter(Boolean).join(', ')
}

/** Progress, small enough to keep browsing. */
export function UploadBar({ eventId, code }: { eventId: string; code: string }) {
  const client = useQueryClient()
  const items = useQueueItems().filter((i) => i.eventId === eventId)
  const [open, setOpen] = useState(false)
  const paused = items.some((i) => i.state === 'needs_access')
  const arrived = items.filter((i) => i.state === 'added').length
  const settled = items.filter((i) => i.settled).length
  const failed = items.some((i) => i.state === 'failed')

  // Find out whether it's the PIN or the link that changed.
  useEffect(() => {
    if (paused) void client.invalidateQueries({ queryKey: qk.event(code) })
  }, [paused, client, code])

  useEffect(() => {
    if (arrived + settled) void client.invalidateQueries({ queryKey: qk.allPhotos(code) })
  }, [arrived, settled, client, code])

  if (!items.length) return null
  const done = items.every((i) => i.settled || i.state === 'added')
  const progress = items.reduce((sum, i) => sum + (i.settled || i.state === 'added' ? 1 : i.progress), 0) / items.length
  const expanded = open || failed
  return (
    <section aria-label="Your uploads" className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-sheet border border-line bg-sheet text-ink">
      {!done && <progress className="sr-only" aria-label="Upload progress" value={progress} max={1} />}
      <div aria-hidden className="h-1.5 bg-line">
        <div className="h-full origin-left bg-plum transition-transform" style={{ transform: `scaleX(${progress})` }} />
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <p role="status" className="font-semibold">
          {queueSummary(items)}
        </p>
        <div className="flex shrink-0">
          <Button variant="quiet" size="sm" aria-expanded={expanded} onClick={() => setOpen(!open)}>
            Details
          </Button>
          {done && (
            <Button variant="quiet" size="sm" onClick={() => getQueue().clearFinished()}>
              Done
            </Button>
          )}
        </div>
      </div>
      {!done && items.some((i) => !i.persisted && !i.settled) && (
        <p className="px-4 pb-2 text-sm font-semibold text-danger">Don&apos;t close this page. Your phone is too full to keep these photos safe until they finish.</p>
      )}
      {expanded && (
        <ul className="max-h-56 divide-y divide-line overflow-y-auto border-t border-line px-4">
          {items.map((i) => (
            <li key={i.clientId} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{i.fileName}</span>
                <span className={i.state === 'failed' ? 'text-danger' : 'text-ink-soft'}>{stateText(i)}</span>
              </span>
              {!i.settled && i.state !== 'added' && (
                <span className="flex shrink-0">
                  {CAN_RETRY(i) && (
                    <Button variant="quiet" size="sm" aria-label={`Try ${i.fileName} again`} onClick={() => getQueue().retry(i.clientId)}>
                      Try again
                    </Button>
                  )}
                  <Button variant="quiet" size="sm" aria-label={`Remove ${i.fileName}`} onClick={() => void getQueue().remove(i.clientId)}>
                    Remove
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
