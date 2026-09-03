import type { ReactNode } from 'react'
import { useState } from 'react'

type Props = {
  title: string
  description?: string
  defaultOpen?: boolean
  fullHeight?: boolean
  children: ReactNode
}

export function CollapsibleSection({
  title,
  description,
  defaultOpen = false,
  fullHeight = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={`border border-line bg-bg-elevated/40 ${fullHeight ? 'w-full' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full cursor-pointer px-4 py-4 text-left"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="font-display text-2xl font-semibold tracking-tight">{title}</span>
          <span className="text-sm font-sans font-semibold text-sage-deep">
            {open ? 'Hide' : 'Show'}
          </span>
        </span>
        {description ? (
          <p className="mt-2 font-sans text-sm font-normal text-ink-muted">{description}</p>
        ) : null}
      </button>
      {open ? <div className="border-t border-line px-4 pb-4 pt-4">{children}</div> : null}
    </div>
  )
}
