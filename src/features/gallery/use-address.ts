'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

type Change = Record<string, string | null>

function changed(search: string, change: Change): string {
  const q = new URLSearchParams(search)
  for (const [k, v] of Object.entries(change)) {
    if (v === null || v === '') q.delete(k)
    else q.set(k, v)
  }
  const text = q.toString()
  return text ? `?${text}` : ''
}

/**
 * Starts from the address as it is this instant, so two quick taps both count,
 * and needs no trip to the server, which matters on a crowded network.
 */
export function setAddress(change: Change, how: 'push' | 'replace' = 'replace'): void {
  const url = window.location.pathname + changed(window.location.search, change)
  if (how === 'push') window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
}

/** What's on screen lives in the address, so reload, share and Back all work. */
export function useAddress() {
  const path = usePathname()
  const params = useSearchParams()
  const href = useCallback((change: Change) => path + changed(params.toString(), change), [params, path])
  return { view: params.get('view') ?? 'all', order: params.get('order') ?? '', photo: params.get('photo'), href }
}
