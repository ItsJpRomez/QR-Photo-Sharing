import type { Metadata } from 'next'
import { PlaceholderPage } from '@/features/public/placeholder-page'

export const metadata: Metadata = { title: 'Terms' }

const SECTIONS = [
  ['Your photos', 'You keep the rights to what you add. You let the host and their guests see and download it as part of the event.'],
  ['What not to add', "Anything illegal, anything that isn't yours to share, or photos of people who asked you not to."],
  ['Hosts', 'Hosts are responsible for their event, including removing photos people object to.'],
  ['Ending', 'We may remove photos or close events that break these terms.'],
] as const

export default function TermsPage() {
  return <PlaceholderPage title="Terms" sections={SECTIONS} />
}
