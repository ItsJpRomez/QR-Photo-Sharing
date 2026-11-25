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

type Options = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal }

export async function api<T>(path: string, { method = 'GET', body, signal }: Options = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new ApiError('offline', "You're offline. Check your connection and try again.", 0)
  }
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string } } | null)?.error
    throw new ApiError(e?.code ?? 'internal', e?.message ?? 'Something went wrong. Please try again.', res.status)
  }
  return data as T
}
