/** A name that is safe to save on any computer. */
export function safeFileName(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+|\.+$/g, '') || 'event'
  )
}
