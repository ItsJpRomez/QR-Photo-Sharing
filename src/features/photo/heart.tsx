'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { patchPhotos } from '@/features/gallery/cache'
import { eventApi } from '@/features/gallery/queries'
import { cx } from '@/features/ui/cx'
import { api } from '@/lib/api'
import type { PhotoDto } from '@/modules/photos/query'

type Answer = { heartCount: number; hearted: boolean }

export function useHeart(code: string, photo: PhotoDto) {
  const client = useQueryClient()
  const show = (change: Partial<PhotoDto>) => patchPhotos(client, code, { items: [{ ...photo, ...change }], gone: [] })
  return useMutation({
    mutationFn: (on: boolean) => api<Answer>(eventApi(code, `/photos/${photo.id}/heart`), { method: 'PUT', body: { on } }),
    // Shown at once, and taken back if it doesn't work.
    onMutate: (on) => {
      const before = { hearted: photo.hearted, heartCount: photo.heartCount }
      show({ hearted: on, heartCount: Math.max(0, (photo.heartCount ?? 0) + (on ? 1 : -1)) })
      return before
    },
    onSuccess: (answer) => show(answer),
    onError: (_err, _on, before) => before && show(before),
  })
}

type Props = { photo: PhotoDto; disabled: boolean; className: string; heart: ReturnType<typeof useHeart> }

export function HeartButton({ photo, disabled, className, heart }: Props) {
  const on = photo.hearted ?? false
  return (
    <button
      type="button"
      aria-label={`Heart, ${photo.heartCount ?? 0}`}
      aria-pressed={on}
      disabled={disabled}
      onClick={() => heart.mutate(!on)}
      className={cx(className, 'grid-flow-col gap-2', on && '!bg-flash !text-ink')}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
        <path d="M12 20.5 4.2 12.9a5 5 0 0 1 7.1-7.1l.7.7.7-.7a5 5 0 0 1 7.1 7.1z" strokeLinejoin="round" />
      </svg>
      <span>{photo.heartCount ?? 0}</span>
    </button>
  )
}
