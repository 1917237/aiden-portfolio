import type { ReactNode } from 'react'

type EmptyStateProps = {
  title: string
  children: ReactNode
}

export function EmptyState({ title, children }: EmptyStateProps) {
  return (
    <div className="border border-dashed border-line bg-bg-elevated/60 px-6 py-10">
      <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>
      <div className="mt-3 max-w-2xl space-y-2 text-ink-muted">{children}</div>
    </div>
  )
}
