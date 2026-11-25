'use client'

import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/features/ui/button'
import { ConfirmDialog } from '@/features/ui/dialog'
import { Field, Input, Notice, Select, Textarea } from '@/features/ui/field'
import { Switch } from '@/features/ui/switch'
import { api } from '@/lib/api'
import type { HostEventDto } from '@/modules/events/events'
import type { EventPatch, SettingsPatch } from '@/modules/events/input'
import { eventPath, hk, useEventChange, useHostEvent } from './queries'
import { TimeZoneSelect } from './time-zone-select'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line pb-8">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </section>
  )
}

function Details({ event }: { event: HostEventDto }) {
  const save = useEventChange(event.id, (body: EventPatch) => api<HostEventDto>(eventPath(event.id), { method: 'PATCH', body }))
  const { name, eventDate, timeZone, welcome, accent } = event
  const form = useForm({
    defaultValues: { name, eventDate, timeZone, welcome, accent },
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value).catch(() => {})
    },
  })
  return (
    <Section title="Details">
      <form
        className="grid max-w-xl gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Field name="name">
          {(f) => (
            <Field label="Event name">
              {(p) => <Input {...p} required maxLength={80} value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />}
            </Field>
          )}
        </form.Field>
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
        <form.Field name="welcome">
          {(f) => (
            <Field label="Welcome message">
              {(p) => <Textarea {...p} maxLength={300} value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />}
            </Field>
          )}
        </form.Field>
        <form.Field name="accent">
          {(f) => (
            <Field label="Event color">
              {(p) => <Input {...p} type="color" className="w-24 p-1" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />}
            </Field>
          )}
        </form.Field>
        {save.error && <Notice tone="danger">{save.error.message}</Notice>}
        {save.isSuccess && <Notice tone="ok">Changes saved.</Notice>}
        <div>
          <Button type="submit" disabled={save.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Section>
  )
}

function Features({ event }: { event: HostEventDto }) {
  const save = useEventChange(event.id, (body: SettingsPatch) =>
    api<HostEventDto>(eventPath(event.id, '/settings'), { method: 'PATCH', body }),
  )
  const freeze = useEventChange(event.id, (frozen: boolean) =>
    api<HostEventDto>(eventPath(event.id, '/frozen'), { method: 'PUT', body: { frozen } }),
  )
  const s = event.settings
  const busy = save.isPending || freeze.isPending
  return (
    <Section title="What guests can do">
      {(save.error ?? freeze.error) && <Notice tone="danger">{(save.error ?? freeze.error)!.message}</Notice>}
      <div className="grid max-w-xl divide-y divide-line">
        <Switch
          label="Close uploads"
          hint="Guests can still look at photos, but can't add photos, hearts or comments."
          checked={event.frozen}
          disabled={busy}
          onChange={(on) => freeze.mutate(on)}
        />
        <Switch label="Hearts" checked={s.hearts} disabled={busy} onChange={(hearts) => save.mutate({ hearts })} />
        <Switch label="Comments" checked={s.comments} disabled={busy} onChange={(comments) => save.mutate({ comments })} />
        <Switch
          label="Downloads"
          hint="Guests can save single photos, without location data."
          checked={s.guestDownloads}
          disabled={busy}
          onChange={(guestDownloads) => save.mutate({ guestDownloads })}
        />
        <Switch
          label="Approve photos first"
          hint="New photos wait for you before anyone else sees them."
          checked={s.approval}
          disabled={busy}
          onChange={(approval) => save.mutate({ approval })}
        />
        <div className="py-3">
          <Field label="Gallery order">
            {(p) => (
              <Select
                {...p}
                value={s.defaultOrder}
                disabled={busy}
                onChange={(e) => save.mutate({ defaultOrder: e.target.value as typeof s.defaultOrder })}
              >
                <option value="newest">Newest first</option>
                <option value="taken">Time taken</option>
                <option value="featured">Featured first</option>
              </Select>
            )}
          </Field>
        </div>
      </div>
    </Section>
  )
}

function Access({ event }: { event: HostEventDto }) {
  const client = useQueryClient()
  const [pin, setPin] = useState('')
  const [asking, setAsking] = useState(false)
  const savePin = useMutation({
    mutationFn: (value: string | null) => api(eventPath(event.id, '/pin'), { method: 'PUT', body: { pin: value } }),
    onSuccess: () => {
      setPin('')
      return client.invalidateQueries({ queryKey: hk.event(event.id) })
    },
  })
  const replace = useEventChange(event.id, () => api<HostEventDto>(eventPath(event.id, '/code'), { method: 'POST' }))
  return (
    <Section title="Access">
      <form
        className="grid max-w-xl gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          savePin.mutate(pin)
        }}
      >
        <Field
          label={event.hasPin ? 'New PIN' : 'PIN'}
          hint={event.hasPin ? 'This event has a PIN. Changing it asks every guest for the new one.' : '4 digits. Without one, anyone with the link can look.'}
        >
          {(p) => (
            <Input
              {...p}
              required
              className="max-w-40"
              inputMode="numeric"
              pattern="[0-9]{4}"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          )}
        </Field>
        {savePin.error && <Notice tone="danger">{savePin.error.message}</Notice>}
        {savePin.isSuccess && <Notice tone="ok">{savePin.variables === null ? 'PIN removed.' : 'PIN saved.'}</Notice>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={savePin.isPending}>
            Save PIN
          </Button>
          {event.hasPin && (
            <Button variant="secondary" disabled={savePin.isPending} onClick={() => savePin.mutate(null)}>
              Remove PIN
            </Button>
          )}
        </div>
      </form>
      <div className="grid max-w-xl justify-items-start gap-2 pt-4">
        <p>
          Event link: <a className="font-semibold text-plum underline" href={event.url}>{event.url}</a>
        </p>
        <Button variant="danger" onClick={() => setAsking(true)}>
          Replace link
        </Button>
        {replace.isSuccess && <Notice tone="ok">The link is replaced. Share the new one with your guests.</Notice>}
        {replace.error && <Notice tone="danger">{replace.error.message}</Notice>}
      </div>
      <ConfirmDialog
        open={asking}
        title="Replace the event link?"
        confirm="Replace link"
        busy={replace.isPending}
        onClose={() => setAsking(false)}
        onConfirm={() => replace.mutate(undefined, { onSettled: () => setAsking(false) })}
      >
        <p>Printed QR codes will stop working, and guests will need the new link.</p>
      </ConfirmDialog>
    </Section>
  )
}

export function Settings({ id }: { id: string }) {
  const { data: event } = useHostEvent(id)
  if (!event) return <p role="status">Loading settings…</p>
  return (
    <div className="grid gap-8">
      <Details event={event} />
      <Features event={event} />
      <Access event={event} />
    </div>
  )
}
