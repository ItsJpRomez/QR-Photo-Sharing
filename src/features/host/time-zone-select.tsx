'use client'

import { useState, type ComponentProps } from 'react'
import { Select } from '@/features/ui/field'

const zones = () => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['UTC']
  }
}

export function TimeZoneSelect({ value, ...rest }: ComponentProps<'select'> & { value: string }) {
  const [all] = useState(zones)
  return (
    <Select value={value} {...rest}>
      {!all.includes(value) && <option value={value}>{value}</option>}
      {all.map((z) => (
        <option key={z} value={z}>
          {z.replaceAll('_', ' ')}
        </option>
      ))}
    </Select>
  )
}
