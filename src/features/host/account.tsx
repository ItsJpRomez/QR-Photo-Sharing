'use client'

import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/features/ui/button'
import { ConfirmDialog } from '@/features/ui/dialog'
import { Field, Input, Notice } from '@/features/ui/field'
import { api } from '@/lib/api'

export function Account({ email, name, hasPassword }: { email: string; name: string; hasPassword: boolean }) {
  const [asking, setAsking] = useState(false)
  const [password, setPassword] = useState('')
  const remove = useMutation({
    mutationFn: () => api('/api/host/account/delete', { method: 'POST', body: hasPassword ? { password } : {} }),
    onSuccess: () => window.location.replace('/'),
  })
  return (
    <main className="mx-auto grid max-w-xl gap-8 px-4 py-10">
      <div>
        <h1 className="text-3xl font-bold">Account</h1>
        <p>{name}</p>
        <p className="text-ink-soft">{email}</p>
      </div>
      <section className="grid justify-items-start gap-4">
        <h2 className="text-xl font-bold">Delete account</h2>
        <p>All your events close straight away, and their photos are deleted for good after 7 days. Download them first if you want to keep them.</p>
        <Button variant="danger" onClick={() => setAsking(true)}>
          Delete account
        </Button>
      </section>
      <ConfirmDialog
        open={asking}
        title="Delete your account?"
        confirm="Delete account"
        busy={remove.isPending}
        onClose={() => {
          setAsking(false)
          setPassword('')
          remove.reset()
        }}
        onConfirm={() => remove.mutate()}
      >
        <p>This can&apos;t be undone.</p>
        {hasPassword && (
          <Field label="Password">
            {(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
        )}
        {remove.error && <Notice tone="danger">{remove.error.message}</Notice>}
      </ConfirmDialog>
    </main>
  )
}
