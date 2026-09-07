import { useEffect, useState } from 'react'
import { SCHEDULE_END_HOUR, SCHEDULE_START_HOUR } from '../../tutoring/scheduleConfig'
import { isoToZonedParts } from '../../tutoring/timezoneUtils'

/** Live civil clock in `timeZone`, refreshed every 30s. */
export function useNowInTimezone(timeZone: string) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  return isoToZonedParts(new Date(nowMs).toISOString(), timeZone)
}

type Props = {
  topPx: number
  visible: boolean
}

/** Horizontal “current time” indicator across a week grid. */
export function CalendarNowLine({ topPx, visible }: Props) {
  if (!visible) return null

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-30 flex items-center"
      style={{ top: topPx }}
      aria-hidden
    >
      <div className="h-2.5 w-2.5 shrink-0 -translate-x-1 rounded-full bg-red-600" />
      <div className="h-px flex-1 bg-red-600" />
    </div>
  )
}

export function isNowWithinScheduleHours(startMinutes: number) {
  const start = SCHEDULE_START_HOUR * 60
  const end = SCHEDULE_END_HOUR * 60
  return startMinutes >= start && startMinutes < end
}
