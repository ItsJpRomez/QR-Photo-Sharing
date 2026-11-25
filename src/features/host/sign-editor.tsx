'use client'

import { useQuery } from '@tanstack/react-query'
import { useDeferredValue, useEffect, useState } from 'react'
import { Button } from '@/features/ui/button'
import { Field, Input, Notice, Select } from '@/features/ui/field'
import type { HostEventDto } from '@/modules/events/events'
import type { SignSize, SignStyle } from '@/modules/signs/templates'
import { eventPath } from './queries'

type Format = 'preview' | 'png' | 'pdf'

const SIZES: [SignSize, string][] = [
  ['a6', 'Table card, A6'],
  ['4x6', 'Table card, 4 × 6 in'],
  ['a4', 'Welcome sign, A4'],
  ['letter', 'Welcome sign, Letter'],
  ['screen', 'Screen, 1920 × 1080'],
]
const STYLES: [SignStyle, string][] = [
  ['classic', 'Classic'],
  ['modern', 'Modern'],
  ['bold', 'Bold'],
]

/** A value that follows typing at a calm pace. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

function fileName(res: Response, fallback: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1]
  return encoded ? decodeURIComponent(encoded) : fallback
}

export function SignEditor({ event }: { event: HostEventDto }) {
  const [size, setSize] = useState<SignSize>('a6')
  const [style, setStyle] = useState<SignStyle>('classic')
  const [headline, setHeadline] = useState(event.name.length <= 60 ? event.name : 'Share your photos')
  const [subtext, setSubtext] = useState('Scan to see and add photos. No app needed.')
  const [pin, setPin] = useState('')
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)

  const text = useSettled(JSON.stringify({ headline, subtext }), 300)
  const options = { size, style, ...(JSON.parse(text) as { headline: string; subtext: string }), pin: pin.length === 4 ? pin : undefined }

  async function make(format: Format, o: object) {
    const res = await fetch(eventPath(event.id, '/sign'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...o, format }),
    })
    if (!res.ok) throw new Error(((await res.json()) as { error: { message: string } }).error.message)
    return { blob: await res.blob(), name: fileName(res, `sign.${format}`), missing: decodeURIComponent(res.headers.get('x-missing-characters') ?? '') }
  }

  const preview = useQuery({
    queryKey: ['host', 'event', event.id, 'sign', event.code, event.accent, options],
    queryFn: async () => {
      const made = await make('preview', options)
      return { url: URL.createObjectURL(made.blob), missing: made.missing }
    },
    placeholderData: (before) => before,
    retry: false,
    gcTime: 60_000,
  })
  const shown = useDeferredValue(preview.data)

  async function download(format: 'png' | 'pdf') {
    setBusy(true)
    setProblem(undefined)
    try {
      const { blob, name } = await make(format, { ...options, headline, subtext })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="grid gap-4">
      <h2 className="text-xl font-bold">Signs to print or show</h2>
      <div className="grid gap-8 sm:grid-cols-2">
        <div className="grid content-start gap-4">
          <Field label="Size">
            {(p) => (
              <Select {...p} value={size} onChange={(e) => setSize(e.target.value as SignSize)}>
                {SIZES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Style">
            {(p) => (
              <Select {...p} value={style} onChange={(e) => setStyle(e.target.value as SignStyle)}>
                {STYLES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Headline">{(p) => <Input {...p} maxLength={60} value={headline} onChange={(e) => setHeadline(e.target.value)} />}</Field>
          <Field label="Text below">{(p) => <Input {...p} maxLength={120} value={subtext} onChange={(e) => setSubtext(e.target.value)} />}</Field>
          {event.hasPin && (
            <Field label="PIN on the sign" hint="Type the PIN to print it. Leave empty to keep it off.">
              {(p) => (
                <Input
                  {...p}
                  className="max-w-40"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              )}
            </Field>
          )}
          {shown?.missing && <Notice>Signs can&apos;t print: {shown.missing}</Notice>}
          {(preview.error ?? problem) && <Notice tone="danger">{preview.error?.message ?? problem}</Notice>}
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy || preview.isError} onClick={() => download('pdf')}>
              Download PDF
            </Button>
            <Button variant="secondary" disabled={busy || preview.isError} onClick={() => download('png')}>
              Download image
            </Button>
          </div>
        </div>
        <div className="grid place-items-center bg-line p-6">
          {shown ? <img src={shown.url} alt="Sign preview" className="max-h-[32rem] shadow-[0_6px_18px_rgb(43_27_61/0.25)]" /> : <p role="status">Drawing the sign…</p>}
        </div>
      </div>
    </section>
  )
}
