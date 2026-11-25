'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { plural } from '@/features/host/format'
import { Button, buttonClass } from '@/features/ui/button'
import { cx } from '@/features/ui/cx'
import { Field, Input, Select } from '@/features/ui/field'
import { getQueue } from '@/features/upload-queue/use-queue'
import { parseTags } from '@/modules/events/tag-text'
import type { OpenEventDto } from '@/modules/events/view'
import { qk } from './cache'
import type { EventDto } from './queries'

// HEIC is named so iPhones hand over the original instead of a converted copy.
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif'
const PREVIEWS = 11

function Preview({ file }: { file: File }) {
  const [broken, setBroken] = useState(false)
  const show = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return
      const url = URL.createObjectURL(file)
      img.src = url
      return () => URL.revokeObjectURL(url)
    },
    [file],
  )
  return (
    <span className="relative block aspect-square overflow-hidden bg-plum-wash">
      {!broken ? (
        <img ref={show} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span className="grid size-full place-items-center p-1 text-center text-xs">{file.name}</span>
      )}
    </span>
  )
}

function FileButton({ label, camera, onFiles }: { label: string; camera?: boolean; onFiles: (f: File[]) => void }) {
  const id = useId()
  return (
    <>
      <input
        id={id}
        type="file"
        className="peer sr-only"
        accept={camera ? 'image/*' : ACCEPT}
        capture={camera ? 'environment' : undefined}
        multiple={!camera}
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])])
          e.target.value = '' // so the same photo can be picked again
        }}
      />
      <label
        htmlFor={id}
        className={cx(buttonClass({ variant: 'secondary' }), 'peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-plum')}
      >
        {label}
      </label>
    </>
  )
}

export function AddSheet({ event, onClose }: { event: OpenEventDto; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const client = useQueryClient()
  const [files, setFiles] = useState<File[]>([])
  const [albumId, setAlbumId] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [more, setMore] = useState('')
  const [name, setName] = useState(event.me.name)
  const [busy, setBusy] = useState(false)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
  }, [])

  const tags = useMemo(() => parseTags([...picked, ...more.split(/[\s,]+/)]).map((t) => t.display), [picked, more])

  async function upload() {
    setBusy(true)
    void navigator.storage?.persist?.().catch(() => {})
    await getQueue().add(files, { eventId: event.id, code: event.code }, { albumId: albumId || null, tags, name: name.trim() || undefined })
    if (name.trim()) {
      client.setQueryData<EventDto>(qk.event(event.code), (e) => (e && !e.pinRequired ? { ...e, me: { ...e.me, name: name.trim() } } : e))
    }
    onClose()
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className="fixed inset-x-0 top-auto bottom-0 m-0 mx-auto max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-sheet bg-sheet p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink backdrop:bg-ink/60 sm:bottom-6 sm:rounded-sheet"
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void upload()
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-2xl font-bold">
            Add photos
          </h2>
          <Button variant="quiet" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <FileButton label="Choose from library" onFiles={(f) => setFiles((all) => [...all, ...f])} />
          <FileButton label="Take a photo" camera onFiles={(f) => setFiles((all) => [...all, ...f])} />
        </div>
        {files.length > 0 && (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <p role="status" className="font-semibold">
                {plural(files.length, 'photo')} chosen
              </p>
              <Button variant="quiet" size="sm" onClick={() => setFiles([])}>
                Clear
              </Button>
            </div>
            <div className="grid grid-cols-6 gap-[3px]">
              {files.slice(0, PREVIEWS).map((f, i) => (
                <Preview key={`${f.name}-${f.lastModified}-${i}`} file={f} />
              ))}
              {files.length > PREVIEWS && (
                <span className="grid aspect-square place-items-center bg-plum-wash text-sm font-semibold">+{files.length - PREVIEWS}</span>
              )}
            </div>
          </div>
        )}
        {event.albums.length > 0 && (
          <Field label="Album">
            {(p) => (
              <Select {...p} value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
                <option value="">No album</option>
                {event.albums.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="grid gap-2">
          {event.suggestedTags.length > 0 && (
            <div role="group" aria-label="Suggested hashtags" className="flex flex-wrap gap-2">
              {event.suggestedTags.map((t) => {
                const on = picked.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked((all) => (on ? all.filter((x) => x !== t) : [...all, t]))}
                    className={cx('min-h-11 rounded-full border px-4 font-semibold', on ? 'border-plum bg-plum text-white' : 'border-line-strong')}
                  >
                    #{t}
                  </button>
                )
              })}
            </div>
          )}
          <Field label={event.suggestedTags.length ? 'More hashtags' : 'Hashtags'} hint="Separate them with spaces.">
            {(p) => <Input {...p} autoCapitalize="none" autoCorrect="off" value={more} onChange={(e) => setMore(e.target.value)} />}
          </Field>
        </div>
        <Field label="Your first name" hint="Optional. It shows next to your photos.">
          {(p) => <Input {...p} maxLength={40} autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <ul className="grid list-disc gap-1 pl-5 text-sm text-ink-soft">
          <li>Keep this page open until your photos finish. If it closes, reopen it and we&apos;ll continue.</li>
          <li>The host gets your original photos, which can include the location. Other guests only get copies without it.</li>
        </ul>
        <Button type="submit" disabled={!files.length || busy}>
          {files.length ? `Upload ${plural(files.length, 'photo')}` : 'Choose photos first'}
        </Button>
      </form>
    </dialog>
  )
}
