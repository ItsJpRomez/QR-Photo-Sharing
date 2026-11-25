'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { AlbumRow } from '@/db/schema'
import { Button } from '@/features/ui/button'
import { ConfirmDialog, Dialog } from '@/features/ui/dialog'
import { Field, Input, Notice } from '@/features/ui/field'
import { api } from '@/lib/api'
import { plural } from './format'
import { eventPath, hk, useAlbums, useTags, type HostTag } from './queries'

function useChange<T>(key: readonly unknown[], send: (input: T) => Promise<unknown>) {
  const client = useQueryClient()
  return useMutation({ mutationFn: send, onSettled: () => client.invalidateQueries({ queryKey: key }) })
}

function AddForm({ label, hint, action, onAdd, error }: { label: string; hint?: string; action: string; error?: string; onAdd: (v: string) => Promise<unknown> }) {
  const [value, setValue] = useState('')
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        await onAdd(value).then(
          () => setValue(''),
          () => {},
        )
      }}
    >
      <div className="min-w-56 flex-1">
        <Field label={label} hint={hint} error={error}>
          {(p) => <Input {...p} required maxLength={41} value={value} onChange={(e) => setValue(e.target.value)} />}
        </Field>
      </div>
      <Button type="submit">{action}</Button>
    </form>
  )
}

function Albums({ id }: { id: string }) {
  const { data: albums, error } = useAlbums(id)
  const key = hk.albums(id)
  const add = useChange(key, (name: string) => api(eventPath(id, '/albums'), { method: 'POST', body: { name } }))
  const rename = useChange(key, (a: { id: string; name: string }) =>
    api(eventPath(id, `/albums/${a.id}`), { method: 'PATCH', body: { name: a.name } }),
  )
  const remove = useChange(key, (albumId: string) => api(eventPath(id, `/albums/${albumId}`), { method: 'DELETE', body: {} }))
  const order = useChange(key, (ids: string[]) => api(eventPath(id, '/albums/order'), { method: 'PUT', body: { ids } }))
  const [renaming, setRenaming] = useState<AlbumRow>()
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState<AlbumRow>()
  const problem = error ?? rename.error ?? remove.error ?? order.error

  const move = (from: number, to: number) => {
    const ids = albums!.map((a) => a.id)
    ids.splice(to, 0, ...ids.splice(from, 1))
    order.mutate(ids)
  }
  return (
    <section className="grid gap-4 border-b border-line pb-8">
      <h2 className="text-xl font-bold">Albums</h2>
      {problem && <Notice tone="danger">{problem.message}</Notice>}
      {albums?.length === 0 && <p className="text-ink-soft">No albums. Guests add everything to one gallery.</p>}
      <ol className="grid divide-y divide-line">
        {albums?.map((a, i) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="font-semibold">{a.name}</span>
            <span className="flex flex-wrap gap-1">
              <Button variant="quiet" size="sm" disabled={i === 0 || order.isPending} aria-label={`Move ${a.name} up`} onClick={() => move(i, i - 1)}>
                Up
              </Button>
              <Button
                variant="quiet"
                size="sm"
                disabled={i === albums.length - 1 || order.isPending}
                aria-label={`Move ${a.name} down`}
                onClick={() => move(i, i + 1)}
              >
                Down
              </Button>
              <Button
                variant="quiet"
                size="sm"
                aria-label={`Rename ${a.name}`}
                onClick={() => {
                  setName(a.name)
                  setRenaming(a)
                }}
              >
                Rename
              </Button>
              <Button variant="quiet" size="sm" aria-label={`Delete ${a.name}`} onClick={() => setDeleting(a)}>
                Delete
              </Button>
            </span>
          </li>
        ))}
      </ol>
      <AddForm label="New album" action="Add album" error={add.error?.message} onAdd={(v) => add.mutateAsync(v)} />
      <Dialog
        open={Boolean(renaming)}
        title="Rename album"
        onClose={() => setRenaming(undefined)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRenaming(undefined)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim()}
              onClick={() => rename.mutate({ id: renaming!.id, name }, { onSuccess: () => setRenaming(undefined) })}
            >
              Save name
            </Button>
          </>
        }
      >
        <Field label="Album name" error={rename.error?.message}>
          {(p) => <Input {...p} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name}?`}
        confirm="Delete album"
        busy={remove.isPending}
        onClose={() => setDeleting(undefined)}
        onConfirm={() => remove.mutate(deleting!.id, { onSettled: () => setDeleting(undefined) })}
      >
        <p>Its photos stay in the gallery.</p>
      </ConfirmDialog>
    </section>
  )
}

function Tags({ id }: { id: string }) {
  const { data: tags, error } = useTags(id)
  const key = hk.tags(id)
  const add = useChange(key, (tag: string) => api(eventPath(id, '/tags'), { method: 'POST', body: { tag } }))
  const change = useChange(key, (c: { id: string; body: unknown }) => api(eventPath(id, `/tags/${c.id}`), { method: 'PATCH', body: c.body }))
  const [blocking, setBlocking] = useState<HostTag>()
  const problem = error ?? change.error
  return (
    <section className="grid gap-4">
      <h2 className="text-xl font-bold">Hashtags</h2>
      {problem && <Notice tone="danger">{problem.message}</Notice>}
      {tags?.length === 0 && <p className="text-ink-soft">No hashtags yet. Suggest some, and guests can add their own.</p>}
      <ul className="grid divide-y divide-line">
        {tags?.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-semibold">#{t.display}</span>{' '}
              <span className="text-ink-soft">
                {t.blocked ? 'removed' : plural(t.count, 'photo')}
                {t.suggested && ', suggested'}
              </span>
            </span>
            <span className="flex gap-1">
              {!t.suggested && (
                <Button variant="quiet" size="sm" aria-label={t.blocked ? `Allow ${t.display} again` : `Suggest ${t.display}`} onClick={() => add.mutate(t.display)}>
                  {t.blocked ? 'Allow again' : 'Suggest'}
                </Button>
              )}
              {t.suggested && (
                <Button variant="quiet" size="sm" aria-label={`Stop suggesting ${t.display}`} onClick={() => change.mutate({ id: t.id, body: { suggested: false } })}>
                  Stop suggesting
                </Button>
              )}
              {!t.blocked && (
                <Button variant="quiet" size="sm" aria-label={`Remove ${t.display}`} onClick={() => setBlocking(t)}>
                  Remove
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <AddForm label="Suggest a hashtag" action="Add hashtag" error={add.error?.message} onAdd={(v) => add.mutateAsync(v)} />
      <ConfirmDialog
        open={Boolean(blocking)}
        title={`Remove #${blocking?.display}?`}
        confirm="Remove hashtag"
        busy={change.isPending}
        onClose={() => setBlocking(undefined)}
        onConfirm={() => change.mutate({ id: blocking!.id, body: { blocked: true } }, { onSettled: () => setBlocking(undefined) })}
      >
        <p>It comes off every photo, and guests can&apos;t use it again in this event.</p>
      </ConfirmDialog>
    </section>
  )
}

export function Organize({ id }: { id: string }) {
  return (
    <div className="grid gap-8">
      <Albums id={id} />
      <Tags id={id} />
    </div>
  )
}
