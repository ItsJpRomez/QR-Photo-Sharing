import Link from 'next/link'
import { Notice } from '@/features/ui/field'

type Props = { title: string; sections: readonly (readonly [string, string])[] }

export function PlaceholderPage({ title, sections }: Props) {
  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-4 py-12">
      <Link href="/" className="font-semibold text-plum underline">
        Home
      </Link>
      <h1 className="text-4xl font-bold">{title}</h1>
      <Notice>Placeholder: have this reviewed before launch</Notice>
      {sections.map(([heading, text]) => (
        <section key={heading} className="grid gap-2">
          <h2 className="text-xl font-bold">{heading}</h2>
          <p>{text}</p>
        </section>
      ))}
    </main>
  )
}
