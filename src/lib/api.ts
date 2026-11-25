/** Browser-side calls to our own API. */
export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/** Longer than any honest answer, short enough to recover from a connection that went dead. */
const TIMEOUT_MS = 20_000

type Options = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal }

export async function api<T>(path: string, { method = 'GET', body, signal }: Options = {}): Promise<T> {
  const offline = () => new ApiError('offline', "You're offline. Check your connection and try again.", 0)
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS)
  const cancel = () => stop.abort()
  signal?.addEventListener('abort', cancel)
  let res: Response
  let data: unknown
  try {
    res = await fetch(path, {
      method,
      signal: stop.signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    data = await res.json().catch((err: unknown) => {
      if (stop.signal.aborted) throw err
      return undefined
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw offline()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string } } | null)?.error
    throw new ApiError(e?.code ?? 'internal', e?.message ?? 'Something went wrong. Please try again.', res.status)
  }
  // Not our answer at all: often the venue Wi-Fi's own sign-in page.
  if (data === undefined) throw offline()
  return data as T
}
