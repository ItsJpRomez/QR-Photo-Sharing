import type { Metadata } from 'next'
import { PlaceholderPage } from '@/features/public/placeholder-page'

export const metadata: Metadata = { title: 'Privacy' }

const SECTIONS = [
  ['What we keep', 'Host accounts: name, email and a hashed password. Guests: an optional first name and a random browser ID. Photos, comments and hearts that people add.'],
  ['Who sees photos', 'People with the event link, and the PIN if there is one. The host can see and download the original files, which may include the location where a photo was taken. Other guests get copies without it.'],
  ['How long', 'Until the host deletes the event or account, plus 7 days to undo. Guests can delete their own photos at any time from the browser they used.'],
  ['Cookies', 'Two: one keeps hosts signed in, and one lets guests delete their own photos. Neither is used for advertising.'],
] as const

export default function PrivacyPage() {
  return <PlaceholderPage title="Privacy" sections={SECTIONS} />
}
