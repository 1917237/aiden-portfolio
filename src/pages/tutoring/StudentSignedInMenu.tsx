import { useEffect, useRef, useState } from 'react'
import { StudentProfileSettings } from './StudentProfileSettings'

type Props = {
  fullName: string
  onSaved: (fullName: string) => void
}

export function StudentSignedInMenu({ fullName, onSaved }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  return (
    <div ref={rootRef} className="relative mt-3 inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span>
          Signed in as <strong className="text-ink">{fullName}</strong>
        </span>
        <span className="text-xs text-ink-muted" aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Your profile"
          className="absolute left-0 top-full z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] border border-line bg-white p-4 shadow-lg"
        >
          <StudentProfileSettings
            fullName={fullName}
            onSaved={(nextName) => {
              onSaved(nextName)
              setOpen(false)
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
