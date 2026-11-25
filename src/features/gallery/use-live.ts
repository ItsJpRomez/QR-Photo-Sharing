'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { OpenEventDto } from '@/modules/events/view'
import type { Outgoing } from '@/modules/live/hub'
import type { PhotoDto } from '@/modules/photos/query'
import { insertNewest, knownIds, matchesView, patchPhotos, qk, type Fetched } from './cache'
import { eventApi, fetchPhotos } from './queries'

const BATCH_MS = 1000
const POLL_MS = 15_000
const RECONNECT_MS = 5000
const FLASH_MS = 1200
/** Scrolled further than this, new photos wait behind a button. */
const NEAR_TOP_PX = 500

const NONE: PhotoDto[] = []

type Shown = { event: OpenEventDto; view: string; order: string }

/** Keeps what's on screen up to date while other people add to it. */
export function useLive({ event, view, order }: Shown) {
  const client = useQueryClient()
  const { code } = event
  const where = `${view}|${order}`
  // Tied to the view it was gathered for, so changing views starts empty.
  const [waiting, setWaiting] = useState<{ where: string; items: PhotoDto[] }>({ where, items: [] })
  const held = waiting.where === where ? waiting.items : NONE
  const setHeld = useCallback(
    (change: (now: PhotoDto[]) => PhotoDto[]) => setWaiting((w) => ({ where, items: change(w.where === where ? w.items : []) })),
    [where],
  )
  const [arrived, setArrived] = useState<ReadonlySet<string>>(new Set())
  const shown = useRef({ view, order })
  const newestFirst = view !== 'hearted' && (order || event.defaultOrder) === 'newest'

  useEffect(() => {
    shown.current = { view, order }
  }, [view, order])

  const place = useCallback(
    (items: PhotoDto[]) => {
      insertNewest(client, qk.photos(code, shown.current.view, shown.current.order), items)
      const ids = new Set(items.map((p) => p.id))
      setArrived(ids)
      setTimeout(() => setArrived((now) => (now === ids ? new Set() : now)), FLASH_MS)
    },
    [client, code],
  )

  const showHeld = useCallback(() => {
    place(held)
    setHeld(() => [])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [held, place, setHeld])

  const apply = useCallback(
    (fetched: Fetched) => {
      patchPhotos(client, code, fetched)
      setHeld((all) => all.filter((p) => !fetched.gone.includes(p.id)).map((p) => fetched.items.find((i) => i.id === p.id) ?? p))
      const key = qk.photos(code, shown.current.view, shown.current.order)
      const known = knownIds(client, key)
      const fresh = fetched.items.filter((p) => !known.has(p.id) && matchesView(p, shown.current.view))
      // Lists that aren't on screen are read again when they are next opened.
      void client.invalidateQueries({ queryKey: qk.allPhotos(code), refetchType: 'none' })
      if (fetched.items.length) void client.invalidateQueries({ queryKey: qk.tags(code) })
      if (!fresh.length) return
      if (!newestFirst) return void client.invalidateQueries({ queryKey: key })
      // My own photos always show at once; they are what I just did.
      if (window.scrollY <= NEAR_TOP_PX) place(fresh)
      else {
        const mine = fresh.filter((p) => p.mine)
        const others = fresh.filter((p) => !p.mine)
        if (mine.length) place(mine)
        if (others.length) setHeld((all) => [...all.filter((p) => !others.some((o) => o.id === p.id)), ...others])
      }
    },
    [client, code, newestFirst, place, setHeld],
  )
  const applyRef = useRef(apply)
  useEffect(() => {
    applyRef.current = apply
  }, [apply])

  useEffect(() => {
    const wanted = new Set<string>()
    let batch: ReturnType<typeof setTimeout> | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let source: EventSource | undefined
    let stopped = false
    let connected = false

    const catchUp = () => {
      void client.invalidateQueries({ queryKey: qk.event(code) })
      void client.invalidateQueries({ queryKey: qk.allPhotos(code) })
      void client.invalidateQueries({ queryKey: qk.tags(code) })
      void client.invalidateQueries({ queryKey: ['comments'] })
    }
    const flush = async () => {
      batch = undefined
      const ids = [...wanted].slice(0, 100)
      for (const id of ids) wanted.delete(id)
      try {
        const fetched = await fetchPhotos(code, ids)
        if (!stopped) applyRef.current(fetched)
      } catch {
        for (const id of ids) wanted.add(id)
      }
      if (wanted.size && !stopped) batch ??= setTimeout(flush, BATCH_MS)
    }
    const want = (ids: string[]) => {
      for (const id of ids) wanted.add(id)
      if (wanted.size) batch ??= setTimeout(flush, BATCH_MS)
    }
    const receive = (m: Outgoing) => {
      switch (m.type) {
        case 'photos':
        case 'hearts':
          return want(m.ids)
        case 'comments':
          for (const id of m.ids) void client.invalidateQueries({ queryKey: qk.comments(id) })
          return want(m.ids)
        case 'event':
          void client.invalidateQueries({ queryKey: qk.tags(code) })
          return void client.invalidateQueries({ queryKey: qk.event(code) })
        case 'access':
        case 'deleted':
          return void client.invalidateQueries({ queryKey: qk.event(code) })
      }
    }
    const connect = () => {
      if (stopped) return
      source = new EventSource(eventApi(code, '/stream'))
      source.onopen = () => {
        connected = true
        catchUp() // anything announced while not connected was missed
      }
      source.onmessage = (e: MessageEvent<string>) => receive(JSON.parse(e.data) as Outgoing)
      source.onerror = () => {
        connected = false
        // The browser retries by itself unless it was refused.
        if (source?.readyState === EventSource.CLOSED) retry = setTimeout(connect, RECONNECT_MS)
      }
    }
    connect()
    const poll = setInterval(() => {
      if (!connected) catchUp()
    }, POLL_MS)
    return () => {
      stopped = true
      source?.close()
      clearInterval(poll)
      clearTimeout(batch)
      clearTimeout(retry)
    }
  }, [client, code])

  return { held: held.length, showHeld, arrived }
}
