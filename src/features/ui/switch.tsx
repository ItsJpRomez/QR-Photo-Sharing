import { useId, type ReactNode } from 'react'
import { cx } from './cx'

type Props = { label: string; hint?: ReactNode; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }

export function Switch({ label, hint, checked, disabled, onChange }: Props) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div>
        <span id={id} className="font-semibold">
          {label}
        </span>
        {hint && (
          <p id={`${id}-hint`} className="text-sm text-ink-soft">
            {hint}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-8 w-14 shrink-0 rounded-full border transition-colors',
          checked ? 'border-plum bg-plum' : 'border-line-strong bg-sheet',
        )}
      >
        <span
          className={cx(
            'absolute top-1/2 size-6 -translate-y-1/2 rounded-full transition-[left]',
            checked ? 'left-[1.65rem] bg-white' : 'left-[0.2rem] bg-line-strong',
          )}
        />
      </button>
    </div>
  )
}
