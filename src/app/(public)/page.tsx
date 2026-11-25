import { config } from '@/config'
import { Scenes } from '@/features/public/scenes'
import { ButtonLink } from '@/features/ui/button'
import { signSvg } from '@/modules/signs/templates'

const STEPS = [
  ['Put out the code', 'Print it on table cards or show it on the venue screen. You also get a link for guests who are far away.'],
  ['Guests scan and add', 'Their phone opens the gallery. They pick photos and upload, with no app and no account.'],
  ['Watch it fill, then keep it all', 'Photos appear as they come in. Afterwards, download every original in one file.'],
] as const

const DETAILS = [
  ['Original quality', 'Photos are kept exactly as they were taken, so they print well.'],
  ['Made for bad signal', 'Uploads wait on the phone and carry on when the connection comes back.'],
  ['You stay in charge', 'Use a PIN, approve photos first, hide what you like, and close uploads when the night is over.'],
  ['Location stays private', 'Other guests only get copies without location data.'],
] as const

export default function HomePage() {
  const card = signSvg({
    size: 'a6',
    style: 'classic',
    headline: 'Share your photos',
    subtext: 'Scan with your phone. No app needed.',
    accent: '#4a2370',
    url: config.appUrl,
  })
  return (
    <main>
      <div className="bg-plum text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <p className="font-display text-xl font-bold">{config.appName}</p>
          <a href="/sign-in" className="rounded-control px-3 py-2 font-semibold underline focus-visible:outline-flash">
            Sign in
          </a>
        </div>
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-8 pb-16 md:grid-cols-[1.1fr_1fr]">
          <div className="grid justify-items-start gap-6">
            <h1 className="text-[clamp(2.75rem,8vw,5.25rem)] font-extrabold">Every photo your guests took</h1>
            <p className="max-w-prose text-xl">
              Put one QR code on the tables. Guests scan it and add their photos, and everyone sees the event come together live.
            </p>
            <ButtonLink href="/sign-up" className="!bg-flash !text-ink focus-visible:outline-white">
              Create an event
            </ButtonLink>
          </div>
          <div className="relative">
            <Scenes />
            <img
              src={`data:image/svg+xml;base64,${Buffer.from(card).toString('base64')}`}
              alt="A table card with a QR code"
              className="absolute -bottom-10 left-1/2 w-[42%] -translate-x-1/2 -rotate-3 shadow-[0_10px_30px_rgb(0_0_0/0.4)]"
            />
          </div>
        </div>
      </div>
      <section className="mx-auto max-w-6xl px-4 pt-24 pb-16">
        <h2 className="text-3xl font-bold">How it goes</h2>
        <ol className="mt-8 grid gap-8 md:grid-cols-3">
          {STEPS.map(([title, text]) => (
            <li key={title} className="border-t-4 border-flash pt-4">
              <h3 className="text-xl font-bold">{title}</h3>
              <p className="mt-2 text-ink-soft">{text}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="bg-sheet">
        <div className="mx-auto grid max-w-6xl gap-x-12 gap-y-8 px-4 py-16 md:grid-cols-[1fr_2fr]">
          <h2 className="text-3xl font-bold">What you can count on</h2>
          <dl className="grid gap-8 sm:grid-cols-2">
            {DETAILS.map(([title, text]) => (
              <div key={title}>
                <dt className="text-lg font-bold">{title}</dt>
                <dd className="mt-1 text-ink-soft">{text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl justify-items-start gap-5 px-4 py-16">
        <h2 className="text-3xl font-bold">Ready before the first toast</h2>
        <ButtonLink href="/sign-up">Create an event</ButtonLink>
      </section>
    </main>
  )
}
