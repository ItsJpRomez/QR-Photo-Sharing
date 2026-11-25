import type { Metadata } from 'next'
import Link from 'next/link'
import { config } from '@/config'

export const metadata: Metadata = { title: 'Report a photo' }

export default function ReportPage() {
  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-4 py-12">
      <Link href="/" className="font-semibold text-plum underline">
        Home
      </Link>
      <h1 className="text-4xl font-bold">Report a photo</h1>
      <p>If you know the host, ask them first. They can remove a photo straight away.</p>
      <p>
        Otherwise, email{' '}
        <a className="font-semibold text-plum underline" href={`mailto:${config.reportEmail}`}>
          {config.reportEmail}
        </a>{' '}
        with the event link and a description of the photo. Please don&apos;t attach the photo itself.
      </p>
    </main>
  )
}
