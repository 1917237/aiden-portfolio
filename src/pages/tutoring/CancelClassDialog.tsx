import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  LATE_CANCEL_AGREEMENT,
  LATE_CANCEL_HOURS,
  isLateCancel,
} from '../../tutoring/lateCancelPolicy'
import { getTutoringPortalRoot } from './tutoringPortal'

type Variant = 'admin' | 'student'

export type CancelConfirmPayload = {
  comment: string | null
  requestWaive: boolean
  waiveReason: string | null
}

type Props = {
  open: boolean
  variant: Variant
  busy?: boolean
  lessonStartIso?: string | null
  onClose: () => void
  onConfirm: (payload: CancelConfirmPayload) => void
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
    description: `This class is at least ${LATE_CANCEL_HOURS} hours away, so you'll get your credits back.`,
    noteLabel: 'Note for your tutor (optional)',
    confirm: 'Cancel class',
    dismiss: 'Keep class',
  },
}

export function CancelClassDialog({
  open,
  variant,
  busy = false,
  lessonStartIso = null,
  onClose,
  onConfirm,
}: Props) {
  const [note, setNote] = useState('')
  const [policyAgreed, setPolicyAgreed] = useState(false)
  const [shakePolicy, setShakePolicy] = useState(false)
  const [requestWaive, setRequestWaive] = useState(false)
  const [waiveReason, setWaiveReason] = useState('')
  const [shakeWaive, setShakeWaive] = useState(false)
  const copy = COPY[variant]
  const late = variant === 'student' && lessonStartIso ? isLateCancel(lessonStartIso) : false

  useEffect(() => {
    if (!open) return
    setNote('')
    setPolicyAgreed(false)
    setShakePolicy(false)
    setRequestWaive(false)
    setWaiveReason('')
    setShakeWaive(false)
  }, [open])

  if (!open) return null

  function handleSubmit() {
    if (late && !policyAgreed) {
      setShakePolicy(true)
      window.setTimeout(() => setShakePolicy(false), 450)
      return
    }
    if (late && requestWaive && !waiveReason.trim()) {
      setShakeWaive(true)
      window.setTimeout(() => setShakeWaive(false), 450)
      return
    }
    const trimmed = note.trim()
    const reason = waiveReason.trim()
    onConfirm({
      comment: trimmed.length > 0 ? trimmed : null,
      requestWaive: late && requestWaive,
      waiveReason: late && requestWaive && reason.length > 0 ? reason : null,
    })
  }

  return createPortal(
    <div
      className="tutoring-modal-backdrop fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-class-title"
        className="tutoring-modal-panel w-full max-w-md border border-line bg-white shadow-lg"
      >
        <div className="border-b border-line px-5 py-4">
          <h2 id="cancel-class-title" className="font-display text-2xl font-semibold">
            {copy.title}
          </h2>
          {late ? (
            <p className="mt-2 text-sm text-ink-muted">
              This class starts in under {LATE_CANCEL_HOURS} hours. If you cancel now, you will not
              get those credits back unless Aiden waives the fee.
            </p>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">{copy.description}</p>
          )}
        </div>

        <div className="space-y-4 p-5">
          {late ? (
            <div
              className={`border px-4 py-3 ${
                shakePolicy ? 'confirm-btn-shake border-red-400 bg-red-50' : 'border-red-200 bg-red-50'
              }`}
            >
              <label className="flex items-start gap-3 text-sm text-red-950">
                <input
                  type="checkbox"
                  checked={policyAgreed}
                  onChange={(event) => setPolicyAgreed(event.target.checked)}
                  disabled={busy}
                  className="mt-1"
                />
                <span>{LATE_CANCEL_AGREEMENT}</span>
              </label>
            </div>
          ) : null}

          {late ? (
            <div
              className={`border px-4 py-3 ${
                shakeWaive ? 'confirm-btn-shake border-amber-400 bg-amber-50' : 'border-line bg-bg-elevated/40'
              }`}
            >
              <label className="flex items-start gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={requestWaive}
                  onChange={(event) => setRequestWaive(event.target.checked)}
                  disabled={busy}
                  className="mt-1"
                />
                <span>Ask Aiden to waive the late fee (optional)</span>
              </label>
              {requestWaive ? (
                <label className="mt-3 block">
                  <span className="text-sm font-semibold">Why should this be waived?</span>
                  <textarea
                    value={waiveReason}
                    onChange={(event) => setWaiveReason(event.target.value)}
                    rows={2}
                    disabled={busy}
                    placeholder="Short reason (required if asking)"
                    className="mt-1 w-full resize-y border border-line bg-white px-3 py-2 text-sm disabled:opacity-60"
                  />
                </label>
              ) : null}
            </div>
          ) : null}

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
    </div>,
    getTutoringPortalRoot(),
  )
}
