'use client'

import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, ButtonLink } from '@/features/ui/button'
import { Notice } from '@/features/ui/field'
import type { HostEventDto } from '@/modules/events/events'
import { formatDate, plural } from './format'
import { api } from '@/lib/api'
import { eventPath, hk, useHostEvents } from './queries'

function EventCard({ event }: { event: HostEventDto }) {
  return (
    <li>
      <Link href={`/host/events/${event.id}`} className="group grid grid-cols-[7rem_1fr] gap-4 sm:grid-cols-[11rem_1fr]">
        {/* The event's own color stands in until there is a cover photo. */}
        <span className="block aspect-[4/3] overflow-hidden" style={{ background: event.accent }}>
          {event.coverUrl && <img src={event.coverUrl} alt="" className="size-full object-cover" />}
        </span>
        <span className="grid content-center gap-1">
          <span className="font-display text-xl font-bold group-hover:underline">{event.name}</span>
          <span className="text-ink-soft">{formatDate(event.eventDate)}</span>
          <span className="text-ink-soft">
            {plural(event.usedPhotos, 'photo')}
            {event.frozen && ', uploads closed'}
          </span>
        </span>
      </Link>
    </li>
  )
}

const DAY_MS = 86_400_000

function DeletedEvent({ event }: { event: HostEventDto }) {
  const client = useQueryClient()
  const undo = useMutation({
    mutationFn: () => api(eventPath(event.id, '/restore'), { method: 'POST' }),
    onSettled: () => client.invalidateQueries({ queryKey: hk.events }),
  })
  const until = new Date(new Date(event.deletedAt!).getTime() + 7 * DAY_MS)
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span>
        <span className="font-semibold">{event.name}</span>{' '}
        <span className="text-ink-soft">deleted for good on {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(until)}</span>
        {undo.error && <span className="block text-danger">{undo.error.message}</span>}
      </span>
      <Button variant="secondary" size="sm" disabled={undo.isPending} onClick={() => undo.mutate()}>
        Undo delete
      </Button>
    </li>
  )
}

export function Dashboard() {
  const { data, error, isPending } = useHostEvents()
  const active = data?.filter((e) => !e.deletedAt) ?? []
  const deleted = data?.filter((e) => e.deletedAt) ?? []
  return (
    <main className="mx-auto grid max-w-4xl gap-8 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Your events</h1>
        <ButtonLink href="/host/new">Create event</ButtonLink>
      </div>
      {error && <Notice tone="danger">{error.message}</Notice>}
      {isPending && <p role="status">Loading your events…</p>}
      {data && active.length === 0 && (
        <div className="grid justify-items-start gap-2 bg-sheet p-8">
          <h2 className="text-xl font-bold">No events yet</h2>
          <p className="text-ink-soft">Create one to get its QR code and start collecting photos.</p>
        </div>
      )}
      <ul className="grid gap-6">
        {active.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </ul>
      {deleted.length > 0 && (
        <section className="grid gap-2 border-t border-line pt-6">
          <h2 className="text-xl font-bold">Recently deleted</h2>
          <ul className="divide-y divide-line">
            {deleted.map((e) => (
              <DeletedEvent key={e.id} event={e} />
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
