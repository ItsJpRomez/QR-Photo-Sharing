'use client'

import { Button } from '@/features/ui/button'

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto grid max-w-md justify-items-start gap-4 px-4 py-20">
      <h1 className="text-3xl font-bold">This page didn&apos;t load</h1>
      <p>Check your connection, then try again. Photos waiting to upload are safe on this phone.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  )
}
