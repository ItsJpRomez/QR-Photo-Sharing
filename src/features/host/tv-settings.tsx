'use client'

import { useState } from 'react'
import { Button, buttonClass } from '@/features/ui/button'
import { ConfirmDialog } from '@/features/ui/dialog'
import { Field, Input, Notice, Select } from '@/features/ui/field'
import { Switch } from '@/features/ui/switch'
import { api } from '@/lib/api'
import type { HostEventDto } from '@/modules/events/events'
import type { SettingsPatch } from '@/modules/events/input'
import { eventPath, useAlbums, useEventChange } from './queries'

export function TvSettings({ event }: { event: HostEventDto }) {
  const { data: albums = [] } = useAlbums(event.id)
  const { tv } = event.settings
  const [pin, setPin] = useState('')
  const [asking, setAsking] = useState(false)
  const save = useEventChange(event.id, (change: NonNullable<SettingsPatch['tv']>) =>
    api<HostEventDto>(eventPath(event.id, '/settings'), { method: 'PATCH', body: { tv: change } }),
  )
  const savePin = useEventChange(event.id, (body: { show: boolean; pin?: string }) =>
    api<HostEventDto>(eventPath(event.id, '/tv-pin'), { method: 'PUT', body }),
  )
  const replace = useEventChange(event.id, () => api<HostEventDto>(eventPath(event.id, '/tv-token'), { method: 'POST' }))
  const problem = save.error ?? savePin.error ?? replace.error
  const busy = save.isPending || savePin.isPending
  return (
    <section className="grid max-w-xl gap-4">
      <h2 className="text-xl font-bold">TV or projector</h2>
      <p className="text-ink-soft">Open this on the venue screen. It needs no sign-in, so share it only with whoever runs the screen.</p>
      {problem && <Notice tone="danger">{problem.message}</Notice>}
      <div className="flex flex-wrap gap-3">
        <a className={buttonClass()} href={event.tvUrl} target="_blank" rel="noreferrer">
          Open TV mode
        </a>
        <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(event.tvUrl).catch(() => {})}>
          Copy TV link
        </Button>
        <Button variant="danger" onClick={() => setAsking(true)}>
          Replace TV link
        </Button>
      </div>
      <Field label="Seconds per photo">
        {(p) => (
          <Select {...p} value={tv.seconds} disabled={busy} onChange={(e) => save.mutate({ seconds: Number(e.target.value) })}>
            {[...new Set([3, 5, 7, 10, 15, 20, 30, 60, tv.seconds])]
              .sort((a, b) => a - b)
              .map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
          </Select>
        )}
      </Field>
      <Field label="Photos to show">
        {(p) => (
          <Select {...p} value={tv.albumId ?? ''} disabled={busy} onChange={(e) => save.mutate({ albumId: e.target.value || null })}>
            <option value="">All photos</option>
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="divide-y divide-line">
        <Switch label="Show names" checked={tv.showNames} disabled={busy} onChange={(showNames) => save.mutate({ showNames })} />
        <Switch label="Show QR code" checked={tv.showQr} disabled={busy} onChange={(showQr) => save.mutate({ showQr })} />
      </div>
      {event.hasPin &&
        (tv.showPin ? (
          <div className="grid justify-items-start gap-2">
            <p>The PIN shows on the TV.</p>
            <Button variant="secondary" disabled={busy} onClick={() => savePin.mutate({ show: false })}>
              Hide PIN on the TV
            </Button>
          </div>
        ) : (
          <form
            className="grid justify-items-start gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              savePin.mutate({ show: true, pin }, { onSuccess: () => setPin('') })
            }}
          >
            <Field label="Event PIN" hint="To show it on the TV, we keep an encrypted copy until you hide it or change the PIN.">
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
            <Button type="submit" variant="secondary" disabled={busy}>
              Show PIN on the TV
            </Button>
          </form>
        ))}
      <ConfirmDialog
        open={asking}
        title="Replace the TV link?"
        confirm="Replace TV link"
        busy={replace.isPending}
        onClose={() => setAsking(false)}
        onConfirm={() => replace.mutate(undefined, { onSettled: () => setAsking(false) })}
      >
        <p>Screens using the old one will stop showing photos.</p>
      </ConfirmDialog>
    </section>
  )
}
