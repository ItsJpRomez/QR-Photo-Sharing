'use client'

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { qk } from '@/features/gallery/cache'
import { eventApi, type EventDto } from '@/features/gallery/queries'
import { Button } from '@/features/ui/button'
import { Field, Input, Notice, Textarea } from '@/features/ui/field'
import { api } from '@/lib/api'
import type { OpenEventDto } from '@/modules/events/view'
import type { CommentDto } from '@/modules/social/comments'

type Page = { items: CommentDto[]; next: string | null }

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function Comments({ event, photoId }: { event: OpenEventDto; photoId: string }) {
  const { code } = event
  const client = useQueryClient()
  const key = qk.comments(photoId)
  const [text, setText] = useState('')
  const [name, setName] = useState(event.me.name)
  const list = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page>(eventApi(code, `/photos/${photoId}/comments${pageParam ? `?cursor=${pageParam}` : ''}`)),
    getNextPageParam: (last) => last.next,
  })
  const refresh = () => client.invalidateQueries({ queryKey: key })
  const post = useMutation({
    mutationFn: (sent: string) =>
      api(eventApi(code, `/photos/${photoId}/comments`), { method: 'POST', body: { text: sent, name: name.trim() || undefined } }),
    onSuccess: (_made, sent) => {
      // Whatever was typed meanwhile is the next comment.
      setText((now) => (now === sent ? '' : now))
      if (name.trim())
        client.setQueryData<EventDto>(qk.event(code), (e) => (e && !e.pinRequired ? { ...e, me: { ...e.me, name: name.trim() } } : e))
      return refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(eventApi(code, `/comments/${id}`), { method: 'DELETE' }),
    onSettled: refresh,
  })
  const hide = useMutation({
    mutationFn: (c: CommentDto) => api(eventApi(code, `/comments/${c.id}`), { method: 'PATCH', body: { hidden: !c.hidden } }),
    onSettled: refresh,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const isHost = event.me.kind === 'host'
  const mayPost = isHost || !event.frozen
  const problem = list.error ?? post.error ?? remove.error ?? hide.error

  return (
    <section aria-label="Comments" className="grid gap-4 rounded-t-sheet bg-sheet p-4 text-ink">
      {problem && <Notice tone="danger">{problem.message}</Notice>}
      {list.data && items.length === 0 && <p className="text-ink-soft">{mayPost ? 'No comments yet. Say something nice.' : 'No comments.'}</p>}
      <ul className="grid gap-3">
        {items.map((c) => (
          <li key={c.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-ink-soft">
                <bdi className="font-semibold text-ink">{c.author}</bdi> <time dateTime={c.createdAt}>{when.format(new Date(c.createdAt))}</time>
                {c.hidden && ' (hidden from guests)'}
              </p>
              <p dir="auto" className="whitespace-pre-line">
                {c.text}
              </p>
            </div>
            <span className="flex shrink-0 flex-col">
              {isHost && (
                <Button variant="quiet" size="sm" onClick={() => hide.mutate(c)}>
                  {c.hidden ? 'Show comment' : 'Hide comment'}
                </Button>
              )}
              {c.canDelete && (
                <Button variant="quiet" size="sm" onClick={() => remove.mutate(c.id)}>
                  Delete comment
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <Button variant="secondary" size="sm" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          Show more comments
        </Button>
      )}
      {mayPost ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            post.mutate(text)
          }}
        >
          <Field label="Add a comment">
            {(p) => <Textarea {...p} required className="min-h-20" value={text} onChange={(e) => setText(e.target.value)} />}
          </Field>
          <Field label="Your first name" hint="Optional.">
            {(p) => <Input {...p} autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Button type="submit" disabled={post.isPending || !text.trim()}>
            Post comment
          </Button>
        </form>
      ) : (
        <p className="text-ink-soft">The host closed comments.</p>
      )}
    </section>
  )
}
