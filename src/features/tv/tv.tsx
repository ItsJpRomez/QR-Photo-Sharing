'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { textOn } from '@/lib/color'
import { api, ApiError } from '@/lib/api'
import type { Outgoing } from '@/modules/live/hub'
import type { TvDto } from '@/modules/tv/tv'
import { current, empty, slidesReducer, upcoming, type TvPhoto } from './slides'

/** Well within the time image links work. */
const REFRESH_MS = 30 * 60_000
const POLL_MS = 15_000
const RECONNECT_MS = 5000

const qrUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`

const LOAD_MS = 5000
const KEEP = 80

/** Pictures this screen has, held so they stay available without a network. */
class Loaded {
  private readonly kept = new Map<string, HTMLImageElement>()

  has(id: string): boolean {
    return this.kept.has(id)
  }

  /** True once the picture is ready to show, so the screen never goes blank. */
  load(photo: TvPhoto): Promise<boolean> {
    const held = this.kept.get(photo.id)
    if (held) {
      this.keep(photo.id, held)
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      const img = new Image()
      const late = setTimeout(() => resolve(false), LOAD_MS)
      const answer = (ok: boolean) => {
        clearTimeout(late)
        if (ok) this.keep(photo.id, img)
        resolve(ok)
      }
      img.onload = () => answer(true)
      img.onerror = () => answer(false)
      img.src = photo.displayUrl
    })
  }

  /** The address it was loaded from, which the browser still has even if the link has expired since. */
  src(photo: TvPhoto): string {
    return this.kept.get(photo.id)?.src ?? photo.displayUrl
  }

  drop(id: string): void {
    this.kept.delete(id)
  }

  private keep(id: string, img: HTMLImageElement): void {
    this.kept.delete(id)
    this.kept.set(id, img)
    for (const oldest of this.kept.keys()) {
      if (this.kept.size <= KEEP) break
      this.kept.delete(oldest)
    }
  }
}

function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | undefined
    const keepAwake = async () => {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return
      lock = await navigator.wakeLock.request('screen').catch(() => undefined)
    }
    void keepAwake()
    document.addEventListener('visibilitychange', keepAwake)
    return () => {
      document.removeEventListener('visibilitychange', keepAwake)
      void lock?.release().catch(() => {})
    }
  }, [])
}

export function Tv({ token, initial }: { token: string; initial: TvDto }) {
  useWakeLock()
  const client = useQueryClient()
  const path = `/api/tv/${token}`
  const { data: view, error } = useQuery({
    queryKey: ['tv', token],
    queryFn: () => api<TvDto>(path),
    initialData: initial,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
  })
  const [slides, dispatch] = useReducer(slidesReducer, initial.photos, (photos) => slidesReducer(empty, { type: 'replace', photos }))
  const ended = error instanceof ApiError && error.code === 'not_found'
  const photo = current(slides)

  useEffect(() => dispatch({ type: 'replace', photos: view.photos }), [view.photos])

  const [pictures] = useState(() => new Loaded())
  const state = useRef(slides)
  useEffect(() => {
    state.current = slides
  }, [slides])

  // Moves on only to a picture that has loaded. When the next one won't, one that
  // is already here is shown instead; with none, what's on screen stays.
  const moving = useRef(false)
  const advance = useCallback(async () => {
    if (moving.current) return
    moving.current = true
    try {
      const { queue, fresh } = state.current
      const line = upcoming(state.current, queue.length + fresh.length)
      const [next] = line
      if (!next) return
      if (await pictures.load(next)) return dispatch({ type: 'show', id: next.id })
      void client.invalidateQueries({ queryKey: ['tv', token] }) // its link may have run out
      const here = line.find((p) => pictures.has(p.id))
      if (here) return dispatch({ type: 'show', id: here.id })
      for (const p of line.slice(1, 6)) if (await pictures.load(p)) return dispatch({ type: 'show', id: p.id })
    } finally {
      moving.current = false
    }
  }, [client, pictures, token])

  useEffect(() => {
    const timer = setInterval(() => void advance(), view.seconds * 1000)
    return () => clearInterval(timer)
  }, [advance, view.seconds])

  // A few are fetched ahead while there is a network.
  useEffect(() => {
    const on = current(slides)
    for (const p of [...(on ? [on] : []), ...upcoming(slides, 3)]) void pictures.load(p)
  }, [slides, pictures])

  useEffect(() => {
    let source: EventSource | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let connected = false
    let stopped = false
    const refresh = () => void client.invalidateQueries({ queryKey: ['tv', token] })
    const receive = async (m: Outgoing) => {
      if (m.type !== 'photos') return m.type === 'event' || m.type === 'tv' || m.type === 'deleted' || m.type === 'access' ? refresh() : undefined
      try {
        const { photos, gone } = await api<{ photos: TvPhoto[]; gone: string[] }>(`${path}?ids=${m.ids.join(',')}`)
        for (const id of gone) pictures.drop(id)
        dispatch({ type: 'remove', ids: gone })
        dispatch({ type: 'add', photos: photos.toReversed() })
      } catch {
        // Caught up by the next refresh.
      }
    }
    const connect = () => {
      if (stopped) return
      source = new EventSource(`${path}/stream`)
      source.onopen = () => {
        connected = true
        refresh()
      }
      source.onmessage = (e: MessageEvent<string>) => void receive(JSON.parse(e.data) as Outgoing)
      source.onerror = () => {
        connected = false
        if (source?.readyState === EventSource.CLOSED) {
          refresh()
          retry = setTimeout(connect, RECONNECT_MS)
        }
      }
    }
    connect()
    const poll = setInterval(() => !connected && refresh(), POLL_MS)
    return () => {
      stopped = true
      source?.close()
      clearInterval(poll)
      clearTimeout(retry)
    }
  }, [client, path, pictures, token])

  if (ended) {
    return (
      <main className="grid min-h-dvh place-items-center bg-black p-8 text-center text-white">
        <h1 className="text-4xl font-bold">This screen link was replaced. Open the new one from the host&apos;s Share page.</h1>
      </main>
    )
  }
  if (!photo) return <Invitation view={view} />
  return (
    <main className="fixed inset-0 cursor-none overflow-hidden bg-black text-white">
      <h1 className="sr-only">{view.name}</h1>
      <Slide key={photo.id} id={photo.id} src={pictures.src(photo)} onBroken={advance} />
      {(photo.uploader || photo.album) && (
        <p className="absolute bottom-[3vh] left-[3vh] flex max-w-[60vw] gap-[2vh] rounded-control bg-black/70 px-[2vh] py-[1vh] text-[3.2vh]">
          {photo.uploader && <bdi className="truncate font-bold">{photo.uploader}</bdi>}
          {photo.album && <span className="truncate">{photo.album}</span>}
        </p>
      )}
      {(view.qr || view.pin) && (
        <div className="absolute right-[3vh] bottom-[3vh] grid justify-items-center gap-[1vh] rounded-control bg-white p-[1.5vh] text-black">
          {view.qr && <img src={qrUrl(view.qr)} alt="QR code" className="size-[19vh]" />}
          {view.qr && <p className="text-[2.2vh] font-bold">Add your photos</p>}
          {view.pin && (
            <p className="text-[2.6vh]">
              PIN <strong>{view.pin}</strong>
            </p>
          )}
        </div>
      )}
    </main>
  )
}

function Slide({ id, src, onBroken }: { id: string; src: string; onBroken: () => void }) {
  // Keeps the address it started with: a newer link to the same picture would only flicker.
  const [first] = useState(src)
  return <img data-testid="slide" data-photo={id} src={first} alt="" className="tv-slide absolute inset-0 size-full object-contain" onError={onBroken} />
}

function Invitation({ view }: { view: TvDto }) {
  return (
    <main className="grid min-h-dvh place-items-center p-[5vh] text-center" style={{ background: view.accent, color: textOn(view.accent) }}>
      <div className="grid justify-items-center gap-[4vh]">
        <h1 className="text-[9vh] font-extrabold">{view.name}</h1>
        {view.qr && <img src={qrUrl(view.qr)} alt="QR code" className="size-[45vh] bg-white" />}
        <p className="text-[4vh]">{view.qr ? 'Scan to add the first photo' : 'Photos will appear here'}</p>
        {view.pin && (
          <p className="text-[4vh]">
            PIN <strong>{view.pin}</strong>
          </p>
        )}
      </div>
    </main>
  )
}
