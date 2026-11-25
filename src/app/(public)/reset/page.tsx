import type { Metadata } from 'next'
import { ResetForm } from '@/features/auth/reset-form'

export const metadata: Metadata = { title: 'Reset password' }

type Query = { token?: string | string[]; error?: string | string[] }

export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  const { token, error } = await searchParams
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <ResetForm token={typeof token === 'string' ? token : undefined} badLink={Boolean(error)} />
    </main>
  )
}
