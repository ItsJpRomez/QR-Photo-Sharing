import { textOn } from '@/lib/color'

type Props = { name: string; welcome: string; coverUrl: string | null; accent?: string }

/** The event introduces itself: its photo if there is one, its color if not. */
export function Hero({ name, welcome, coverUrl, accent = '#4a2370' }: Props) {
  return (
    <header style={{ background: accent, color: textOn(accent) }}>
      {coverUrl && <img src={coverUrl} alt="" className="h-[38svh] max-h-[26rem] w-full object-cover" />}
      <div className="mx-auto max-w-6xl px-4 pt-6 pb-7">
        <h1 className="text-[clamp(2.25rem,9vw,4.5rem)] font-extrabold">{name}</h1>
        {welcome && <p className="mt-3 max-w-prose text-lg whitespace-pre-line">{welcome}</p>}
      </div>
    </header>
  )
}
