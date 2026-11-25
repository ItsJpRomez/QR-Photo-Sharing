'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './button'

type Props = { open: boolean; title: string; children?: ReactNode; onClose: () => void; actions?: ReactNode }

export function Dialog({ open, title, children, onClose, actions }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-sheet bg-sheet p-6 text-ink backdrop:bg-ink/60"
    >
      {open && (
        <div className="grid gap-4">
          <h2 id={id} className="text-xl font-bold">
            {title}
          </h2>
          {children}
          <div className="flex flex-wrap justify-end gap-3">{actions}</div>
        </div>
      )}
    </dialog>
  )
}

type ConfirmProps = {
  open: boolean
  title: string
  children?: ReactNode
  confirm: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({ confirm, busy, onConfirm, ...rest }: ConfirmProps) {
  return (
    <Dialog
      {...rest}
      actions={
        <>
          <Button variant="secondary" onClick={rest.onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            {confirm}
          </Button>
        </>
      }
    />
  )
}
