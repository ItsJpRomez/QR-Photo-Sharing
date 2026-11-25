'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useReducer, useRef, useState } from 'react'
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

/** Resolves once a picture is ready to show, so the screen never goes blank. */
function preload(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })
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

  // Move on every few seconds, but only to a picture that has loaded.
  const state = useRef(slides)
  useEffect(() => {
    state.current = slides
  }, [slides])
  useEffect(() => {
    let stopped = false
    let failures = 0
    const timer = setInterval(async () => {
      const [next] = upcoming(state.current, 1)
      if (!next || stopped) return
      if (await preload(next.displayUrl)) {
        failures = 0
        if (!stopped) dispatch({ type: 'tick' })
      } else {
        // Skip it, unless nothing loads: then keep what's on screen. Either way, ask for new links.
        failures++
        void client.invalidateQueries({ queryKey: ['tv', token] })
        if (!stopped && failures < state.current.queue.length) dispatch({ type: 'tick' })
      }
    }, view.seconds * 1000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [view.seconds, client, token])

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
  }, [client, path, token])

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
      <Slide key={photo.id} photo={photo} />
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

function Slide({ photo }: { photo: TvPhoto }) {
  const [url, setUrl] = useState(photo.displayUrl)
  // A new link to the same picture is swapped in only if the old one stopped working.
  return (
    <img
      data-testid="slide"
      data-photo={photo.id}
      src={url}
      alt=""
      className="tv-slide absolute inset-0 size-full object-contain"
      onError={() => setTimeout(() => setUrl(photo.displayUrl), 1000)}
    />
  )
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
