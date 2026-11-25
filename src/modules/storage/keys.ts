const base = (eventId: string) => `ev/${eventId}/`

export const keys = {
  event: base,
  incoming: (eventId: string, id: string) => `${base(eventId)}incoming/${id}`,
  original: (eventId: string, id: string, ext: string) => `${base(eventId)}original/${id}.${ext}`,
  thumb: (eventId: string, id: string) => `${base(eventId)}thumb/${id}.webp`,
  display: (eventId: string, id: string) => `${base(eventId)}display/${id}.webp`,
  download: (eventId: string, id: string) => `${base(eventId)}download/${id}.jpg`,
  cover: (eventId: string, id: string) => `${base(eventId)}cover/${id}.webp`,
  export: (eventId: string, id: string) => `${base(eventId)}export/${id}.zip`,
}
