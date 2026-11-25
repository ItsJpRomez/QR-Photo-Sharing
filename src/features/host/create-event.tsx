'use client'

import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, ButtonLink } from '@/features/ui/button'
import { Field, Input, Notice, Textarea } from '@/features/ui/field'
import { api } from '@/lib/api'
import type { HostEventDto } from '@/modules/events/events'
import { hk } from './queries'
import { TimeZoneSelect } from './time-zone-select'

const lines = (s: string) =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean)

export function CreateEvent() {
  const router = useRouter()
  const client = useQueryClient()
  const [problem, setProblem] = useState<string>()
  const form = useForm({
    defaultValues: {
      name: '',
      eventDate: new Date().toISOString().slice(0, 10),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      welcome: '',
      accent: '#4a2370',
      albums: '',
      tags: '',
      pin: '',
    },
    onSubmit: async ({ value }) => {
      setProblem(undefined)
      try {
        const event = await api<HostEventDto>('/api/host/events', {
          method: 'POST',
          body: { ...value, albums: lines(value.albums), tags: lines(value.tags), pin: value.pin || null },
        })
        await client.invalidateQueries({ queryKey: hk.events })
        router.push(`/host/events/${event.id}`)
      } catch (err) {
        setProblem((err as Error).message)
      }
    },
  })
  return (
    <main className="mx-auto grid max-w-xl gap-6 px-4 py-10">
      <h1 className="text-3xl font-bold">Create event</h1>
      {problem && <Notice tone="danger">{problem}</Notice>}
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Field name="name">
          {(f) => (
            <Field label="Event name" hint="Guests see this first, for example Ana & Marco's wedding.">
              {(p) => <Input {...p} required maxLength={80} value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />}
            </Field>
          )}
        </form.Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <form.Field name="eventDate">
            {(f) => (
              <Field label="Date">
                {(p) => <Input {...p} required type="date" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />}
              </Field>
            )}
          </form.Field>
          <form.Field name="timeZone">
            {(f) => (
              <Field label="Time zone">
                {(p) => <TimeZoneSelect {...p} value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />}
              </Field>
            )}
          </form.Field>
        </div>
        <form.Field name="welcome">
          {(f) => (
            <Field label="Welcome message (optional)">
              {(p) => <Textarea {...p} maxLength={300} value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />}
            </Field>
          )}
        </form.Field>
        <form.Field name="albums">
          {(f) => (
            <Field label="Albums (optional)" hint="One per line, for example Ceremony, Speeches, Dance floor. You can change these later.">
              {(p) => <Textarea {...p} value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />}
            </Field>
          )}
        </form.Field>
        <form.Field name="tags">
          {(f) => (
            <Field label="Suggested hashtags (optional)" hint="One per line, for example #BrideSquad.">
              {(p) => <Textarea {...p} value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />}
            </Field>
          )}
        </form.Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <form.Field name="pin">
            {(f) => (
              <Field label="PIN (optional)" hint="4 digits. Guests type it once.">
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    autoComplete="off"
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="accent">
            {(f) => (
              <Field label="Event color" hint="Used on signs and the gallery.">
                {(p) => <Input {...p} type="color" className="p-1" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />}
              </Field>
            )}
          </form.Field>
        </div>
        <div className="flex gap-3">
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(busy) => (
              <Button type="submit" disabled={busy}>
                Create event
              </Button>
            )}
          </form.Subscribe>
          <ButtonLink variant="secondary" href="/host">
            Cancel
          </ButtonLink>
        </div>
      </form>
    </main>
  )
}
