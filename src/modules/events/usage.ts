type Usage = { usedPhotos: number; maxPhotos: number; usedBytes: number; maxBytes: number }

/** How close an event is to its limits. */
export function usageLevel(u: Usage): 'ok' | 'near' | 'full' {
  const part = Math.max(u.usedPhotos / u.maxPhotos, u.usedBytes / u.maxBytes)
  return part >= 1 ? 'full' : part >= 0.9 ? 'near' : 'ok'
}
