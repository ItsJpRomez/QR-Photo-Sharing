import { getHub, type Watcher } from './hub'

const HEARTBEAT_MS = 20_000

/** A server-sent event stream of one event's changes. */
export async function eventStream(eventId: string, viewer: Watcher, signal: AbortSignal): Promise<Response> {
  const hub = getHub()
  await hub.ready()
  const encoder = new TextEncoder()
  let end = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true
      const write = (text: string) => {
        if (open) controller.enqueue(encoder.encode(text))
      }
      const beat = setInterval(() => write(': still here\n\n'), HEARTBEAT_MS)
      end = () => {
        if (!open) return
        open = false
        clearInterval(beat)
        leave()
        try {
          controller.close()
        } catch {
          // The visitor already left.
        }
      }
      const leave = hub.subscribe(eventId, viewer, {
        send: (m) => write(`data: ${JSON.stringify(m)}\n\n`),
        close: () => end(),
      })
      signal.addEventListener('abort', () => end())
      write('retry: 2000\n\n')
      if (signal.aborted) end()
    },
    cancel: () => end(),
  })
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
