import type { Metadata, Viewport } from 'next'
import { config } from '@/config'
import './globals.css'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return { title: { default: config.appName, template: `%s · ${config.appName}` } }
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
