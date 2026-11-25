import Link from 'next/link'

const LINKS = [
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/report', 'Report a photo'],
] as const

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <nav aria-label="About" className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 py-6">
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className="py-1 font-semibold text-plum underline">
            {label}
          </Link>
        ))}
      </nav>
    </footer>
  )
}
