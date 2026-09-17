import { useEffect, useState } from 'react'

/** CSS ambient field — keeps the dark mesh feel without a heavy shader dependency. */
export function AmbientBackground() {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduceMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return (
    <div className="ambient-bg" aria-hidden>
      <div
        className={`ambient-bg__wash ${reduceMotion ? '' : 'ambient-bg__wash--motion'}`}
      />
      <div className="ambient-bg__veil" />
    </div>
  )
}
