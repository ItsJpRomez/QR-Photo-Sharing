'use client'

import { useState } from 'react'
import { Button, buttonClass } from '@/features/ui/button'
import { Field, Input } from '@/features/ui/field'
import { eventPath, useHostEvent } from './queries'

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1">
        <Field label={label}>{(p) => <Input {...p} readOnly value={value} onFocus={(e) => e.target.select()} />}</Field>
      </div>
      <Button
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => {})
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

export function Share({ id }: { id: string }) {
  const { data: event } = useHostEvent(id)
  if (!event) return <p role="status">Loading…</p>
  const qr = eventPath(id, '/qr')
  return (
    <div className="grid gap-10">
      <section className="grid gap-4">
        <h2 className="text-xl font-bold">Link and QR code</h2>
        <CopyField label="Event link" value={event.url} />
        <div className="flex flex-wrap items-center gap-6">
          <img key={event.code} src={`${qr}?format=svg&v=${event.code}`} alt={`QR code for ${event.name}`} className="size-48 border border-line bg-white" />
          <div className="grid gap-3">
            <a className={buttonClass()} href={`${qr}?format=png`} download>
              Download PNG
            </a>
            <a className={buttonClass({ variant: 'secondary' })} href={`${qr}?format=svg`} download>
              Download SVG
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
