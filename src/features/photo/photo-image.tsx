'use client'

import { useMemo, useState } from 'react'
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

const RETRY_MS = 1200

export function PhotoImage({ photo, size, onStale, className, fit = 'cover' }: Props) {
  const url = size === 'thumb' ? photo.thumbUrl : photo.displayUrl
  const [failure, setFailure] = useState({ id: photo.id, tries: 0 })
  const tries = failure.id === photo.id ? failure.tries : 0
  const background = useMemo(() => placeholder(photo.thumbhash), [photo.thumbhash])

  if (!url) {
    return <span className={cx('grid place-items-center bg-plum-wash p-2 text-center text-sm text-ink-soft', className)}>Getting it ready…</span>
  }
  if (tries >= 2) {
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
        setTimeout(() => setFailure({ id: photo.id, tries: tries + 1 }), tries === 0 ? RETRY_MS : 0)
      }}
    />
  )
}
