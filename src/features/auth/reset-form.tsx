'use client'

import Link from 'next/link'
import { useState } from 'react'
import { authClient } from '@/auth/client'
import { Button } from '@/features/ui/button'
import { Field, Input, Notice } from '@/features/ui/field'

export function ResetForm({ token, badLink }: { token?: string; badLink: boolean }) {
  const [value, setValue] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(badLink ? 'That link has expired. Ask for a new one.' : undefined)

  async function submit() {
    setBusy(true)
    setProblem(undefined)
    const { error } = token
      ? await authClient.resetPassword({ newPassword: value, token })
      : await authClient.requestPasswordReset({ email: value, redirectTo: '/reset' })
    setBusy(false)
    if (error) setProblem(error.message ?? 'Something went wrong. Please try again.')
    else setDone(true)
  }

  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-bold">{token ? 'Choose a new password' : 'Reset password'}</h1>
      {problem && <Notice tone="danger">{problem}</Notice>}
      {done ? (
        <Notice tone="ok">
          {token ? 'Your password is changed. You can sign in with it now.' : 'If that address has an account, a reset link is on its way.'}
        </Notice>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label={token ? 'New password' : 'Email'} hint={token ? 'At least 10 characters.' : undefined}>
            {(p) => (
              <Input
                {...p}
                required
                type={token ? 'password' : 'email'}
                minLength={token ? 10 : undefined}
                autoComplete={token ? 'new-password' : 'email'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" disabled={busy}>
            {token ? 'Change password' : 'Send reset link'}
          </Button>
        </form>
      )}
      <Link className="font-semibold text-plum underline" href="/sign-in">
        Back to sign in
      </Link>
    </div>
  )
}
