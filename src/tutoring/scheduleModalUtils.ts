import { formatDateKey } from './calendarUtils'
import { CLASS_DURATION_MINUTES, SLOT_INTERVAL_MINUTES } from './scheduleConfig'

export const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const
export const MINUTES_15 = [0, 15, 30, 45] as const

export function to24Hour(hour12: number, period: 'AM' | 'PM') {
  if (period === 'AM') return hour12 === 12 ? 0 : hour12
  return hour12 === 12 ? 12 : hour12 + 12
}

export function to12HourParts(startMinutes: number) {
  const hour24 = Math.floor(startMinutes / 60)
  const minute = startMinutes % 60
  const period = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return { hour12, minute, period: period as 'AM' | 'PM' }
}

export function formatDateShort(dateKey: string) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function localDateFromParts(dateKey: string, startMinutes: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const hour = Math.floor(startMinutes / 60)
  const minute = startMinutes % 60
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

export function localRangeToIso(
  startDateKey: string,
  startMinutes: number,
  endDateKey: string,
  endMinutes: number,
) {
  const start = localDateFromParts(startDateKey, startMinutes)
  const end = localDateFromParts(endDateKey, endMinutes)
  return { start, end, startIso: start.toISOString(), endIso: end.toISOString() }
}

export function each15MinSlot(
  startDateKey: string,
  startMinutes: number,
  endDateKey: string,
  endMinutes: number,
) {
  const slots: { dateKey: string; startMinutes: number }[] = []
  let current = localDateFromParts(startDateKey, startMinutes)
  const end = localDateFromParts(endDateKey, endMinutes)

  while (current < end) {
    slots.push({
      dateKey: formatDateKey(current),
      startMinutes: current.getHours() * 60 + current.getMinutes(),
    })
    current = new Date(current.getTime() + SLOT_INTERVAL_MINUTES * 60 * 1000)
  }

  return slots
}

export function eachDateKeyInRange(startDateKey: string, endDateKey: string) {
  const keys: string[] = []
  let current = new Date(`${startDateKey}T12:00:00`)
  const end = new Date(`${endDateKey}T12:00:00`)

  while (current <= end) {
    keys.push(formatDateKey(current))
    current.setDate(current.getDate() + 1)
  }

  return keys
}

export function slotEndMinutes(startMinutes: number, durationMinutes = CLASS_DURATION_MINUTES) {
  return startMinutes + durationMinutes
}
