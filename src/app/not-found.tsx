import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="mx-auto grid max-w-md gap-4 px-4 py-20">
      <h1 className="text-3xl font-bold">We couldn&apos;t find that</h1>
      <p>If you scanned a QR code or followed a link to an event, ask the host for the latest one.</p>
      <p>
        <Link href="/" className="font-semibold text-plum underline">
          Go to the home page
        </Link>
      </p>
    </main>
  )
}
