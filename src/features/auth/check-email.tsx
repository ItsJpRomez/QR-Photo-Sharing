'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { authClient } from '@/auth/client'
import { Button } from '@/features/ui/button'

export function CheckEmail({ email }: { email: string }) {
  const router = useRouter()
  const [sent, setSent] = useState(false)
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-16">
      <h1 className="text-3xl font-bold">Check your email</h1>
      <p>
        We sent a link to <strong>{email}</strong>. Open it to confirm your address, then you can create events.
      </p>
      <Button
        variant="secondary"
        disabled={sent}
        onClick={async () => {
          await authClient.sendVerificationEmail({ email, callbackURL: '/host' })
          setSent(true)
        }}
      >
        {sent ? 'Link sent' : 'Send the link again'}
      </Button>
      <Button
        variant="quiet"
        onClick={async () => {
          await authClient.signOut()
          router.push('/sign-in')
          router.refresh()
        }}
      >
        Sign out
      </Button>
    </div>
  )
}
