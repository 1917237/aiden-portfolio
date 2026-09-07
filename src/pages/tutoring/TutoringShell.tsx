import type { ReactNode } from 'react'
import './tutoring.css'

type Props = {
  children: ReactNode
  className?: string
}

/** Scopes the tutoring design system without changing the portfolio theme. */
export function TutoringShell({ children, className = '' }: Props) {
  return (
    <div className={`tutoring-app ${className}`.trim()}>
      <div className="tutoring-shell">{children}</div>
    </div>
  )
}
