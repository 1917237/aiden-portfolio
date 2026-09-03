import { useEffect, useState } from 'react'

type Variant = 'admin' | 'student'

type Props = {
  open: boolean
  variant: Variant
  busy?: boolean
  onClose: () => void
  onConfirm: (comment: string | null) => void
}

const COPY: Record<
  Variant,
  { title: string; description: string; noteLabel: string; confirm: string; dismiss: string }
> = {
  admin: {
    title: 'Cancel this class?',
    description: 'The student will be notified. Credits held for this lesson will be refunded.',
    noteLabel: 'Note for the student (optional)',
    confirm: 'Cancel class',
    dismiss: 'Keep class',
  },
  student: {
    title: 'Cancel this class?',
    description: 'Your tutor will be notified. Credits held for this lesson will be refunded.',
    noteLabel: 'Note for your tutor (optional)',
    confirm: 'Cancel class',
    dismiss: 'Keep class',
  },
}

export function CancelClassDialog({
  open,
  variant,
  busy = false,
  onClose,
  onConfirm,
}: Props) {
  const [note, setNote] = useState('')
  const copy = COPY[variant]

  useEffect(() => {
    if (open) setNote('')
  }, [open])

  if (!open) return null

  function handleSubmit() {
    const trimmed = note.trim()
    onConfirm(trimmed.length > 0 ? trimmed : null)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-class-title"
        className="w-full max-w-md border border-line bg-white shadow-lg"
      >
        <div className="border-b border-line px-5 py-4">
          <h2 id="cancel-class-title" className="font-display text-2xl font-semibold">
            {copy.title}
          </h2>
          <p className="mt-2 text-sm text-ink-muted">{copy.description}</p>
        </div>

        <div className="space-y-4 p-5">
          <label className="block">
            <span className="text-sm font-semibold">{copy.noteLabel}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              disabled={busy}
              placeholder="Add a short message…"
              className="mt-1 w-full resize-y border border-line bg-white px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="border border-line px-4 py-2 text-sm font-semibold hover:bg-bg-elevated disabled:opacity-60"
            >
              {copy.dismiss}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleSubmit}
              className="bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Cancelling…' : copy.confirm}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
