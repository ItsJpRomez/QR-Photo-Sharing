/** A name that is safe to save on any computer. */
export function safeFileName(text: string): string {
  return (
    text
       
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+|\.+$/g, '') || 'event'
  )
}
