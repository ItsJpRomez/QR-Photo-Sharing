import { useId, type ComponentProps, type ReactNode } from 'react'
import { cx } from './cx'

export const inputClass =
  'block w-full min-h-11 rounded-control border border-line-strong bg-sheet px-3 py-2 text-base text-ink placeholder:text-ink-soft aria-invalid:border-danger'

type FieldProps = {
  label: string
  hint?: ReactNode
  error?: string
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId()
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ')
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-ink-soft">
          {hint}
        </p>
      )}
      {children({ id, 'aria-describedby': described || undefined, 'aria-invalid': error ? true : undefined })}
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx(inputClass, className)} {...rest} />
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx(inputClass, 'min-h-24', className)} {...rest} />
}

export function Select({ className, ...rest }: ComponentProps<'select'>) {
  return <select className={cx(inputClass, className)} {...rest} />
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'danger'; children: ReactNode }) {
  const look = { info: 'bg-plum-wash text-ink', ok: 'bg-ok-wash text-ok', danger: 'bg-danger-wash text-danger' }[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('rounded-control px-4 py-3', look)}>
      {children}
    </div>
  )
}
