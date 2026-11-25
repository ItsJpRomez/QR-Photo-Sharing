'use client'

import { useEffect, useMemo, useState } from 'react'
import { thumbHashToDataURL } from 'thumbhash'
import { cx } from '@/features/ui/cx'
import type { PhotoDto } from '@/modules/photos/query'

type Props = {
  photo: PhotoDto
  size: 'thumb' | 'display'
  /** Asks for new image links. They expire after a couple of hours. */
  onStale: (id: string) => void
  className?: string
  fit?: 'cover' | 'contain'
}

function placeholder(hash: string | null): string | undefined {
  if (!hash) return undefined
  try {
    return `url(${thumbHashToDataURL(Uint8Array.from(atob(hash), (c) => c.charCodeAt(0)))})`
  } catch {
    return undefined
  }
}

const GIVE_UP = 2
const RETRY_MS = 1200
/** After giving up for now. The phone doesn't always notice the signal coming back. */
const LATER_MS = 15_000

export function PhotoImage({ photo, size, onStale, className, fit = 'cover' }: Props) {
  const url = size === 'thumb' ? photo.thumbUrl : photo.displayUrl
  // Counted for this very link, so a new one starts afresh.
  const [failure, setFailure] = useState({ url, tries: 0 })
  const tries = failure.url === url ? failure.tries : 0
  const gaveUp = tries >= GIVE_UP
  const background = useMemo(() => placeholder(photo.thumbhash), [photo.thumbhash])

  useEffect(() => {
    if (!gaveUp) return
    const again = () => {
      onStale(photo.id)
      setFailure({ url, tries: 1 })
    }
    const timer = setTimeout(again, LATER_MS)
    window.addEventListener('online', again)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', again)
    }
  }, [gaveUp, onStale, photo.id, url])

  if (!url) {
    return <span className={cx('grid place-items-center bg-plum-wash p-2 text-center text-sm text-ink-soft', className)}>Getting it ready…</span>
  }
  if (gaveUp) {
    return <span className={cx('grid place-items-center bg-plum-wash p-2 text-center text-sm text-ink-soft', className)}>Couldn&apos;t load</span>
  }
  return (
    <img
      key={`${url}#${tries}`}
      src={url}
      alt=""
      draggable={false}
      decoding="async"
      style={{ backgroundImage: background, backgroundSize: fit === 'cover' ? 'cover' : undefined }}
      className={cx(fit === 'cover' ? 'object-cover' : 'object-contain', className)}
      onError={() => {
        if (tries === 0) onStale(photo.id)
        // Give the new link a moment to arrive, then try once more.
        setTimeout(() => setFailure({ url, tries: tries + 1 }), tries === 0 ? RETRY_MS : 0)
      }}
    />
  )
}
