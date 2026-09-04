import { formatTimeLabel } from './scheduleConfig'
import type { Blockout } from './scheduleTypes'

export const MAX_MONTH_CELL_EVENTS = 3

export type CalendarBooking = {
  id: string
  student_id: string
  student_name: string
  status: string
  start_time: string
  end_time: string
  date_key: string
  slot_id: string
  duration_minutes?: number
  series_id?: string | null
  meeting_url?: string | null
}

export type DayEvent =
  | {
      kind: 'whole-day-block'
      id: string
      sortKey: number
      label: string
    }
  | {
      kind: 'partial-block'
      id: string
      sortKey: number
      label: string
      start_minutes: number
    }
  | {
      kind: 'booking'
      id: string
      sortKey: number
      label: string
      booking: CalendarBooking
    }

export function buildDayEvents(
  dateKey: string,
  blockouts: Blockout[],
  bookings: CalendarBooking[],
): DayEvent[] {
  const dayBlockouts = blockouts.filter((b) => String(b.blockout_date).slice(0, 10) === dateKey)
  const wholeDay = dayBlockouts.find((b) => b.start_minutes === null)
  if (wholeDay?.id) {
    return [
      {
        kind: 'whole-day-block',
        id: wholeDay.id,
        sortKey: 0,
        label: 'All day blocked',
      },
    ]
  }

  const events: DayEvent[] = []

  for (const block of dayBlockouts) {
    if (block.start_minutes === null || !block.id) continue
    events.push({
      kind: 'partial-block',
      id: block.id,
      sortKey: block.start_minutes,
      label: `Blocked ${formatTimeLabel(block.start_minutes)}`,
      start_minutes: block.start_minutes,
    })
  }

  for (const booking of bookings.filter((b) => b.date_key === dateKey)) {
    const start = new Date(booking.start_time)
    const sortKey = start.getHours() * 60 + start.getMinutes()
    const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    events.push({
      kind: 'booking',
      id: booking.id,
      sortKey,
      label: `${time} ${booking.student_name}`,
      booking,
    })
  }

  events.sort((a, b) => a.sortKey - b.sortKey)
  return events
}

export function chipClass(event: DayEvent) {
  if (event.kind === 'whole-day-block') {
    return 'bg-red-200 text-red-900 border-red-400'
  }
  if (event.kind === 'partial-block') {
    return 'bg-amber-100 text-amber-900 border-amber-400'
  }
  return 'bg-sage text-white border-sage-deep'
}
