'use client'

import { cx } from '@/features/ui/cx'
import type { TrendingTag } from '@/modules/events/tags'
import type { OpenEventDto } from '@/modules/events/view'
import { setAddress, useAddress } from './use-address'

type Props = { event: OpenEventDto; trending: TrendingTag[] }

export function viewList(event: OpenEventDto, trending: TrendingTag[]): { view: string; label: string }[] {
  return [
    { view: 'all', label: 'All photos' },
    ...event.albums.map((a) => ({ view: `album:${a.id}`, label: a.name })),
    ...trending.slice(0, 8).map((t) => ({ view: `tag:${t.norm}`, label: `#${t.display}` })),
    ...(event.features.hearts ? [{ view: 'hearted', label: 'Most hearted' }] : []),
    { view: 'featured', label: 'Featured' },
    { view: 'mine', label: 'My photos' },
  ]
}

export function Views({ event, trending }: Props) {
  const { view, order, href } = useAddress()
  return (
    <div className="sticky top-0 z-10 border-b border-line bg-sheet">
      <div className="mx-auto flex max-w-6xl items-center">
        <nav aria-label="Views" className="flex flex-1 gap-1 overflow-x-auto px-2 py-2">
          {viewList(event, trending).map((v) => {
            const current = v.view === view
            return (
              <a
                key={v.view}
                href={href({ view: v.view === 'all' ? null : v.view })}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return
                  e.preventDefault()
                  setAddress({ view: v.view === 'all' ? null : v.view })
                }}
                aria-current={current ? 'true' : undefined}
                className={cx(
                  'grid min-h-11 shrink-0 place-items-center rounded-full px-4 font-semibold whitespace-nowrap',
                  current ? 'bg-plum text-white' : 'text-ink hover:bg-plum-wash',
                )}
              >
                {v.label}
              </a>
            )
          })}
        </nav>
        {view !== 'hearted' && <OrderPicker order={order || event.defaultOrder} isDefault={(o) => o === event.defaultOrder} />}
      </div>
    </div>
  )
}

function OrderPicker({ order, isDefault }: { order: string; isDefault: (o: string) => boolean }) {
  return (
    <select
      aria-label="Order"
      value={order}
      onChange={(e) => setAddress({ order: isDefault(e.target.value) ? null : e.target.value })}
      className="mr-2 min-h-11 max-w-32 shrink-0 rounded-control border border-line-strong bg-sheet pl-3 pr-8 text-sm sm:max-w-none"
    >
      <option value="newest">Newest</option>
      <option value="taken">Time taken</option>
      <option value="featured">Featured first</option>
    </select>
  )
}
