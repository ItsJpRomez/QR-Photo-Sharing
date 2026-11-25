'use client'

import { plural } from '@/features/host/format'
import { useQueueItems } from '@/features/upload-queue/use-queue'

/** The event moved to a new link, or was deleted, while this page was open. */
export function LinkChanged() {
  const waiting = useQueueItems().filter((i) => !i.settled && i.state !== 'failed').length
  return (
    <main className="mx-auto grid max-w-md gap-4 px-4 py-16">
      <h1 className="text-3xl font-bold">This link doesn&apos;t work any more</h1>
      <p>Ask the host for the new one, or scan the QR code again.</p>
      {waiting > 0 && (
        <p>
          <strong>{plural(waiting, 'photo')}</strong> {waiting === 1 ? 'is' : 'are'} safe on this phone. Open the new link in this browser and
          we&apos;ll finish uploading.
        </p>
      )}
    </main>
  )
}
