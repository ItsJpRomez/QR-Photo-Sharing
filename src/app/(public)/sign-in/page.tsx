import type { Metadata } from 'next'
import { safeNext } from '@/auth/server'
import { config } from '@/config'
import { AuthForm } from '@/features/auth/auth-form'

export const metadata: Metadata = { title: 'Sign in' }

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <AuthForm mode="sign-in" next={safeNext(typeof next === 'string' ? next : undefined)} google={Boolean(config.google)} />
    </main>
  )
}
