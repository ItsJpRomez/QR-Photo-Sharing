'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { cx } from '@/features/ui/cx'
import { Notice } from '@/features/ui/field'
import type { HostEventDto } from '@/modules/events/events'
import { usageLevel } from '@/modules/events/usage'
import { formatBytes, formatDate } from './format'
import { useHostEvent } from './queries'

const TABS = [
  ['', 'Photos'],
  ['/waiting', 'Waiting'],
  ['/organize', 'Albums & tags'],
  ['/share', 'Share'],
  ['/export', 'Download'],
  ['/settings', 'Settings'],
] as const

export function EventShell({ initial, children }: { initial: HostEventDto; children: ReactNode }) {
  const path = usePathname()
  const { data: event = initial } = useHostEvent(initial.id, initial)
  const level = usageLevel(event)
  const base = `/host/events/${initial.id}`
  return (
    <div className="mx-auto grid max-w-4xl gap-6 px-4 py-8">
      <div>
        <h1 className="text-3xl font-bold">{event.name}</h1>
        <p className="text-ink-soft">
          {formatDate(event.eventDate)}, <a className="font-semibold text-plum underline" href={`/e/${event.code}`}>open the gallery</a>
        </p>
      </div>
      {level !== 'ok' && (
        <Notice tone={level === 'full' ? 'danger' : 'info'}>
          This event is {level === 'full' ? 'full' : 'almost full'}: {event.usedPhotos.toLocaleString('en')} of {event.maxPhotos.toLocaleString('en')} photos,{' '}
          {formatBytes(event.usedBytes)} of {formatBytes(event.maxBytes)}.
        </Notice>
      )}
      {event.frozen && <Notice>Uploads are closed. Guests can look but not add photos, hearts or comments.</Notice>}
      <nav aria-label="Event" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([rest, label]) => {
          const current = path === base + rest
          return (
            <Link
              key={rest}
              href={base + rest}
              aria-current={current ? 'page' : undefined}
              className={cx(
                '-mb-px shrink-0 border-b-4 px-3 py-2 font-semibold',
                current ? 'border-plum text-ink' : 'border-transparent text-ink-soft hover:text-ink',
              )}
            >
              {label}
            </Link>
          )
        })}
      </nav>
      <main>{children}</main>
    </div>
  )
}
