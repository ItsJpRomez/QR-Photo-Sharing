export type TvPhoto = { id: string; displayUrl: string; uploader: string | null; album: string | null }

export type Slides = {
  /** The round, in the order it is shown. */
  queue: TvPhoto[]
  /** Arrived since, and shown next. Oldest first. */
  fresh: TvPhoto[]
  index: number
}

export type SlideAction =
  | { type: 'tick' }
  /** Go straight to one, passing over those in between for now. */
  | { type: 'show'; id: string }
  | { type: 'add'; photos: TvPhoto[] }
  | { type: 'remove'; ids: string[] }
  | { type: 'replace'; photos: TvPhoto[] }

export const MAX_SLIDES = 200
export const empty: Slides = { queue: [], fresh: [], index: 0 }

export const current = (s: Slides): TvPhoto | null => s.queue[s.index] ?? null

/** The next few, in order. */
export function upcoming(s: Slides, count: number): TvPhoto[] {
  const round = s.queue.map((_, i) => s.queue[(s.index + 1 + i) % s.queue.length]!)
  return [...s.fresh, ...round].slice(0, count)
}

function tick(s: Slides): Slides {
  const [next, ...fresh] = s.fresh
  if (!next) return s.queue.length ? { ...s, index: (s.index + 1) % s.queue.length } : s
  const at = s.queue.length ? s.index + 1 : 0
  let queue = s.queue.toSpliced(at, 0, next)
  let index = at
  while (queue.length > MAX_SLIDES) {
    // The one shown longest ago is right after this one in the round.
    const drop = (index + 1) % queue.length
    queue = queue.toSpliced(drop, 1)
    if (drop < index) index--
  }
  return { queue, fresh, index }
}

function show(s: Slides, id: string): Slides {
  const waiting = s.fresh.find((p) => p.id === id)
  if (waiting) return tick({ ...s, fresh: [waiting, ...s.fresh.filter((p) => p.id !== id)] })
  const index = s.queue.findIndex((p) => p.id === id)
  return index < 0 ? s : { ...s, index }
}

function update(s: Slides, photos: TvPhoto[]): Slides {
  const by = new Map(photos.map((p) => [p.id, p]))
  return { ...s, queue: s.queue.map((p) => by.get(p.id) ?? p), fresh: s.fresh.map((p) => by.get(p.id) ?? p) }
}

function add(s: Slides, photos: TvPhoto[]): Slides {
  const known = new Set([...s.queue, ...s.fresh].map((p) => p.id))
  const next = { ...update(s, photos), fresh: [...update(s, photos).fresh, ...photos.filter((p) => !known.has(p.id))].slice(-MAX_SLIDES) }
  return next.queue.length ? next : tick(next)
}

function remove(s: Slides, ids: Set<string>): Slides {
  if (!ids.size) return s
  const before = s.queue.slice(0, s.index).filter((p) => !ids.has(p.id)).length
  const queue = s.queue.filter((p) => !ids.has(p.id))
  const next = { queue, fresh: s.fresh.filter((p) => !ids.has(p.id)), index: before < queue.length ? before : 0 }
  return next.queue.length || !next.fresh.length ? next : tick(next)
}

/** `photos` is everything that may be shown, newest first. */
function replace(s: Slides, photos: TvPhoto[]): Slides {
  if (!s.queue.length && !s.fresh.length) return { queue: photos.slice(0, MAX_SLIDES), fresh: [], index: 0 }
  const there = new Set(photos.map((p) => p.id))
  const gone = [...s.queue, ...s.fresh].filter((p) => !there.has(p.id)).map((p) => p.id)
  return add(remove(s, new Set(gone)), photos.toReversed())
}

export function slidesReducer(s: Slides, action: SlideAction): Slides {
  switch (action.type) {
    case 'tick':
      return tick(s)
    case 'show':
      return show(s, action.id)
    case 'add':
      return add(s, action.photos)
    case 'remove':
      return remove(s, new Set(action.ids))
    case 'replace':
      return replace(s, action.photos)
  }
}
