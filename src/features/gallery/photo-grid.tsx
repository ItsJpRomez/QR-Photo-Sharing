'use client'

import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PhotoImage } from '@/features/photo/photo-image'
import type { PhotoDto } from '@/modules/photos/query'

type Props = {
  photos: PhotoDto[]
  hasMore: boolean
  loadMore: () => void
  onOpen: (id: string) => void
  onStale: (id: string) => void
  /** Given while choosing several photos. */
  selected?: ReadonlySet<string>
  /** Just came in. */
  arrived?: ReadonlySet<string>
}

const GAP = 3
const columnsFor = (width: number) => (width < 560 ? 3 : width < 900 ? 4 : width < 1200 ? 5 : 6)

const BADGE: Partial<Record<PhotoDto['status'], string>> = {
  pending: 'Waiting for host',
  hidden: 'Hidden',
  failed: 'Failed',
}

export function tileLabel(p: PhotoDto): string {
  const badge = BADGE[p.status]
  return `Photo by ${p.uploader}${badge ? `, ${badge.toLowerCase()}` : ''}`
}

export function PhotoGrid({ photos, hasMore, loadMore, onOpen, onStale, arrived, selected }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, top: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      const next = { width: r.width, top: Math.round(r.top + window.scrollY) }
      setBox((b) => (b.width === next.width && b.top === next.top ? b : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observer.observe(document.body) // a cover image above may still be loading
    return () => observer.disconnect()
  }, [])

  const columns = columnsFor(box.width)
  const side = Math.max(1, (box.width - GAP * (columns - 1)) / columns)
  const rows = Math.ceil(photos.length / columns)
  const virtual = useWindowVirtualizer({
    count: rows,
    estimateSize: () => side + GAP,
    overscan: 3,
    scrollMargin: box.top,
    enabled: box.width > 0,
  })
  useEffect(() => virtual.measure(), [side, virtual])

  const items = virtual.getVirtualItems()
  const lastRow = items.at(-1)?.index ?? 0
  useEffect(() => {
    if (hasMore && lastRow >= rows - 4) loadMore()
  }, [hasMore, lastRow, rows, loadMore])

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-6xl" style={{ height: virtual.getTotalSize() }}>
      {items.map((row) => (
        <div
          key={row.key}
          className="absolute inset-x-0 grid"
          style={{
            top: row.start - box.top,
            height: side,
            gap: GAP,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}
        >
          {photos.slice(row.index * columns, (row.index + 1) * columns).map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid="tile"
              data-photo={p.id}
              aria-label={tileLabel(p)}
              aria-pressed={selected?.has(p.id)}
              onClick={() => onOpen(p.id)}
              className="relative block overflow-hidden bg-line focus-visible:z-10"
            >
              <PhotoImage photo={p} size="thumb" onStale={onStale} className="absolute inset-0 size-full" />
              {arrived?.has(p.id) && <span aria-hidden className="camera-flash absolute inset-0" />}
              {selected?.has(p.id) && (
                <span aria-hidden className="absolute inset-0 grid place-items-start border-4 border-flash bg-plum/40 p-1">
                  <span className="grid size-6 place-items-center rounded-full bg-flash font-bold text-ink">✓</span>
                </span>
              )}
              {BADGE[p.status] && (
                <span className="absolute inset-x-0 bottom-0 bg-ink/85 px-1 py-0.5 text-xs font-semibold text-white">{BADGE[p.status]}</span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
