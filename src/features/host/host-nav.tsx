'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authClient } from '@/auth/client'
import { Button, buttonClass } from '@/features/ui/button'

export function HostNav({ appName }: { appName: string }) {
  const router = useRouter()
  return (
    <header className="border-b border-line bg-sheet">
      <nav aria-label="Account" className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-2">
        <Link href="/host" className="font-display text-lg font-bold">
          {appName}
        </Link>
        <span className="flex items-center">
        <Link href="/host/account" className={buttonClass({ variant: 'quiet', size: 'sm' })}>
          Account
        </Link>
        <Button
          variant="quiet"
          size="sm"
          onClick={async () => {
            await authClient.signOut()
            router.push('/')
            router.refresh()
          }}
        >
          Sign out
        </Button>
        </span>
      </nav>
    </header>
  )
}
