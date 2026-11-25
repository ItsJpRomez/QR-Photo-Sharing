'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Field, Input, Notice } from '@/features/ui/field'
import { Button } from '@/features/ui/button'
import { api } from '@/lib/api'
import type { LockedEventDto } from '@/modules/events/view'
import { Hero } from './hero'
import { qk } from './cache'
import { eventApi } from './queries'

export function PinScreen({ code, event }: { code: string; event: LockedEventDto }) {
  const client = useQueryClient()
  const [pin, setPin] = useState('')
  const open = useMutation({
    mutationFn: () => api(eventApi(code, '/pin'), { method: 'POST', body: { pin } }),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.event(code) }),
    onError: () => setPin(''),
  })
  return (
    <main>
      <Hero name={event.name} welcome={event.welcome} coverUrl={event.coverUrl} />
      <form
        className="mx-auto grid max-w-sm gap-4 px-4 py-8"
        onSubmit={(e) => {
          e.preventDefault()
          open.mutate()
        }}
      >
        <Field label="PIN" hint="Ask the host, or look on the sign with the QR code.">
          {(p) => (
            <Input
              {...p}
              required
              className="text-center font-display text-3xl tracking-[0.4em]"
              inputMode="numeric"
              pattern="[0-9]{4}"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          )}
        </Field>
        {open.error && <Notice tone="danger">{open.error.message}</Notice>}
        <Button type="submit" disabled={open.isPending}>
          Open gallery
        </Button>
      </form>
    </main>
  )
}
