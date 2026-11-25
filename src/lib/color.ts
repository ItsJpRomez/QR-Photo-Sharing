function luminance(hex: string): number {
  const channel = (at: number) => {
    const v = parseInt(hex.slice(at, at + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** WCAG contrast between two #rrggbb colors, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** White or black, whichever reads better. One of them always passes AA. */
export function textOn(background: string): '#ffffff' | '#000000' {
  return contrast(background, '#ffffff') >= contrast(background, '#000000') ? '#ffffff' : '#000000'
}
