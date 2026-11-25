'use client'

import { useForm } from '@tanstack/react-form'
import Link from 'next/link'
import { useState } from 'react'
import { authClient } from '@/auth/client'
import { Button } from '@/features/ui/button'
import { Field, Input, Notice } from '@/features/ui/field'

type Mode = 'sign-in' | 'sign-up'

export function AuthForm({ mode, next, google }: { mode: Mode; next: string; google: boolean }) {
  const [problem, setProblem] = useState<string>()
  const form = useForm({
    defaultValues: { name: '', email: '', password: '' },
    onSubmit: async ({ value }) => {
      setProblem(undefined)
      const { error } =
        mode === 'sign-up'
          ? await authClient.signUp.email({ ...value, callbackURL: next })
          : await authClient.signIn.email({ email: value.email, password: value.password })
      if (error) setProblem(error.message ?? 'Something went wrong. Please try again.')
      else window.location.assign(next)
    },
  })
  const other = mode === 'sign-up' ? 'sign-in' : 'sign-up'

  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-bold">{mode === 'sign-up' ? 'Create a host account' : 'Sign in'}</h1>
      {problem && <Notice tone="danger">{problem}</Notice>}
      {google && (
        <Button
          variant="secondary"
          onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: next })}
        >
          Continue with Google
        </Button>
      )}
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        {mode === 'sign-up' && (
          <form.Field name="name">
            {(f) => (
              <Field label="Your name">
                {(p) => (
                  <Input {...p} required maxLength={80} autoComplete="name" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />
                )}
              </Field>
            )}
          </form.Field>
        )}
        <form.Field name="email">
          {(f) => (
            <Field label="Email">
              {(p) => (
                <Input {...p} required type="email" autoComplete="email" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />
              )}
            </Field>
          )}
        </form.Field>
        <form.Field name="password">
          {(f) => (
            <Field label="Password" hint={mode === 'sign-up' ? 'At least 10 characters.' : undefined}>
              {(p) => (
                <Input
                  {...p}
                  required
                  type="password"
                  minLength={mode === 'sign-up' ? 10 : undefined}
                  autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                />
              )}
            </Field>
          )}
        </form.Field>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(busy) => (
            <Button type="submit" disabled={busy}>
              {mode === 'sign-up' ? 'Create account' : 'Sign in'}
            </Button>
          )}
        </form.Subscribe>
      </form>
      <p className="flex flex-wrap gap-x-5 gap-y-2">
        <Link className="font-semibold text-plum underline" href={`/${other}?next=${encodeURIComponent(next)}`}>
          {mode === 'sign-up' ? 'I already have an account' : 'Create a host account'}
        </Link>
        {mode === 'sign-in' && (
          <Link className="font-semibold text-plum underline" href="/reset">
            Reset password
          </Link>
        )}
      </p>
    </div>
  )
}
