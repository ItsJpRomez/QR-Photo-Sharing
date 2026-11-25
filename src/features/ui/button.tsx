import Link from 'next/link'
import type { ComponentProps } from 'react'
import { cx } from './cx'

const VARIANTS = {
  primary: 'bg-plum text-white hover:bg-plum-deep disabled:bg-line-strong',
  secondary: 'border border-line-strong bg-sheet text-ink hover:bg-plum-wash disabled:text-ink-soft disabled:bg-paper',
  danger: 'border border-danger bg-sheet text-danger hover:bg-danger-wash disabled:text-ink-soft disabled:border-line',
  quiet: 'text-plum hover:bg-plum-wash disabled:text-ink-soft',
}
const SIZES = { md: 'min-h-11 px-5 text-base', sm: 'min-h-9 px-3 text-sm' }

type Look = { variant?: keyof typeof VARIANTS; size?: keyof typeof SIZES }

export function buttonClass({ variant = 'primary', size = 'md' }: Look = {}): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors',
    VARIANTS[variant],
    SIZES[size],
  )
}

export function Button({ variant, size, className, type = 'button', ...rest }: ComponentProps<'button'> & Look) {
  return <button type={type} className={cx(buttonClass({ variant, size }), className)} {...rest} />
}

export function ButtonLink({ variant, size, className, ...rest }: ComponentProps<typeof Link> & Look) {
  return <Link className={cx(buttonClass({ variant, size }), className)} {...rest} />
}
