'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { cx } from '@/features/ui/cx'
import { Notice } from '@/features/ui/field'
import { api } from '@/lib/api'
import type { HostEventDto } from '@/modules/events/events'
import { usageLevel } from '@/modules/events/usage'
import { formatBytes, formatDate, plural } from './format'
import { eventPath, hk, useHostEvent } from './queries'

const TABS = [
  ['', 'Photos'],
  ['/waiting', 'Waiting'],
  ['/organize', 'Albums & tags'],
  ['/share', 'Share'],
  ['/export', 'Download'],
  ['/settings', 'Settings'],
] as const

/** On a phone the tabs scroll sideways, so the open one is brought into sight. */
function intoView(tab: HTMLAnchorElement | null) {
  const bar = tab?.parentElement
  if (tab && bar) bar.scrollLeft = tab.offsetLeft - (bar.clientWidth - tab.clientWidth) / 2
}

/** Room held by uploads that never arrived, which the host can take back. */
function Unfinished({ id }: { id: string }) {
  const client = useQueryClient()
  const key = [...hk.event(id), 'unfinished']
  const { data } = useQuery({ queryKey: key, queryFn: () => api<{ photos: number; bytes: number }>(eventPath(id, '/unfinished')) })
  const clear = useMutation({
    mutationFn: () => api(eventPath(id, '/unfinished'), { method: 'DELETE' }),
    onSettled: () => client.invalidateQueries({ queryKey: hk.event(id) }),
  })
  if (!data?.photos) return null
  return (
    <span className="mt-2 block">
      {plural(data.photos, 'unfinished upload')} {data.photos === 1 ? 'is' : 'are'} holding {formatBytes(data.bytes)}.{' '}
      <button type="button" className="font-semibold underline" disabled={clear.isPending} onClick={() => clear.mutate()}>
        Clear unfinished uploads
      </button>
    </span>
  )
}

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
          {formatBytes(event.usedBytes)} of {formatBytes(event.maxBytes)}. <Unfinished id={event.id} />
        </Notice>
      )}
      {event.frozen && <Notice>Uploads are closed. Guests can look but not add photos, hearts or comments.</Notice>}
      <nav aria-label="Event" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([rest, label]) => {
          const current = path === base + rest
          return (
            <Link
              key={rest}
              ref={current ? intoView : undefined}
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
