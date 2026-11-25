'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/features/ui/button'
import { Notice } from '@/features/ui/field'
import { Switch } from '@/features/ui/switch'
import { api } from '@/lib/api'
import type { ExportDto } from '@/modules/exports/build'
import { formatBytes, plural } from './format'
import { eventPath, hk } from './queries'

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const isRunning = (x: ExportDto) => x.status === 'queued' || x.status === 'running'

const STATUS: Record<ExportDto['status'], string> = {
  queued: 'Starting…',
  running: 'Preparing…',
  ready: '',
  failed: "It didn't work. Please try again.",
  expired: 'No longer available. Make a new one.',
}

export function ExportPage({ id }: { id: string }) {
  const client = useQueryClient()
  const key = [...hk.event(id), 'exports']
  const [includeHidden, setHidden] = useState(false)
  const [includePending, setPending] = useState(false)
  const startedHere = useRef<string | null>(null)
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<{ exports: ExportDto[] }>(eventPath(id, '/exports')).then((r) => r.exports),
    refetchInterval: (q) => (q.state.data?.some(isRunning) ? 1000 : false),
  })
  const start = useMutation({
    mutationFn: () => api<ExportDto>(eventPath(id, '/exports'), { method: 'POST', body: { includeHidden, includePending } }),
    onSuccess: (x) => {
      startedHere.current = x.id
      return client.invalidateQueries({ queryKey: key })
    },
  })
  const download = useMutation({
    mutationFn: (exportId: string) => api<{ url: string }>(eventPath(id, `/exports/${exportId}/download`)),
    onSuccess: ({ url }) => window.location.assign(url),
  })
  const items = list.data ?? []
  const busy = items.some(isRunning)

  const { mutate: save } = download
  useEffect(() => {
    const ready = list.data?.find((x) => x.id === startedHere.current && x.status === 'ready')
    if (!ready) return
    startedHere.current = null
    save(ready.id)
  }, [list.data, save])

  const problem = list.error ?? start.error ?? download.error
  return (
    <div className="grid gap-8">
      <section className="grid max-w-xl gap-4">
        <h2 className="text-xl font-bold">Download everything</h2>
        <p className="text-ink-soft">
          One ZIP file with every original photo, exactly as it was sent, sorted into folders by album. Originals can include where a photo was taken.
        </p>
        <div className="divide-y divide-line">
          <Switch label="Include hidden photos" checked={includeHidden} disabled={busy} onChange={setHidden} />
          <Switch label="Include photos waiting for approval" checked={includePending} disabled={busy} onChange={setPending} />
        </div>
        {problem && <Notice tone="danger">{problem.message}</Notice>}
        <div>
          <Button disabled={busy || start.isPending} onClick={() => start.mutate()}>
            {busy ? 'Preparing your download…' : 'Download all photos'}
          </Button>
        </div>
        {busy && <p className="text-ink-soft">You can leave this page. We&apos;ll email you when it&apos;s ready.</p>}
      </section>
      {items.length > 0 && (
        <section className="grid gap-4">
          <h2 className="text-xl font-bold">Recent downloads</h2>
          <ul className="divide-y divide-line">
            {items.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
                <div className="grid min-w-56 flex-1 gap-1">
                  <p className="font-semibold">
                    {plural(x.status === 'ready' ? x.done : x.total, 'photo')}
                    {x.sizeBytes !== null && `, ${formatBytes(x.sizeBytes)}`}
                  </p>
                  {isRunning(x) && <progress className="h-2 w-full accent-plum" aria-label="Download progress" value={x.done + x.failed} max={x.total} />}
                  <p className="text-sm text-ink-soft">
                    {x.status === 'ready' && x.expiresAt ? `Ready until ${when.format(new Date(x.expiresAt))}` : STATUS[x.status]}
                  </p>
                  {x.failed > 0 && <p className="text-sm font-medium text-danger">{plural(x.failed, 'photo')} could not be included. See _errors.txt in the ZIP.</p>}
                </div>
                {x.status === 'ready' && (
                  <Button variant="secondary" disabled={download.isPending} onClick={() => download.mutate(x.id)}>
                    Download again
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
