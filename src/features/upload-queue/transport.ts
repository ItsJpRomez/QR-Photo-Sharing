import { api, ApiError } from '@/lib/api'
import { TransportError, type Reserved, type Transport } from './types'

const STALL_MS = 30_000

async function call<T>(path: string, options?: Parameters<typeof api>[1]): Promise<T> {
  try {
    return await api<T>(path, options)
  } catch (err) {
    if (err instanceof ApiError) throw new TransportError(err.code, err.status, err.message)
    throw err
  }
}

const uploads = (code: string, rest = '') => `/api/e/${encodeURIComponent(code)}/uploads${rest}`

export const httpTransport: Transport = {
  reserve: (i) =>
    call<Reserved>(uploads(i.code), {
      method: 'POST',
      body: { clientId: i.clientId, size: i.size, mime: i.mime, albumId: i.meta.albumId, tags: i.meta.tags, name: i.meta.name },
    }),

  complete: (i) => call<Reserved>(uploads(i.code, `/${i.photoId}/complete`), { method: 'POST', body: {} }),

  states: (code, ids) =>
    call<{ states: Awaited<ReturnType<Transport['states']>> }>(uploads(code, `?ids=${ids.join(',')}`)).then((r) => r.states),

  // fetch can't report upload progress, so this one uses XMLHttpRequest.
  put: (url, headers, file, onProgress, signal) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      let stall: ReturnType<typeof setTimeout>
      const watch = () => {
        clearTimeout(stall)
        stall = setTimeout(() => xhr.abort(), STALL_MS)
      }
      const fail = (status: number) => {
        clearTimeout(stall)
        reject(new TransportError(status ? 'put_failed' : 'offline', status))
      }
      xhr.open('PUT', url)
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
      xhr.upload.onprogress = (e) => {
        watch()
        onProgress(e.loaded)
      }
      xhr.onload = () => {
        clearTimeout(stall)
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else fail(xhr.status)
      }
      xhr.onerror = () => fail(0)
      xhr.onabort = () => fail(0)
      signal.addEventListener('abort', () => xhr.abort())
      watch()
      xhr.send(file)
    }),
}
